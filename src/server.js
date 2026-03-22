import http from "http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://192.168.1.102:${PORT}`;
const TRACKS_DIR = path.resolve(__dirname, "../media/input");

const app = express();
app.use(cors());
app.use(
  "/tracks",
  express.static(TRACKS_DIR, {
    // برای جلوگیری از کش شدید (اختیاری)
    etag: true,
    maxAge: "0",
  }),
);

function listTracks() {
  if (!fs.existsSync(TRACKS_DIR)) return [];
  return fs
    .readdirSync(TRACKS_DIR)
    .filter((f) => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f))
    .map((name) => ({
      id: name,
      url: `/tracks/${encodeURIComponent(name)}`,
    }));
}

app.get("/api/tracks", (req, res) => {
  res.json({ tracks: listTracks() });
});

const server = app.listen(PORT, () => {
  console.log(`Server: ${PUBLIC_BASE_URL}`);
});
const wss = new WebSocketServer({ server, path: "/ws" });

/**
 * وضعیت پخش "رادیو"
 * mode: stopped | playing | paused
 *
 * وقتی playing:
 *   startTimeMs = زمان سرور (Date.now()) که position=0 بوده
 * وقتی paused:
 *   pausePositionSec = موقعیت ترک در لحظه pause
 */
let state = {
  mode: "stopped",
  trackId: null,
  startTimeMs: 0,
  pausePositionSec: 0,
  updatedAtMs: Date.now(),
};

function nowMs() {
  return Date.now();
}

function getPositionSec(s, tMs) {
  if (s.mode === "playing") {
    return Math.max(0, (tMs - s.startTimeMs) / 1000);
  }
  if (s.mode === "paused") {
    return Math.max(0, s.pausePositionSec);
  }
  return 0;
}

function setPlaying(trackId, startPosSec = 0) {
  const t = nowMs();
  state = {
    mode: "playing",
    trackId,
    startTimeMs: t - Math.max(0, startPosSec) * 1000,
    pausePositionSec: 0,
    updatedAtMs: t,
  };
}

function setPaused() {
  const t = nowMs();
  if (state.mode !== "playing") return;
  const pos = getPositionSec(state, t);
  state = {
    ...state,
    mode: "paused",
    pausePositionSec: pos,
    updatedAtMs: t,
  };
}

function setResumed() {
  const t = nowMs();
  if (state.mode !== "paused") return;
  const pos = state.pausePositionSec || 0;
  state = {
    ...state,
    mode: "playing",
    startTimeMs: t - pos * 1000,
    updatedAtMs: t,
  };
}

function setStopped() {
  state = {
    mode: "stopped",
    trackId: null,
    startTimeMs: 0,
    pausePositionSec: 0,
    updatedAtMs: nowMs(),
  };
}

function setSeek(positionSec) {
  const t = nowMs();
  const pos = Math.max(0, Number(positionSec) || 0);
  if (state.mode === "playing") {
    state = {
      ...state,
      startTimeMs: t - pos * 1000,
      updatedAtMs: t,
    };
  } else if (state.mode === "paused") {
    state = {
      ...state,
      pausePositionSec: pos,
      updatedAtMs: t,
    };
  }
}

function broadcastJson(obj) {
  const str = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(str);
  }
}

function sendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.meta = { role: "viewer" };

  // در لحظه اتصال، وضعیت فعلی را می‌فرستیم
  sendJson(ws, { type: "state", state, serverNowMs: nowMs() });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    // ping/pong برای تخمین اختلاف ساعت کلاینت/سرور
    if (msg.type === "ping") {
      sendJson(ws, {
        type: "pong",
        clientNowMs: msg.clientNowMs,
        serverNowMs: nowMs(),
      });
      return;
    }

    if (msg.type === "setRole") {
      ws.meta.role = msg.role === "broadcaster" ? "broadcaster" : "viewer";
      sendJson(ws, { type: "role", role: ws.meta.role });
      return;
    }

    if (msg.type === "getState") {
      sendJson(ws, { type: "state", state, serverNowMs: nowMs() });
      return;
    }

    // فقط broadcaster اجازه کنترل دارد
    if (ws.meta.role !== "broadcaster") return;

    if (msg.type === "play") {
      const tracks = listTracks();
      const trackId = String(msg.trackId || "");
      const exists = tracks.some((t) => t.id === trackId);
      if (!exists) {
        sendJson(ws, { type: "error", message: "Track not found." });
        return;
      }
      const startPosSec = Number(msg.startPosSec || 0);
      setPlaying(trackId, startPosSec);
      broadcastJson({ type: "state", state, serverNowMs: nowMs() });
      return;
    }

    if (msg.type === "pause") {
      setPaused();
      broadcastJson({ type: "state", state, serverNowMs: nowMs() });
      return;
    }

    if (msg.type === "resume") {
      setResumed();
      broadcastJson({ type: "state", state, serverNowMs: nowMs() });
      return;
    }

    if (msg.type === "stop") {
      setStopped();
      broadcastJson({ type: "state", state, serverNowMs: nowMs() });
      return;
    }

    if (msg.type === "seek") {
      setSeek(msg.positionSec);
      broadcastJson({ type: "state", state, serverNowMs: nowMs() });
      return;
    }
  });
});

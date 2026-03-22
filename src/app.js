import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { scanAndBuild } from "./lib/scanner.js";
import { requireAdmin } from "./lib/adminAuth.js";
import {
  loadAdminConfig,
  saveAdminConfig,
  normalizeAdminConfig,
} from "./lib/adminConfig.js";
import { buildOrderedTracks, getScheduleAround } from "./lib/timeline.js";
import { readJsonSafe } from "./lib/util.js";
import fs from "fs";

import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function env(name, def) {
  return process.env[name] ?? def;
}

const PORT = Number(env("PORT", "8080"));
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", `http://192.168.1.102:${PORT}`);

const MEDIA_INPUT_DIR = path.resolve(
  __dirname,
  env("MEDIA_INPUT_DIR", "../media/input"),
);
const MEDIA_HLS_DIR = path.resolve(
  __dirname,
  env("MEDIA_HLS_DIR", "../media/hls"),
);
const MEDIA_THUMBNAIL_DIR = path.resolve(
  __dirname,
  env("MEDIA_THUMBNAIL_DIR", "../media/thumbnail"),
);
const DB_PATH = path.resolve(__dirname, env("DB_PATH", "../media/db.json"));

const ADMIN_CFG_PATH = path.resolve(__dirname, "../media/admin.json");
let adminCfg = loadAdminConfig(ADMIN_CFG_PATH);

const FFMPEG = env("FFMPEG", "ffmpeg");
const FFPROBE = env("FFPROBE", "ffprobe");

const SEGMENT_TIME = Number(env("SEGMENT_TIME", "1"));
const HLS_LIST_SIZE = Number(env("HLS_LIST_SIZE", "12"));

const EPOCH_MS = Number(env("EPOCH_MS", "1710000000000"));
const LOOKAHEAD_MS = 10 * 60_000;

let forced = null;
// forced = { trackId, name, thumbnail, hlsUrl, atServerMs }

let lastDb = readJsonSafe(DB_PATH, { tracks: {} });
let lastTracks = buildOrderedTracks(lastDb);

async function rebuild() {
  lastDb = await scanAndBuild({
    inputDir: MEDIA_INPUT_DIR,
    hlsDir: MEDIA_HLS_DIR,
    dbPath: DB_PATH,
    ffmpegPath: FFMPEG,
    ffprobePath: FFPROBE,
    segmentTimeSec: SEGMENT_TIME,
    listSize: HLS_LIST_SIZE,
  });
  lastTracks = buildOrderedTracks(lastDb);
  console.log(`DB tracks: ${lastTracks.length}`);
}

// await rebuild();
lastTracks = buildOrderedTracks(lastDb, adminCfg);

const app = express();
app.use(cors());

app.use(express.json({ limit: "1mb" }));

const LOG_DIR = path.resolve("./logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

function appendLogLine(line) {
  const file = path.join(
    LOG_DIR,
    `client-${new Date().toISOString().slice(0, 10)}.log`,
  ); // روزانه
  fs.appendFile(file, line + "\n", (err) => {
    if (err) console.error("append log failed:", err);
  });
}

app.post("/api/client-log", (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "-";

  const logs = Array.isArray(req.body?.logs) ? req.body.logs : [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i] ? JSON.stringify(logs[i]) : "-";
    const line = `[${new Date().toISOString()}] ip=${ip} log=${log}`;
    appendLogLine(line);
  }

  res.json({ ok: true });
});

app.get("/api/admin/state", requireAdmin, (req, res) => {
  res.json({
    ok: true,
    adminCfg,
    tracks: lastTracks,
  });
});

app.post("/api/admin/order", express.json(), requireAdmin, (req, res) => {
  const cfg = normalizeAdminConfig({ ...adminCfg, order: req.body?.order });
  adminCfg = cfg;
  saveAdminConfig(ADMIN_CFG_PATH, adminCfg);

  // rebuild ordering immediately
  lastTracks = buildOrderedTracks(lastDb, adminCfg);

  // push schedule to clients
  pushScheduleToAllClients();

  res.json({ ok: true, adminCfg });
});

app.post("/api/admin/disabled", express.json(), requireAdmin, (req, res) => {
  const cfg = normalizeAdminConfig({
    ...adminCfg,
    disabled: req.body?.disabled,
  });
  adminCfg = cfg;
  saveAdminConfig(ADMIN_CFG_PATH, adminCfg);

  lastTracks = buildOrderedTracks(lastDb, adminCfg);
  pushScheduleToAllClients();

  res.json({ ok: true, adminCfg });
});

app.post("/api/admin/force", express.json(), requireAdmin, (req, res) => {
  const { trackId, delayMs = 5000 } = req.body || {};
  if (!trackId)
    return res.status(400).json({ ok: false, error: "trackId required" });

  const now = Date.now();
  const track = lastTracks.find((t) => t.id == trackId);
  forced = {
    trackId,
    name: track.name,
    thumbnail: PUBLIC_BASE_URL + track.thumbnail,
    hlsUrl: PUBLIC_BASE_URL + track.hlsRel,
    atServerMs: now + Number(delayMs),
    durationMs: track.durationMs,
  };

  const payload = JSON.stringify({ type: "force", forced });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload);
  }

  res.json({ ok: true, forced });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    tracks: lastTracks.length,
    nowServerMs: Date.now(),
    epochMs: EPOCH_MS,
    online: onlineClients.size,
  });
});

app.get("/api/schedule", (req, res) => {
  const now = Date.now();
  const schedule = getScheduleAround({
    tracks: lastTracks,
    epochMs: EPOCH_MS,
    nowMs: now,
    lookAheadMs: LOOKAHEAD_MS,
  }).map((s) => ({
    ...s,
    hlsUrl: PUBLIC_BASE_URL + s.hlsUrl,
    thumbnail: PUBLIC_BASE_URL + s.thumbnail,
  }));
  res.json({ nowServerMs: now, epochMs: EPOCH_MS, schedule });
});

app.use(
  "/hls",
  express.static(MEDIA_HLS_DIR, {
    etag: true,
    lastModified: true,
    maxAge: "10m",
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
);

app.use(
  "/thumbnail",
  express.static(MEDIA_THUMBNAIL_DIR, {
    etag: true,
    lastModified: true,
    maxAge: "10m",
  }),
);

const server = app.listen(PORT, () => {
  console.log(`Server: ${PUBLIC_BASE_URL}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });
const onlineClients = new Set();

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastOnlineCount() {
  broadcast({ type: "online_count", count: onlineClients.size });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws, req) => {
  console.log("WS connected from:", req.socket.remoteAddress);
  onlineClients.add(ws);
  broadcastOnlineCount();

  ws.on("close", (code, reason) => {
    console.log("WS closed:", code, reason?.toString?.() || "");
    onlineClients.delete(ws);
    broadcastOnlineCount();
  });
  ws.on("error", (e) => {
    console.log("WS error:", e);
    onlineClients.delete(ws);
    broadcastOnlineCount();
  });
  const now = Date.now();
  const schedule = getScheduleAround({
    tracks: lastTracks,
    epochMs: EPOCH_MS,
    nowMs: now,
    lookAheadMs: LOOKAHEAD_MS,
  }).map((s) => ({
    ...s,
    hlsUrl: PUBLIC_BASE_URL + s.hlsUrl,
    thumbnail: PUBLIC_BASE_URL + s.thumbnail,
  }));

  send(ws, {
    type: "hello",
    nowServerMs: now,
    epochMs: EPOCH_MS,
    schedule,
    forced,
  });

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }    
    if (msg.type === "time_ping") {
      const recv = Date.now();
      send(ws, {
        type: "time_pong",
        clientSendMs: msg.clientSendMs,
        serverRecvMs: recv,
        serverSendMs: Date.now(),
      });
    } else if (msg.type === "need_schedule") {
      const now2 = Date.now();
      const schedule2 = getScheduleAround({
        tracks: lastTracks,
        epochMs: EPOCH_MS,
        nowMs: now2,
        lookAheadMs: LOOKAHEAD_MS,
      }).map((s) => ({
        ...s,
        hlsUrl: PUBLIC_BASE_URL + s.hlsUrl,
        thumbnail: PUBLIC_BASE_URL + s.thumbnail,
      }));
      send(ws, {
        type: "schedule",
        nowServerMs: now2,
        epochMs: EPOCH_MS,
        schedule: schedule2,
      });
    }
  });
});

function pushScheduleToAllClients() {
  const now = Date.now();
  const schedule = getScheduleAround({
    tracks: lastTracks,
    epochMs: EPOCH_MS,
    nowMs: now,
    lookAheadMs: LOOKAHEAD_MS,
  }).map((s) => ({ ...s, hlsUrl: PUBLIC_BASE_URL + s.hlsUrl }));

  const payload = JSON.stringify({
    type: "schedule",
    nowServerMs: now,
    epochMs: EPOCH_MS,
    schedule,
    forced,
  });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

// هر 15 ثانیه schedule push
setInterval(() => {
  const now = Date.now();
  const schedule = getScheduleAround({
    tracks: lastTracks,
    epochMs: EPOCH_MS,
    nowMs: now,
    lookAheadMs: LOOKAHEAD_MS,
  }).map((s) => ({
    ...s,
    hlsUrl: PUBLIC_BASE_URL + s.hlsUrl,
    thumbnail: PUBLIC_BASE_URL + s.thumbnail,
  }));

  const payload = JSON.stringify({
    type: "schedule",
    nowServerMs: now,
    epochMs: EPOCH_MS,
    schedule,
  });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}, 15_000);

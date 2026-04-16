import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { scanAndBuild } from "./lib/scanner.js";
import { requireAdmin } from "./lib/adminAuth.js";
import { buildOrderedTracks, getScheduleAround } from "./lib/timeline.js";
import { readJsonSafe } from "./lib/util.js";
import connectDB from "./database/index.js";
import roomRoutes from "./routes/rooms.js";
import { setupRoomSocket } from "./websocket/roomSocket.js";

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
const ROOM_LOGO_DIR = path.resolve(
  __dirname,
  env("ROOM_LOGO_DIR", "../media/logo"),
);
const DB_PATH = path.resolve(__dirname, env("DB_PATH", "../media/db.json"));

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
lastTracks = buildOrderedTracks(lastDb);

const app = express();
app.use(cors());

app.use(express.json({ limit: "1mb" }));

const LOG_DIR = path.resolve("./logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

connectDB();

app.use("/api/rooms", roomRoutes);

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

app.get("/api/tracks", (req, res) => {
  let tracks = lastTracks.map((t) => ({
    ...t,
    thumbnail: PUBLIC_BASE_URL + t.thumbnail,
    hlsUrl: PUBLIC_BASE_URL + t.hlsRel,
  }));

  tracks = tracks.filter(
    (track, index, arr) =>
      index ===
      arr.findIndex(
        (t) => t.thumbnail === track.thumbnail && t.name === track.name,
      ),
  );

  res.json({
    ok: true,
    total: tracks.length,
    tracks,
  });
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

app.use(
  "/logo",
  express.static(ROOM_LOGO_DIR, {
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
    //  else if (msg.type === "join_room") {
    //   ws.roomId = msg.roomId;
    //   const room = rooms.find((r) => r.roomId === msg.roomId);
    //   const now = Date.now();
    //   let position = room.basePositionSeconds;
    //   if (room.isPlaying) {
    //     position += (now - room.startAtServerMs) / 1000;
    //   }
    //   send(ws, {
    //     type: "join_room",
    //     room,
    //     track: {
    //       id: room.trackId,
    //       name: room.trackName,
    //       thumbnail: room.thumbnail,
    //       hlsUrl: room.hlsUrl,
    //     },
    //     positionSeconds: position,
    //     startAtServerMs: room.startAtServerMs,
    //   });
    // } else if (msg.type === "start_track") {
    //   const room = rooms.find((r) => r.roomId === msg.roomId);
    //   const startAtServerMs = Date.now() + 1500;
    //   room.hlsUrl = msg.track.hlsUrl;
    //   room.trackId = msg.track.id;
    //   room.trackName = msg.track.name;
    //   room.thumbnail = msg.track.thumbnail;
    //   room.basePositionSeconds = 0;
    //   room.startAtServerMs = startAtServerMs;
    //   room.isPlaying = true;
    //   broadcastRoom(msg.roomId, {
    //     type: "play_track",
    //     room,
    //     positionSeconds: 0,
    //     startAtServerMs,
    //   });
    // } else if (msg.type === "pause_track") {
    //   const room = rooms.find((r) => r.roomId === msg.roomId);
    //   const now = Date.now();
    //   if (room.isPlaying) {
    //     room.basePositionSeconds += (now - room.startAtServerMs) / 1000;
    //     room.isPlaying = false;
    //   }
    //   broadcastRoom(msg.roomId, { type: "pause_track", room });
    // } else if (msg.type === "resume_track") {
    //   const room = rooms.find((r) => r.roomId === msg.roomId);
    //   const startAtServerMs = Date.now() + 1500;
    //   room.startAtServerMs = startAtServerMs;
    //   room.isPlaying = true;
    //   broadcastRoom(msg.roomId, {
    //     type: "resume_track",
    //     room,
    //     startAtServerMs,
    //     positionSeconds: room.basePositionSeconds,
    //   });
    // }
  });
});

setupRoomSocket(wss);

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

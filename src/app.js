import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { scanAndBuild } from "./lib/scanner.js";
import { buildOrderedTracks, getScheduleAround } from "./lib/timeline.js";
import { readJsonSafe } from "./lib/util.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function env(name, def) {
  return process.env[name] ?? def;
}

// ساده: .env را خودتان export کنید یا با systemd set کنید.
// اگر خواستید dotenv هم می‌گذارم، ولی فعلاً بدون پکیج اضافی.
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

const FFMPEG = env("FFMPEG", "ffmpeg");
const FFPROBE = env("FFPROBE", "ffprobe");

const SEGMENT_TIME = Number(env("SEGMENT_TIME", "1"));
const HLS_LIST_SIZE = Number(env("HLS_LIST_SIZE", "12"));

const EPOCH_MS = Number(env("EPOCH_MS", "1710000000000"));
const LOOKAHEAD_MS = 10 * 60_000;

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

const app = express();
app.use(cors());

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    tracks: lastTracks.length,
    nowServerMs: Date.now(),
    epochMs: EPOCH_MS,
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

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws, req) => {
  console.log("WS connected from:", req.socket.remoteAddress, "url:", req.url);

  ws.on("error", (e) => console.error("WS error:", e));
  ws.on("close", (code, reason) => {
    console.log("WS closed:", code, reason?.toString?.() || "");
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

  send(ws, { type: "hello", nowServerMs: now, epochMs: EPOCH_MS, schedule });

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
    }

    if (msg.type === "need_schedule") {
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

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`Command failed: ${cmd} ${args.join(" ")}\n${err}`));
    });
  });
}

export async function probeDurationMs(ffprobePath, inputFile) {
  // خروجی بر حسب ثانیه (float)
  const { out } = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputFile
  ]);
  const sec = Number(String(out).trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("Invalid duration from ffprobe");
  return Math.round(sec * 1000);
}

export async function transcodeToHls({
  ffmpegPath,
  inputFile,
  outDir,
  segmentTimeSec,
  listSize
}) {
  fs.mkdirSync(outDir, { recursive: true });

  const playlistPath = path.join(outDir, "index.m3u8");
  const segmentPattern = path.join(outDir, "seg_%06d.ts");
  
  const args = [
    "-y",
    "-i", inputFile,
    "-vn",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
  
    "-f", "hls",
    "-hls_time", String(segmentTimeSec),      // 1
    "-hls_list_size", String(listSize),       // مثلا 12
    "-hls_playlist_type", "event",
    "-hls_segment_type", "mpegts",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", segmentPattern,
    playlistPath
  ];

  const res = await run(ffmpegPath, args);
  return { playlistPath };
}
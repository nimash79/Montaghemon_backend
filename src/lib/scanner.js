import fs from "fs";
import path from "path";
import { probeDurationMs, transcodeToHls } from "./transcode.js";
import { readJsonSafe, writeJsonAtomic, sleep } from "./util.js";

export async function scanAndBuild({
  inputDir,
  hlsDir,
  dbPath,
  ffmpegPath,
  ffprobePath,
  segmentTimeSec,
  listSize
}) {
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(hlsDir, { recursive: true });

  const db = readJsonSafe(dbPath, { tracks: {} });

  const files = fs.readdirSync(inputDir)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const abs = path.join(inputDir, file);
    const st = fs.statSync(abs);
    const key = file; // track key = filename

    const prev = db.tracks[key];
    const need = !prev || prev.mtimeMs !== st.mtimeMs || prev.size !== st.size;

    if (!need) continue;

    // duration
    const durationMs = await probeDurationMs(ffprobePath, abs);

    // transcode
    const out = path.join(hlsDir, key.replace(/\.mp3$/i, ""));
    // پاکسازی قبلی (ساده)
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    await transcodeToHls({
      ffmpegPath,
      inputFile: abs,
      outDir: out,
      segmentTimeSec,
      listSize
    });

    db.tracks[key] = {
      file,
      name: key.replace(/\.mp3$/i, ""),
      singer: "",
      durationMs,
      mtimeMs: st.mtimeMs,
      size: st.size,
      thumbnail: `/thumbnail/${encodeURIComponent(key.replace(/\.mp3$/i, ".webp"))}`,
      hlsRel: `/hls/${encodeURIComponent(key.replace(/\.mp3$/i, ""))}/index.m3u8`,
      disabled: false,
    };

    writeJsonAtomic(dbPath, db);

    // کمی فاصله برای فشار کمتر روی دیسک
    await sleep(50);
  }

  // حذف از DB اگر فایل پاک شده
  for (const k of Object.keys(db.tracks)) {
    if (!files.includes(k)) {
      delete db.tracks[k];
      writeJsonAtomic(dbPath, db);
    }
  }

  return db;
}
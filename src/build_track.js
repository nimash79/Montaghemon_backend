import dotenv from "dotenv";
dotenv.config();

import { transcodeToHls } from "./lib/transcode.js";
import { scanAndBuild } from "./lib/scanner.js";

(async () => {
  await scanAndBuild({
    inputDir: "./media/input",
    hlsDir: "./media/hls",
    dbPath: "./media/db.json",
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    segmentTimeSec: process.env.SEGMENT_TIME,
    listSize: process.env.HLS_LIST_SIZE,
  });
})();

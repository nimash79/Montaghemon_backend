import dotenv from "dotenv";
dotenv.config();

import connectDB from "./database/index.js";
import { Track, Singer } from "./database/models/index.js";
import { readJsonSafe } from "./lib/util.js";

function parseSingerNames(singerField) {
  if (typeof singerField !== "string") return [];
  return [...new Set(
    singerField
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  )];
}

connectDB().then(async () => {
  try {
    const db = readJsonSafe("./media/db.json", { tracks: {} });

    const all = Object.entries(db.tracks).map(([key, t]) => {
      const { file, ...rest } = t;
      return { category: null, ...rest };
    });

    // 1) استخراج همه نام‌های خواننده (با پشتیبانی از چندتایی)
    const singerNames = [
      ...new Set(
        all.flatMap((track) => parseSingerNames(track.singer))
      ),
    ];

    console.log("خواننده‌های یکتا:", singerNames.length);

    // 2) upsert همه Singerها
    if (singerNames.length) {
      await Singer.bulkWrite(
        singerNames.map((name) => ({
          updateOne: {
            filter: { name },
            update: { $setOnInsert: { name } },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    // 3) ساخت map: name -> _id
    const singers = await Singer.find(
      { name: { $in: singerNames } },
      { _id: 1, name: 1 }
    ).lean();

    const singerMap = new Map(singers.map((s) => [s.name, s._id]));

    // 4) آپدیت ترک‌ها
    const tracks = await Track.find({}, { _id: 1, hlsRel: 1 }).lean();

    // map از db.json بر اساس hlsRel برای دسترسی سریع
    const jsonByHlsRel = new Map(all.map((t) => [t.hlsRel, t]));

    let updatedCount = 0;
    let missingInJson = 0;

    for (const tr of tracks) {
      const src = jsonByHlsRel.get(tr.hlsRel);
      if (!src) {
        missingInJson++;
        continue;
      }

      const names = parseSingerNames(src.singer);
      const singerIds = names.map((n) => singerMap.get(n)).filter(Boolean);

      await Track.updateOne(
        { _id: tr._id },
        {
          $set: {
            singers: singerIds,      // 👈 چندتایی
            singerText: src.singer ?? "",
          },
        }
      );

      updatedCount++;
    }

    console.log("تعداد ترک‌های آپدیت‌شده:", updatedCount);
    console.log("ترک‌هایی که در db.json پیدا نشدند (بر اساس hlsRel):", missingInJson);

    process.exit(0);
  } catch (error) {
    console.error("خطا در migration singer ها:", error);
    process.exit(1);
  }
});
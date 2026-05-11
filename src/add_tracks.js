import { readJsonSafe, writeJsonAtomic } from "./lib/util.js";

let db = readJsonSafe("./media/db.json", { tracks: {} });

let all = Object.entries(db.tracks).map(([key, t]) => {
  const { file, singer, ...rest } = t;

  return {
    category: null,
    ...rest,
  };
});

writeJsonAtomic("./media/import.json", all);
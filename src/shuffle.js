import fs from "fs/promises";

function shuffleInPlace(arr) {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node shuffle-json.js <path-to-json>");
    process.exit(1);
  }

  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);

  if (!data.tracks || typeof data.tracks !== "object" || Array.isArray(data.tracks)) {
    throw new Error('Invalid format: expected data.tracks to be an object');
  }

  const entries = Object.entries(data.tracks); // [ [key, value], ... ]
  shuffleInPlace(entries);

  data.tracks = Object.fromEntries(entries);

  // (اختیاری) بکاپ
  await fs.writeFile(filePath + ".bak", raw, "utf8");

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Shuffled and saved: ${filePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
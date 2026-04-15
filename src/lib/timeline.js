export function buildOrderedTracks(db) {
  const all = Object.entries(db.tracks).map(([key, t]) => ({
    id: key,
    name: t.name,
    thumbnail: t.thumbnail,
    durationMs: t.durationMs,
    hlsRel: t.hlsRel,
  }));

  return all;
}

export function getScheduleAround({ tracks, epochMs, nowMs, lookAheadMs }) {
  const endMs = nowMs + lookAheadMs;
  const total = tracks.reduce((s, t) => s + t.durationMs, 0);
  if (!tracks.length || total <= 0) return [];

  let pos = (((nowMs - epochMs) % total) + total) % total;

  let idx = 0;
  while (idx < tracks.length && pos >= tracks[idx].durationMs) {
    pos -= tracks[idx].durationMs;
    idx++;
  }
  if (idx >= tracks.length) idx = 0;

  let cursorStartMs = nowMs - pos;
  let cursorIdx = idx;

  const schedule = [];
  while (cursorStartMs < endMs) {
    const tr = tracks[cursorIdx];
    schedule.push({
      trackId: tr.id,
      trackName: tr.name,
      thumbnail: tr.thumbnail,
      startMs: cursorStartMs,
      endMs: cursorStartMs + tr.durationMs,
      durationMs: tr.durationMs,
      hlsUrl: tr.hlsRel,
    });
    cursorStartMs += tr.durationMs;
    cursorIdx = (cursorIdx + 1) % tracks.length;
  }
  return schedule;
}

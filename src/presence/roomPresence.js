const roomMembers = new Map(); // roomId -> Set of ws connections

export function addMember(roomId, ws) {
  if (!roomMembers.has(roomId)) {
    roomMembers.set(roomId, new Set());
  }
  roomMembers.get(roomId).add(ws);
}

export function removeMember(roomId, ws) {
  if (roomMembers.has(roomId)) {
    roomMembers.get(roomId).delete(ws);

    if (roomMembers.get(roomId).size === 0) {
      roomMembers.delete(roomId);
    }
  }
}

export function getRoomMembers(roomId) {
  return roomMembers.get(roomId)?.size || 0;
}

export function getAllRoomMembers() {
  const obj = {};
  for (const [roomId, set] of roomMembers.entries()) {
    obj[roomId] = set.size;
  }
  return obj;
}

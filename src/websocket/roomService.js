import Room from "../database/models/room.js";

export async function getRoom(roomId) {
  return await Room.findOne({ roomId });
}

export async function updateRoom(roomId, update) {
  return await Room.findOneAndUpdate(
    { roomId },
    update,
    { new: true }
  );
}
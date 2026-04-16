import {
  getRoomMembers,
  addMember,
  removeMember,
} from "../presence/roomPresence.js";
import { getRoom, updateRoom } from "./roomService.js";

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function broadcastRoom(wss, roomId, obj) {
  const payload = JSON.stringify(obj);

  for (const client of wss.clients) {
    if (client.readyState === 1 && client.roomId === roomId) {
      client.send(payload);
    }
  }
}

export function setupRoomSocket(wss) {
  wss.on("connection", (ws, req) => {
    ws.on("close", () => {
      removeMember(ws.roomId, ws);
      broadcastRoom(wss, ws.roomId, {
        type: "room_members",
        count: getRoomMembers(ws.roomId),
      });
    });

    ws.on("message", async (buf) => {
      let msg;

      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }

      // join room
      if (msg.type === "join_room") {
        ws.roomId = msg.roomId;

        addMember(msg.roomId, ws);
        broadcastRoom(wss, msg.roomId, {
          type: "room_members",
          count: getRoomMembers(msg.roomId),
        });

        const room = await getRoom(msg.roomId);

        if (!room) return;

        const now = Date.now();

        let position = room.basePositionSeconds;

        if (room.isPlaying) {
          position += (now - room.startAtServerMs) / 1000;
        }

        send(ws, {
          type: "join_room",
          room,
          track: {
            id: room.trackId,
            name: room.trackName,
            thumbnail: room.thumbnail,
            hlsUrl: room.hlsUrl,
          },
          positionSeconds: position,
          startAtServerMs: room.startAtServerMs,
        });
      }

      // start track
      else if (msg.type === "start_track") {
        const startAtServerMs = Date.now() + 1500;

        const room = await updateRoom(msg.roomId, {
          hlsUrl: msg.track.hlsUrl,
          trackId: msg.track.id,
          trackName: msg.track.name,
          thumbnail: msg.track.thumbnail,
          basePositionSeconds: 0,
          startAtServerMs,
          isPlaying: true,
        });

        broadcastRoom(wss, msg.roomId, {
          type: "play_track",
          room,
          positionSeconds: 0,
          startAtServerMs,
        });
      }

      // pause
      else if (msg.type === "pause_track") {
        const room = await getRoom(msg.roomId);

        if (!room) return;

        const now = Date.now();

        let basePosition = room.basePositionSeconds;

        if (room.isPlaying) {
          basePosition += (now - room.startAtServerMs) / 1000;
        }

        const updated = await updateRoom(msg.roomId, {
          basePositionSeconds: basePosition,
          isPlaying: false,
        });

        broadcastRoom(wss, msg.roomId, {
          type: "pause_track",
          room: updated,
        });
      }

      // resume
      else if (msg.type === "resume_track") {
        const startAtServerMs = Date.now() + 1500;

        const room = await updateRoom(msg.roomId, {
          startAtServerMs,
          isPlaying: true,
        });

        broadcastRoom(wss, msg.roomId, {
          type: "resume_track",
          room,
          startAtServerMs,
          positionSeconds: room.basePositionSeconds,
        });
      }

      // leave
      else if (msg.type === "leave_room") {
        removeMember(ws.roomId, ws);
        broadcastRoom(wss, ws.roomId, {
          type: "room_members",
          count: getRoomMembers(ws.roomId),
        });
      }
    });
  });
}

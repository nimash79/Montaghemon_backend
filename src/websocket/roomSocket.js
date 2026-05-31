import crypto from "crypto";

import {
  getRoomMembers,
  addMember,
  removeMember,
} from "../presence/roomPresence.js";
import { getRoom, updateRoom } from "./roomService.js";
import {
  getRouterRtpCapabilities,
  createSendTransport,
  createRecvTransport,
  connectTransport,
  produceMic,
  consumeMic,
  resumeConsumer,
  closeMic,
  hasMicProducer,
  getMicProducerId,
  closePeer,
} from "./mediasoupMic.js";

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
    ws.peerId = crypto.randomUUID();
    ws.on("close", () => {
      removeMember(ws.roomId, ws);
      broadcastRoom(wss, ws.roomId, {
        type: "room_members",
        count: getRoomMembers(ws.roomId),
      });
      try {
        closePeer(ws.roomId, ws.peerId);
      } catch (e) {
        console.error("closePeer error:", e);
      }
    });

    ws.on("message", async (buf) => {
      let msg;

      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }

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

        const micActive = hasMicProducer(msg.roomId);
        const micProducerId = getMicProducerId(msg.roomId);

        send(ws, {
          type: "join_room",
          room,
          track: {
            _id: room.trackId,
            name: room.trackName,
            singer: room.trackSinger,
            thumbnail: room.thumbnail,
            hlsUrl: room.hlsUrl,
          },
          positionSeconds: position,
          startAtServerMs: room.startAtServerMs,
          micActive,
          micProducerId,
        });
      } else if (msg.type === "start_track") {
        const startAtServerMs = Date.now() + 500;

        const room = await updateRoom(msg.roomId, {
          hlsUrl: msg.track.hlsUrl,
          trackId: msg.track._id,
          trackName: msg.track.name,
          trackSinger: msg.track.singer,
          thumbnail: msg.track.thumbnail,
          basePositionMs: 0,
          startAtServerMs,
          isPlaying: true,
        });

        setTimeout(() => {
          broadcastRoom(wss, msg.roomId, {
            type: "play_track",
            room,
            positionMs: 0,
            startAtServerMs,
          });
        }, 500);
      } else if (msg.type === "pause_track") {
        const room = await getRoom(msg.roomId);

        if (!room) return;

        const now = Date.now();

        let basePosition = room.basePositionMs;

        if (room.isPlaying) basePosition += now - room.startAtServerMs;

        const updated = await updateRoom(msg.roomId, {
          basePositionMs: basePosition,
          isPlaying: false,
        });

        broadcastRoom(wss, msg.roomId, {
          type: "pause_track",
          room: updated,
        });
      } else if (msg.type === "resume_track") {
        const startAtServerMs = Date.now() + 500;

        const room = await updateRoom(msg.roomId, {
          startAtServerMs,
          isPlaying: true,
        });

        broadcastRoom(wss, msg.roomId, {
          type: "resume_track",
          room,
        });
      } else if (msg.type === "leave_room") {
        removeMember(ws.roomId, ws);
        broadcastRoom(wss, ws.roomId, {
          type: "room_members",
          count: getRoomMembers(ws.roomId),
        });
        try {
          closePeer(ws.roomId, ws.peerId);
        } catch {}
      } else if (msg.type === "send_message") {
        let room = await getRoom(ws.roomId);
        if (!room) return;

        room = await updateRoom(ws.roomId, {
          message: msg.message,
          link: msg.link,
        });

        broadcastRoom(wss, ws.roomId, {
          type: "get_message",
          room: room,
        });
      } else if (msg.type === "set_volume") {
        broadcastRoom(wss, ws.roomId, {
          type: "get_volume",
          volume: msg.volume,
        });
      } else if (msg.type === "ms_get_router_rtp_capabilities") {
        send(ws, {
          type: "ms_router_rtp_capabilities",
          roomId: msg.roomId,
          rtpCapabilities: getRouterRtpCapabilities(),
          micActive: hasMicProducer(msg.roomId),
        });
      } else if (msg.type === "ms_create_send_transport") {
        try {
          const t = await createSendTransport(msg.roomId, ws.peerId);
          send(ws, {
            type: "ms_send_transport_created",
            params: {
              id: t.id,
              iceParameters: t.iceParameters,
              iceCandidates: t.iceCandidates,
              dtlsParameters: t.dtlsParameters,
            },
          });
        } catch (e) {
          console.error(e);
          send(ws, { type: "ms_error", action: "create_send_transport", error: String(e?.message || e) });
        }
      } else if (msg.type === "ms_create_recv_transport") {
        try {
          const t = await createRecvTransport(msg.roomId, ws.peerId);
          send(ws, {
            type: "ms_recv_transport_created",
            params: {
              id: t.id,
              iceParameters: t.iceParameters,
              iceCandidates: t.iceCandidates,
              dtlsParameters: t.dtlsParameters,
            },
          });
        } catch (e) {
          console.error(e);
          send(ws, { type: "ms_error", action: "create_recv_transport", error: String(e?.message || e) });
        }
      } else if (msg.type === "ms_connect_transport") {
        try {
          await connectTransport(msg.roomId, ws.peerId, msg.direction, msg.dtlsParameters);
          send(ws, { type: "ms_transport_connected", direction: msg.direction });
        } catch (e) {
          console.error(e);
          send(ws, { type: "ms_error", action: "connect_transport", error: String(e?.message || e) });
        }
      } else if (msg.type === "ms_produce_mic") {
        try {
          const producer = await produceMic(msg.roomId, ws.peerId, msg.kind, msg.rtpParameters);

          // ACK to producer
          send(ws, { type: "ms_mic_produced", producerId: producer.id });

          // OPTIONAL: persist mic state if you want
          // await updateRoom(msg.roomId, { micActive: true });

          // notify room
          broadcastRoom(wss, msg.roomId, { type: "mic_started", producerId: producer.id });
        } catch (e) {
          console.error(e);
          send(ws, { type: "ms_error", action: "produce_mic", error: String(e?.message || e) });
        }
      } else if (msg.type === "ms_close_mic") {
        try {
          closeMic(msg.roomId, ws.peerId);

          // OPTIONAL: persist mic state if you want
          // await updateRoom(msg.roomId, { micActive: false });

          broadcastRoom(wss, msg.roomId, { type: "mic_stopped" });
        } catch (e) {
          console.error(e);
          send(ws, { type: "ms_error", action: "close_mic", error: String(e?.message || e) });
        }
      } else if (msg.type === "ms_consume_mic") {
        try {
          const consumer = await consumeMic(msg.roomId, ws.peerId, msg.rtpCapabilities);
          send(ws, {
            type: "ms_mic_consumed",
            params: {
              id: consumer.id,
              producerId: consumer.producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
            },
          });
        } catch (e) {
          // اگر میکروفون فعال نیست، این ارور طبیعی است
          send(ws, { type: "ms_error", action: "consume_mic", error: String(e?.message || e) });
        }
      } else if (msg.type === "ms_resume_consumer") {
        try {
          await resumeConsumer(msg.roomId, ws.peerId, msg.consumerId);
          send(ws, { type: "ms_consumer_resumed", consumerId: msg.consumerId });
        } catch (e) {
          console.error(e);
          send(ws, { type: "ms_error", action: "resume_consumer", error: String(e?.message || e) });
        }
      }
    });
  });
}

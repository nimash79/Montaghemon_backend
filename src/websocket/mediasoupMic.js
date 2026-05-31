// websocket/mediasoupMic.js
import * as mediasoup from "mediasoup";

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
];

let worker;
let router;

// roomId => { producerId, producerPeerId, producer, peers: Map(peerId => { sendTransport, recvTransport, consumers: Map }) }
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      producerPeerId: null,
      producer: null,
      peers: new Map(),
    });
  }
  return rooms.get(roomId);
}

function ensurePeer(roomId, peerId) {
  const room = getRoom(roomId);
  if (!room.peers.has(peerId)) {
    room.peers.set(peerId, {
      sendTransport: null,
      recvTransport: null,
      consumers: new Map(),
    });
  }
  return room.peers.get(peerId);
}

export async function initMediasoupMic() {
  worker = await mediasoup.createWorker({
    rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT || 40000),
    rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT || 49999),
    logLevel: "warn",
  });

  worker.on("died", () => {
    console.error("mediasoup worker died");
    process.exit(1);
  });

  router = await worker.createRouter({ mediaCodecs });
  console.log("mediasoup (mic) router ready");
}

export function getRouterRtpCapabilities() {
  return router.rtpCapabilities;
}

export async function createWebRtcTransport() {
  const transport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: "udp",
        ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
      },
      {
        protocol: "tcp",
        ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  return transport;
}

export async function createSendTransport(roomId, peerId) {
  const peer = ensurePeer(roomId, peerId);
  const transport = await createWebRtcTransport();
  peer.sendTransport = transport;
  return transport;
}

export async function createRecvTransport(roomId, peerId) {
  const peer = ensurePeer(roomId, peerId);
  const transport = await createWebRtcTransport();
  peer.recvTransport = transport;
  return transport;
}

export async function connectTransport(roomId, peerId, direction, dtlsParameters) {
  const peer = ensurePeer(roomId, peerId);
  const transport = direction === "send" ? peer.sendTransport : peer.recvTransport;
  if (!transport) throw new Error("transport not found");
  await transport.connect({ dtlsParameters });
}

export async function produceMic(roomId, peerId, kind, rtpParameters) {
  const room = getRoom(roomId);
  const peer = ensurePeer(roomId, peerId);

  if (!peer.sendTransport) throw new Error("sendTransport not found");

  // فقط یک mic producer برای هر room (آخرین نفر override می‌کند)
  if (room.producer) {
    try { room.producer.close(); } catch {}
    room.producer = null;
    room.producerPeerId = null;
  }

  const producer = await peer.sendTransport.produce({ kind, rtpParameters });
  room.producer = producer;
  room.producerPeerId = peerId;

  producer.on("transportclose", () => {
    try { producer.close(); } catch {}
  });

  return producer;
}

export function hasMicProducer(roomId) {
  const room = rooms.get(roomId);
  return Boolean(room?.producer);
}

export function getMicProducerId(roomId) {
  const room = rooms.get(roomId);
  return room?.producer?.id || null;
}

export async function consumeMic(roomId, peerId, rtpCapabilities) {
  const room = getRoom(roomId);
  const peer = ensurePeer(roomId, peerId);

  if (!room.producer) throw new Error("no mic producer");
  if (!peer.recvTransport) throw new Error("recvTransport not found");

  if (!router.canConsume({ producerId: room.producer.id, rtpCapabilities })) {
    throw new Error("cannot consume");
  }

  const consumer = await peer.recvTransport.consume({
    producerId: room.producer.id,
    rtpCapabilities,
    paused: true,
  });

  peer.consumers.set(consumer.id, consumer);

  consumer.on("producerclose", () => {
    peer.consumers.delete(consumer.id);
    try { consumer.close(); } catch {}
  });

  consumer.on("transportclose", () => {
    peer.consumers.delete(consumer.id);
  });

  return consumer;
}

export async function resumeConsumer(roomId, peerId, consumerId) {
  const peer = ensurePeer(roomId, peerId);
  const consumer = peer.consumers.get(consumerId);
  if (!consumer) throw new Error("consumer not found");
  await consumer.resume();
}

export function closeMic(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room?.producer) return;
  // فقط همان producerPeerId اجازه close دارد (اختیاری)
  if (room.producerPeerId && room.producerPeerId !== peerId) return;

  try { room.producer.close(); } catch {}
  room.producer = null;
  room.producerPeerId = null;
}

export function closePeer(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const peer = room.peers.get(peerId);
  if (!peer) return;

  try { peer.sendTransport?.close(); } catch {}
  try { peer.recvTransport?.close(); } catch {}
  for (const c of peer.consumers.values()) {
    try { c.close(); } catch {}
  }
  room.peers.delete(peerId);

  if (room.producerPeerId === peerId) {
    closeMic(roomId, peerId);
  }

  if (room.peers.size === 0 && !room.producer) {
    rooms.delete(roomId);
  }
}
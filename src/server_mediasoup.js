const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mediasoup = require("mediasoup");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

// ====== mediasoup globals ======
let worker;
let router;

// یک Producer (صدای گوینده) برای کل اتاق
let audioProducer = null;

// نگهداری peerها
// peer = { ws, transports: Map, producers: Map, consumers: Map, rtpCapabilities, isBroadcaster }
const peers = new Map();

// === mediasoup config ===
const mediasoupConfig = {
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
  },
  router: {
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      // ip: 0.0.0.0 یعنی روی همه اینترفیس‌ها گوش بده
      // announcedIp را IP عمومی/VPS خودتان بگذارید (مهم!)
      { ip: "0.0.0.0", announcedIp: process.env.ANNOUNCED_IP || null },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,

    // برای production، TURN را سمت کلاینت می‌دهید (iceServers)
    // mediasoup خودش STUN/TURN client-side است.
  },
};

async function initMediasoup() {
  worker = await mediasoup.createWorker(mediasoupConfig.worker);

  worker.on("died", () => {
    console.error("mediasoup worker died, exiting...");
    process.exit(1);
  });

  router = await worker.createRouter({ mediaCodecs: mediasoupConfig.router.mediaCodecs });
  console.log("mediasoup router created");
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptWs = null) {
  for (const { ws } of peers.values()) {
    if (ws !== exceptWs && ws.readyState === WebSocket.OPEN) {
      send(ws, msg);
    }
  }
}

async function createWebRtcTransport() {
  const transport = await router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

  // برای دیباگ
  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") transport.close();
  });

  return transport;
}

wss.on("connection", async (ws) => {
  const peerId = cryptoRandomId();
  peers.set(peerId, {
    ws,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    rtpCapabilities: null,
    isBroadcaster: false,
  });

  send(ws, { action: "welcome", peerId });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    const peer = peers.get(peerId);
    if (!peer) return;

    try {
      switch (msg.action) {
        case "getRouterRtpCapabilities": {
          send(ws, {
            action: "routerRtpCapabilities",
            data: router.rtpCapabilities,
          });
          break;
        }

        case "setRole": {
          peer.isBroadcaster = msg.data?.role === "broadcaster";
          send(ws, { action: "roleSet", data: { role: peer.isBroadcaster ? "broadcaster" : "viewer" } });

          // اگر بیننده وارد شد و producer موجود است، بهش اطلاع بده
          if (!peer.isBroadcaster && audioProducer) {
            send(ws, { action: "newProducer", data: { producerId: audioProducer.id } });
          }
          break;
        }

        case "createWebRtcTransport": {
          const { direction } = msg.data; // "send" or "recv"
          const transport = await createWebRtcTransport();

          peer.transports.set(transport.id, transport);

          send(ws, {
            action: "webRtcTransportCreated",
            data: {
              direction,
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
          });
          break;
        }

        case "connectTransport": {
          const { transportId, dtlsParameters } = msg.data;
          const transport = peer.transports.get(transportId);
          if (!transport) throw new Error("transport not found");
          await transport.connect({ dtlsParameters });
          send(ws, { action: "transportConnected", data: { transportId } });
          break;
        }

        case "produce": {
          // فقط گوینده اجازه produce
          if (!peer.isBroadcaster) throw new Error("only broadcaster can produce");

          const { transportId, kind, rtpParameters } = msg.data;
          const transport = peer.transports.get(transportId);
          if (!transport) throw new Error("transport not found");

          const producer = await transport.produce({ kind, rtpParameters });
          peer.producers.set(producer.id, producer);

          // این نمونه: فقط یک producer صوتی را به عنوان producer اصلی نگه می‌داریم
          if (kind === "audio") {
            audioProducer = producer;
            // به همه بیننده‌ها خبر بده producer آماده است
            broadcast({ action: "newProducer", data: { producerId: producer.id } }, ws);
          }

          producer.on("transportclose", () => {
            peer.producers.delete(producer.id);
            if (audioProducer?.id === producer.id) audioProducer = null;
          });

          send(ws, { action: "produced", data: { producerId: producer.id } });
          break;
        }

        case "consume": {
          const { transportId, producerId, rtpCapabilities } = msg.data;

          peer.rtpCapabilities = rtpCapabilities;

          if (!router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error("cannot consume");
          }

          const transport = peer.transports.get(transportId);
          if (!transport) throw new Error("transport not found");

          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // ابتدا paused، بعد resume
          });

          peer.consumers.set(consumer.id, consumer);

          consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
          consumer.on("producerclose", () => {
            peer.consumers.delete(consumer.id);
            send(ws, { action: "producerClosed", data: { producerId } });
          });

          send(ws, {
            action: "consumed",
            data: {
              consumerId: consumer.id,
              producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
            },
          });
          break;
        }

        case "resume": {
          const { consumerId } = msg.data;
          const consumer = peer.consumers.get(consumerId);
          if (!consumer) throw new Error("consumer not found");
          await consumer.resume();
          send(ws, { action: "resumed", data: { consumerId } });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      send(ws, { action: "error", data: { message: err.message } });
    }
  });

  ws.on("close", () => {
    const peer = peers.get(peerId);
    if (!peer) return;

    // cleanup transports/producers/consumers
    for (const t of peer.transports.values()) t.close();
    for (const p of peer.producers.values()) p.close();
    for (const c of peer.consumers.values()) c.close();

    peers.delete(peerId);

    // اگر گوینده قطع شد و producer اصلی بود:
    if (audioProducer && peer.producers.has(audioProducer.id)) {
      audioProducer = null;
      broadcast({ action: "producerClosed", data: { producerId: audioProducer?.id } });
    }
  });
});

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

initMediasoup().then(() => {
  server.listen(PORT, () => console.log(`Server listening on :${PORT}`));
});
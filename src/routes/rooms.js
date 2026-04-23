import express from "express";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

import Room from "../database/models/room.js";
import { getRoomMembers } from "../presence/roomPresence.js";
import { requireAdmin } from "../lib/adminAuth.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    let rooms = await Room.find(
      {},
      {
        _id: 0,
        roomId: 1,
        name: 1,
        logo: 1,
        city: 1,
        thumbnail: 1,
        trackName: 1,
        isPlaying: 1,
        updatedAt: 1,
      },
    ).sort({ updatedAt: -1 });

    rooms = rooms.map((r) => ({
      ...r.toObject(),
      logo: PUBLIC_BASE_URL + r.logo,
      members: getRoomMembers(r.roomId.toString()),
    }));

    res.json({
      ok: true,
      rooms,
    });
  } catch (error) {
    console.error("Get rooms error:", error);
    res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

router.post("/create", requireAdmin, async (req, res) => {
  try {
    const { name, password, logo, city } = req.body;

    if (!name)
      return res.status(400).json({ error: "name is required" });
    if (!password)
      return res.status(400).json({ error: "password is required" });

    const lastRoom = await Room.findOne().sort({ roomId: -1 });
    const roomId = lastRoom ? lastRoom.roomId + 1 : 1;

    let hashedPassword = null;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const room = await Room.create({
      roomId,
      name,
      password: hashedPassword,
      logo,
      city,
    });

    return res.status(201).json({
      ok: true,
      roomId: room.roomId,
      name: room.name,
      logo,
      city,
    });
  } catch (error) {
    console.error("Create room error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/pass", async (req, res) => {
  try {
    const { roomId, password } = req.body;

    const room = await Room.findOne({ roomId });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const ok = await bcrypt.compare(password, room.password);
    if (!ok) return res.status(403).json({ error: "wrong password" });

    return res.status(201).json({
      ok: true,
      roomId: room.roomId,
      name: room.name,
    });
  } catch (error) {
    console.error("Pass room error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

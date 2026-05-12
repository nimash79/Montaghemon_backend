import express from "express";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

import { Singer } from "../database/models/index.js";
import { getRoomMembers } from "../presence/roomPresence.js";
import { requireAdmin } from "../lib/adminAuth.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const singers = await Singer.find({}).sort({updatdAt: -1});
    
    res.json({
      ok: true,
      total: singers.length,
      singers,
    });
  } catch (error) {
    console.error("Get singers error:", error);
    res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

// router.post("/create", requireAdmin, async (req, res) => {
//   try {
//     const { category, name, singer, durationMs, mtimeMs, size, thumbnail, hlsRel, disabled } = req.body;

//     if (!name) return res.status(400).json({ error: "name is required" });
//     if (!password)
//       return res.status(400).json({ error: "password is required" });

//     const lastRoom = await Room.findOne().sort({ roomId: -1 });
//     const roomId = lastRoom ? lastRoom.roomId + 1 : 1;

//     let hashedPassword = null;

//     if (password) {
//       hashedPassword = await bcrypt.hash(password, 10);
//     }

//     const room = await Room.create({
//       roomId,
//       name,
//       password: hashedPassword,
//       logo,
//       city,
//     });

//     return res.status(201).json({
//       ok: true,
//       roomId: room.roomId,
//       name: room.name,
//       logo,
//       city,
//     });
//   } catch (error) {
//     console.error("Create room error:", error);
//     return res.status(500).json({ error: "Server error" });
//   }
// });

export default router;

import express from "express";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

import { Room, Track } from "../database/models/index.js";
import { getRoomMembers } from "../presence/roomPresence.js";
import { requireAdmin } from "../lib/adminAuth.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    let tracks = await Track.find({})
      .populate("singers")
      .sort({ updatedAt: -1 });

    tracks = tracks.map((t) => ({
      ...t.toObject(),
      thumbnail: PUBLIC_BASE_URL + t.thumbnail,
      hlsUrl: PUBLIC_BASE_URL + t.hlsRel,
    }));

    tracks = tracks.map((t) => ({
      ...t,
      singer: (t.singers || [])
        .map((s) => s?.name)
        .filter(Boolean)
        .join("، "), // یا ", "
    }));

    // const tracksWithId = tracks.reverse().map((t, i) => ({
    //   ...t,
    //   id: i,
    // }));

    res.json({
      ok: true,
      total: tracks.length,
      tracks,
    });
  } catch (error) {
    console.error("Get tracks error:", error);
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

router.post("/add-favorite", async (req, res) => {
  try {
    const { trackId, roomId } = req.body;

    // validation
    if (!trackId) return res.status(400).json({ error: "trackId is required" });

    if (!roomId) return res.status(400).json({ error: "roomId is required" });

    // check room
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

    // check track
    const track = await Track.findById(trackId);
    if (!track) return res.status(404).json({ error: "Track not found" });

    // check duplicate
    const alreadyFavorite = room.favorites.some(
      (fav) => fav.toString() === trackId,
    );

    if (alreadyFavorite) {
      return res.status(409).json({
        error: "Track already in favorites",
      });
    }

    // add favorite
    await Room.findByIdAndUpdate(
      roomId,
      { $addToSet: { favorites: trackId } },
      { new: true },
    );

    return res.status(201).json({
      ok: true,
      message: "Track added to favorites",
      favorites: room.favorites,
    });
  } catch (error) {
    console.error("Add favorite error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/remove-favorite", async (req, res) => {
  try {
    const { trackId, roomId } = req.body;

    // validation
    if (!trackId) return res.status(400).json({ error: "trackId is required" });

    if (!roomId) return res.status(400).json({ error: "roomId is required" });

    // check room
    const room = await Room.findById(roomId);

    if (!room) return res.status(404).json({ error: "Room not found" });

    // check track exists in favorites
    const isFavorite = room.favorites.some((fav) => fav.toString() === trackId);

    if (!isFavorite) {
      return res.status(404).json({
        error: "Track is not in favorites",
      });
    }

    // remove favorite
    await Room.findByIdAndUpdate(
      roomId,
      {
        $pull: { favorites: trackId },
      },
      { new: true },
    );

    return res.status(200).json({
      ok: true,
      message: "Track removed from favorites",
      favorites: room.favorites,
    });
  } catch (error) {
    console.error("Remove favorite error:", error);

    return res.status(500).json({
      error: "Server error",
    });
  }
});

export default router;

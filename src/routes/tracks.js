import express from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

import { Room, Track } from "../database/models/index.js";
import { getRoomMembers } from "../presence/roomPresence.js";
import { requireAdmin } from "../lib/adminAuth.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const router = express.Router();

const thumbnailDir = "media/thumbnail";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, thumbnailDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);

    if (!req.body.hls) return cb(new Error("hls is required"));

    const fileName = `${req.body.hls}${ext}`;

    const fullPath = path.join(thumbnailDir, fileName);

    if (fs.existsSync(fullPath))
      return cb(new Error("Thumbnail already exists"));

    cb(null, fileName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only jpg, jpeg, png, webp files are allowed"));
    }
    cb(null, true);
  },
});

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
        .join("، "),
    }));

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

router.post("/create", requireAdmin, (req, res) => {
  upload.single("thumbnail")(req, res, async function (err) {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      const {
        categories,
        name,
        singers,
        durationMs,
        mtimeMs,
        hls,
        size,
        disabled,
      } = req.body;

      // validations
      if (!categories) {
        return res.status(400).json({ error: "category is required" });
      }

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" });
      }

      if (!hls || typeof hls !== "string") {
        return res.status(400).json({ error: "hls is required" });
      }

      if (!singers) {
        return res.status(400).json({ error: "singers is required" });
      }

      if (durationMs == null || isNaN(Number(durationMs))) {
        return res
          .status(400)
          .json({ error: "durationMs must be a valid number" });
      }

      if (mtimeMs == null || isNaN(Number(mtimeMs))) {
        return res
          .status(400)
          .json({ error: "mtimeMs must be a valid number" });
      }

      if (size == null || isNaN(Number(size))) {
        return res.status(400).json({ error: "size must be a valid number" });
      }

      const track = await Track.create({
        name: name.trim(),
        categories,
        singers,
        durationMs: Number(durationMs),
        mtimeMs: Number(mtimeMs),
        size: Number(size),
        thumbnail: `/thumbnail/${req.file ? hls + path.extname(req.file.filename) : "placeholder.webp"}`,
        hlsRel: `/hls/${hls}/index.m3u8`,
        disabled,
      });

      return res.status(201).json({
        ok: true,
        message: "Track created successfully",
        track,
      });
    } catch (error) {
      console.error("Create track error:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
});

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

router.get("/get-track/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const track = await Track.findById(id).populate("categories").populate("singers");

    res.json({
      ok: true,
      track,
    });
  } catch (error) {
    console.error("Get track error:", error);
    res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

router.post("/edit", requireAdmin, (req, res) => {
  upload.single("thumbnail")(req, res, async function (err) {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      const {
        id,
        categories,
        name,
        singers,
        durationMs,
        mtimeMs,
        hls,
        size,
        disabled,
      } = req.body;

      // validations
      if (!categories) {
        return res.status(400).json({ error: "category is required" });
      }

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" });
      }

      if (!hls || typeof hls !== "string") {
        return res.status(400).json({ error: "hls is required" });
      }

      if (!singers) {
        return res.status(400).json({ error: "singers is required" });
      }

      if (durationMs == null || isNaN(Number(durationMs))) {
        return res
          .status(400)
          .json({ error: "durationMs must be a valid number" });
      }

      if (mtimeMs == null || isNaN(Number(mtimeMs))) {
        return res
          .status(400)
          .json({ error: "mtimeMs must be a valid number" });
      }

      if (size == null || isNaN(Number(size))) {
        return res.status(400).json({ error: "size must be a valid number" });
      }

      const track = await Track.updateOne(
        {
          _id: id,
        },
        {
          $set: {
            name: name.trim(),
            categories,
            singers,
            durationMs: Number(durationMs),
            mtimeMs: Number(mtimeMs),
            size: Number(size),
            hlsRel: `/hls/${hls}/index.m3u8`,
            disabled,
          },
        },
      );

      return res.status(201).json({
        ok: true,
        message: "Track edited successfully",
        track,
      });
    } catch (error) {
      console.error("Edit track error:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
});

export default router;

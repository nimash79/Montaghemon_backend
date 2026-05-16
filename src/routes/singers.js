import express from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

import { Singer } from "../database/models/index.js";
import { getRoomMembers } from "../presence/roomPresence.js";
import { requireAdmin } from "../lib/adminAuth.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const router = express.Router();

const singersDir = "media/singers";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, singersDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);

    const fullPath = path.join(singersDir, file.originalname);

    if (fs.existsSync(fullPath)) return cb(new Error("Image already exists"));

    cb(null, file.originalname);
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

router.post("/create", requireAdmin, async (req, res) => {
  upload.single("image")(req, res, async function (err) {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
    try {
      const { name, description } = req.body;

      if (!name) return res.status(400).json({ error: "name is required" });

      const singer = await Singer.create({
        name,
        description,
        image: req.file ? `/logo/${req.file.originalname}` : "/singers/default.png",
      });

      return res.status(201).json({
        ok: true,
        name: singer.name,
        description: singer.description,
        logo: req.file ? `/logo/${req.file.originalname}` : "/singers/default.png",
      });
    } catch (error) {
      console.error("Create singer error:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
});

export default router;

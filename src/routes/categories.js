import express from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

import { Category } from "../database/models/index.js";
import { getRoomMembers } from "../presence/roomPresence.js";
import { requireAdmin } from "../lib/adminAuth.js";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const router = express.Router();

const categoriesDir = "media/categories";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, categoriesDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);

    if (!req.body.hls)
      return cb(new Error("hls is required"));

    const fileName = `${req.body.hls}${ext}`;

    const fullPath = path.join(categoriesDir, fileName);

    if (fs.existsSync(fullPath))
      return cb(new Error("Image already exists"));

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
    const categories = await Category.find({})
      .sort({ updatedAt: -1 });

    res.json({
      ok: true,
      total: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

export default router;

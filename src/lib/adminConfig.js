import fs from "fs";
import { readJsonSafe, writeJsonAtomic } from "./util.js";

export function loadAdminConfig(path) {
  return readJsonSafe(path, { order: [], disabled: [] });
}

export function saveAdminConfig(path, cfg) {
  writeJsonAtomic(path, cfg);
}

export function normalizeAdminConfig(cfg) {
  return {
    order: Array.isArray(cfg?.order) ? cfg.order : [],
    disabled: Array.isArray(cfg?.disabled) ? cfg.disabled : []
  };
}
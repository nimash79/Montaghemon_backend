import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema(
  {
    roomId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
    },

    logo: {
      type: String,
      default: "/logo/default.webp",
    },

    city: {
      type: String,
      default: "",
    },

    message: {
      type: String,
      default: "",
    },

    password: {
      type: String,
      default: null,
    },

    hlsUrl: {
      type: String,
      default: "",
    },

    trackId: {
      type: Number,
      default: 0,
    },

    trackName: {
      type: String,
      default: "",
    },

    trackSinger: {
      type: String,
      default: "",
    },

    thumbnail: {
      type: String,
      default: "",
    },

    basePositionMs: {
      type: Number,
      default: 0,
    },

    startAtServerMs: {
      type: Number,
      default: 0,
    },

    isPlaying: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Room = mongoose.model("Room", RoomSchema);

export default Room;
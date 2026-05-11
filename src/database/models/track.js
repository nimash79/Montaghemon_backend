import mongoose from "mongoose";

const TrackSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    singers: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Singer", index: true },
    ],
    durationMs: {
      type: Number,
      default: 0,
    },
    mtimeMs: {
      type: Number,
      default: 0,
    },
    size: {
      type: Number,
      default: 0,
    },
    thumbnail: {
      type: String,
      default: "",
    },
    hlsRel: {
      type: String,
      default: "",
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

const Track = mongoose.model("Track", TrackSchema);
export default Track;

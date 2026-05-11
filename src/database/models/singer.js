import mongoose from "mongoose";

const SingerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    image: {
      type: String,
      default: "/singers/default.png",
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

const Singer = mongoose.model("Singer", SingerSchema);

export default Singer;

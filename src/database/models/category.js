import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    image: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);



const Category = mongoose.model("Category", CategorySchema);
export default Category;

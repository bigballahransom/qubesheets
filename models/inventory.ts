import mongoose, { Schema, Document, Model, models } from "mongoose";

// Base interface for Inventory Item
export interface IInventoryBase {
  name?: string;                // Name of the inventory item
  parent_class: string;         // Parent class/category (e.g., "TVs", "Air_Conditioner")
  weight: number;               // Weight of the item
  cubic_feet: number;           // Cubic feet
  tags: string[];               // List of descriptive tags
  image: string;                // Image path or URL
}

// Extending the Inventory interface with Mongoose Document
export interface IInventory extends IInventoryBase, Document {
  _id: mongoose.Types.ObjectId; // Mongoose ObjectId
  createdAt: Date;
  updatedAt: Date;
}

// Document methods (instance-level methods)
interface IInventoryMethods {
  getItemDetails(): IInventoryBase;
}

// Static methods for Inventory model
interface IInventoryStatics {
  getAllItems(): Promise<IInventory[]>;
}

// Combined Inventory Document Interface
export interface IInventoryDocument extends IInventory, IInventoryMethods {}
interface IInventoryModel extends Model<IInventoryDocument>, IInventoryStatics {}

// Define Inventory Schema
const InventorySchema = new Schema<IInventoryDocument>(
  {
    name: { type: String, required: false },             // Optional name field
    parent_class: { type: String, required: true },      // Required parent class/category
    weight: { type: Number, required: true },            // Required weight
    cubic_feet: { type: Number, required: true },        // Required cubic feet
    tags: { type: [String], default: [] },               // Array of tags
    image: { type: String, required: true },             // Path/URL to the image
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
    collection: "inventory",
  }
);

// Instance method to get item details
InventorySchema.methods.getItemDetails = function (): IInventoryBase {
  return {
    name: this.name,
    parent_class: this.parent_class,
    weight: this.weight,
    cubic_feet: this.cubic_feet,
    tags: this.tags,
    image: this.image,
  };
};

// Static method to get all inventory items
InventorySchema.statics.getAllItems = async function () {
  try {
    const items = await this.find().sort({ createdAt: -1 }).lean();
    return items.map((item: IInventory) => ({
      ...item,
      _id: item._id.toString(),
    }));
  } catch (error) {
    console.error("Error fetching inventory items:", error);
    throw error;
  }
};

// Export the Inventory Model
export const Inventory =
  (models.Inventory as IInventoryModel) ||
  mongoose.model<IInventoryDocument, IInventoryModel>("Inventory", InventorySchema);
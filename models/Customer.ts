import mongoose, { Schema, Document, Model, models } from "mongoose";

// Base interface for Customer
export interface ICustomerBase {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveDate: Date;
  referralSource: string;
  projectId?: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
}

// Extending the Customer interface with Mongoose Document
export interface ICustomer extends ICustomerBase, Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// Document methods (instance-level methods)
interface ICustomerMethods {
  getDisplayName(): string;
  getContactInfo(): { email: string; phone: string };
}

// Static methods for Customer model
interface ICustomerStatics {
  findByOrganization(organizationId: mongoose.Types.ObjectId): Promise<ICustomer[]>;
  findByUser(userId: mongoose.Types.ObjectId): Promise<ICustomer[]>;
}

// Combined Customer Document Interface
export interface ICustomerDocument extends ICustomer, ICustomerMethods {}
interface ICustomerModel extends Model<ICustomerDocument>, ICustomerStatics {}

// Define Customer Schema
const CustomerSchema = new Schema<ICustomerDocument>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    moveDate: { type: Date, required: true },
    referralSource: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: false },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: "customers",
  }
);

// Instance method to get display name
CustomerSchema.methods.getDisplayName = function (): string {
  return `${this.firstName} ${this.lastName}`;
};

// Instance method to get contact info
CustomerSchema.methods.getContactInfo = function (): { email: string; phone: string } {
  return {
    email: this.email,
    phone: this.phone,
  };
};

// Static method to find customers by organization
CustomerSchema.statics.findByOrganization = async function (organizationId: mongoose.Types.ObjectId) {
  try {
    return await this.find({ organizationId }).sort({ createdAt: -1 });
  } catch (error) {
    console.error("Error fetching customers by organization:", error);
    throw error;
  }
};

// Static method to find customers by user
CustomerSchema.statics.findByUser = async function (userId: mongoose.Types.ObjectId) {
  try {
    return await this.find({ userId }).sort({ createdAt: -1 });
  } catch (error) {
    console.error("Error fetching customers by user:", error);
    throw error;
  }
};

// Indexes
CustomerSchema.index({ organizationId: 1 });
CustomerSchema.index({ userId: 1 });
CustomerSchema.index({ email: 1 });
CustomerSchema.index({ firstName: 1, lastName: 1 });

// Export the Customer Model
export const Customer =
  (models.Customer as ICustomerModel) ||
  mongoose.model<ICustomerDocument, ICustomerModel>("Customer", CustomerSchema);
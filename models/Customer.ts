import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
  userId: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema: Schema = new Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: false },
    phone: { type: String, required: false },
    company: { type: String, required: false },
    address: { type: String, required: false },
    notes: { type: String, required: false },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
  },
  { timestamps: true }
);

// Compound index for efficient org/user queries
CustomerSchema.index({ organizationId: 1, userId: 1 });

// Virtual for full name
CustomerSchema.virtual('name').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Ensure virtuals are included in JSON output
CustomerSchema.set('toJSON', { virtuals: true });
CustomerSchema.set('toObject', { virtuals: true });

export default mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveDate: Date;
  referralSource: string;
  projectId?: mongoose.Schema.Types.ObjectId;
  userId: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema: Schema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please provide a valid phone number']
    },
    moveDate: {
      type: Date,
      required: [true, 'Move date is required']
    },
    referralSource: {
      type: String,
      required: [true, 'Referral source is required'],
      enum: {
        values: [
          'Google Search',
          'Social Media',
          'Referral',
          'Website',
          'Advertisement',
          'Cold Call',
          'Other'
        ],
        message: 'Please select a valid referral source'
      }
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      index: true
    },
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      index: true
    },
    organizationId: {
      type: String,
      index: true
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Create indexes for better query performance
CustomerSchema.index({ userId: 1, organizationId: 1 });
CustomerSchema.index({ email: 1 });
CustomerSchema.index({ moveDate: 1 });
CustomerSchema.index({ createdAt: -1 });

// Virtual for full name
CustomerSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

export default mongoose.models.Customer || mongoose.model<ICustomer>('Customer', CustomerSchema);
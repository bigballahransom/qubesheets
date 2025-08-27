// models/Branding.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IBranding extends Document {
  // Either userId for personal accounts OR organizationId for org accounts
  userId?: string;
  organizationId?: string;
  
  // Branding fields
  companyName: string;
  companyLogo?: string; // URL or base64 string
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const BrandingSchema: Schema = new Schema(
  {
    userId: { 
      type: String, 
      required: false, 
      index: true,
      // Ensure only one branding per user
      unique: true,
      sparse: true 
    },
    organizationId: { 
      type: String, 
      required: false, 
      index: true,
      // Ensure only one branding per organization
      unique: true,
      sparse: true 
    },
    companyName: { 
      type: String, 
      required: true 
    },
    companyLogo: { 
      type: String, 
      required: false 
    },
  },
  { 
    timestamps: true,
    // Add compound index to ensure either userId OR organizationId is present
    index: [
      { userId: 1, organizationId: 1 }
    ]
  }
);

// Pre-save validation to ensure either userId OR organizationId is set, but not both
BrandingSchema.pre('save', function(next) {
  const branding = this as IBranding;
  
  // Ensure exactly one of userId or organizationId is set
  const hasUserId = !!branding.userId;
  const hasOrgId = !!branding.organizationId;
  
  if (!hasUserId && !hasOrgId) {
    return next(new Error('Either userId or organizationId must be provided'));
  }
  
  if (hasUserId && hasOrgId) {
    return next(new Error('Cannot set both userId and organizationId'));
  }
  
  next();
});

export default mongoose.models.Branding || mongoose.model<IBranding>('Branding', BrandingSchema);
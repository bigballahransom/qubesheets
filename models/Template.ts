// models/Template.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ITemplate extends Document {
  // Either userId for personal accounts OR organizationId for org accounts
  userId?: string;
  organizationId?: string;
  
  // Template identification
  templateType: 'customer_instructions';
  name: string;
  
  // Template content
  content: string;
  
  // Metadata
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateSchema: Schema = new Schema(
  {
    userId: { 
      type: String, 
      required: false, 
      index: true,
      sparse: true 
    },
    organizationId: { 
      type: String, 
      required: false, 
      index: true,
      sparse: true 
    },
    templateType: {
      type: String,
      required: true,
      enum: ['customer_instructions'],
      index: true
    },
    name: { 
      type: String, 
      required: true 
    },
    content: { 
      type: String, 
      required: true 
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { 
    timestamps: true,
    // Compound index to ensure one template per type per user/org
    index: [
      { templateType: 1, userId: 1 },
      { templateType: 1, organizationId: 1 }
    ]
  }
);

// Pre-save validation to ensure either userId OR organizationId is set, but not both
TemplateSchema.pre('save', function(next) {
  const template = this as unknown as ITemplate;
  
  // Ensure exactly one of userId or organizationId is set
  const hasUserId = !!template.userId;
  const hasOrgId = !!template.organizationId;
  
  if (!hasUserId && !hasOrgId) {
    return next(new Error('Either userId or organizationId must be provided'));
  }
  
  if (hasUserId && hasOrgId) {
    return next(new Error('Cannot set both userId and organizationId'));
  }
  
  next();
});

export default mongoose.models.Template || mongoose.model<ITemplate>('Template', TemplateSchema);
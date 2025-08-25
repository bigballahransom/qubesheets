// models/Project.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  name: string;
  userId: string;
  organizationId?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    description: { type: String },
  },
  { timestamps: true }
);

export default mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);


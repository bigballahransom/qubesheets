// models/SmartMovingIntegration.js - Model for storing SmartMoving API credentials
import mongoose from 'mongoose';

const SmartMovingIntegrationSchema = new mongoose.Schema({
  // Clerk user identification
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // Clerk organization identification (required for multi-tenancy)
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  
  // SmartMoving API credentials
  smartMovingClientId: {
    type: String,
    required: true
  },
  
  smartMovingApiKey: {
    type: String,
    required: true
  }
}, {
  timestamps: true // Automatically manage createdAt and updatedAt
});

// Ensure only one integration per organization
SmartMovingIntegrationSchema.index(
  { organizationId: 1 }, 
  { unique: true }
);

// Export the model
const SmartMovingIntegration = mongoose.models.SmartMovingIntegration || 
  mongoose.model('SmartMovingIntegration', SmartMovingIntegrationSchema);

export default SmartMovingIntegration;
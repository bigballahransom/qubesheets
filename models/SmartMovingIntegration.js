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
  },

  // Default values for lead conversion
  defaultTariffId: {
    type: String,
    required: false
  },

  defaultReferralSourceId: {
    type: String,
    required: false
  },

  defaultMoveSizeId: {
    type: String,
    required: false
  },

  defaultSalesPersonId: {
    type: String,
    required: false
  },

  defaultServiceTypeId: {
    type: Number,
    default: 1 // 1 = Moving
  },

  // Auto-send customer upload link when opportunity is created
  sendUploadLinkOnCreate: {
    type: Boolean,
    default: false
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
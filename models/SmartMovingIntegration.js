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
  },

  // Auto-sync crew review link to SmartMoving job notes during inventory sync
  syncCrewLinkOnSync: {
    type: Boolean,
    default: true
  },

  // Include media vault links (view + upload) in the crew notes during inventory sync
  syncVaultLinksOnSync: {
    type: Boolean,
    default: true
  },

  // Include AI walkthrough summaries (summary, packing notes, customer statements
  // from video/virtual walkthroughs) in the internal notes during inventory sync
  syncAiSummariesOnSync: {
    type: Boolean,
    default: true
  },

  // Which SmartMoving webhook records create projects. The opportunity-created
  // webhook fires for both new leads (opportunity-status 0) and new
  // opportunities (status 3); some teams only want one or the other.
  webhookRecordFilter: {
    type: String,
    enum: ['opportunities_and_leads', 'opportunities_only', 'leads_only'],
    default: 'opportunities_and_leads'
  },

  // Automatically re-sync linked projects to SmartMoving shortly after their
  // inventory changes (debounced cron), keeping estimates 1:1 with QubeSheets.
  autoSyncOnChange: {
    type: Boolean,
    default: true
  },

  // Item categories the auto-sync sends (same choices as the manual sync UI)
  autoSyncOption: {
    type: String,
    enum: ['items_only', 'items_and_existing', 'all'],
    default: 'items_only'
  },

  // Per-org sync lease (see lib/smartmoving/syncLock.ts) — epoch ms until
  // which an in-flight sync holds exclusivity; token identifies the holder.
  syncLockUntil: {
    type: Number,
    required: false
  },
  syncLockToken: {
    type: String,
    required: false
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
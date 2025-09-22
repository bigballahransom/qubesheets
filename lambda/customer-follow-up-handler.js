// lambda/customer-follow-up-handler.js
// AWS Lambda function for automated customer follow-up messages

const mongoose = require('mongoose');
const twilio = require('twilio');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;

// Define schemas inline (or import from shared package)
const ProjectSchema = new mongoose.Schema({
  name: String,
  customerName: String,
  phone: String,
  userId: String,
  organizationId: String,
  uploadLinkTracking: {
    lastSentAt: Date,
    lastSentTo: {
      customerName: String,
      customerPhone: String
    },
    uploadToken: String,
    totalSent: Number,
    firstFollowUpSent: Boolean,
    firstFollowUpSentAt: Date,
    secondFollowUpSent: Boolean,
    secondFollowUpSentAt: Date
  }
});

const OrganizationSettingsSchema = new mongoose.Schema({
  organizationId: String,
  enableCustomerFollowUps: Boolean,
  followUpDelayHours: Number
});

const CustomerUploadSchema = new mongoose.Schema({
  projectId: mongoose.Schema.Types.ObjectId,
  userId: String,
  organizationId: String,
  customerName: String,
  customerPhone: String,
  uploadToken: String,
  expiresAt: Date,
  isActive: Boolean
});

const ImageSchema = new mongoose.Schema({
  projectId: mongoose.Schema.Types.ObjectId,
  createdAt: Date
});

// Models
const Project = mongoose.models.Project || mongoose.model('Project', ProjectSchema);
const OrganizationSettings = mongoose.models.OrganizationSettings || mongoose.model('OrganizationSettings', OrganizationSettingsSchema);
const CustomerUpload = mongoose.models.CustomerUpload || mongoose.model('CustomerUpload', CustomerUploadSchema);
const Image = mongoose.models.Image || mongoose.model('Image', ImageSchema);

// Lambda handler
exports.handler = async (event, context) => {
  // Prevent Lambda timeout from keeping connection open
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    // Connect to MongoDB
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('Connected to MongoDB');
    }

    // Get current time
    const now = new Date();
    console.log(`Running follow-up check at ${now.toISOString()}`);

    // Find all projects that have sent upload links
    const projectsWithLinks = await Project.find({
      'uploadLinkTracking.lastSentAt': { $exists: true },
      'uploadLinkTracking.uploadToken': { $exists: true }
    }).lean();

    console.log(`Found ${projectsWithLinks.length} projects with upload links`);

    let followUpsSent = 0;
    let errors = [];

    // Process each project
    for (const project of projectsWithLinks) {
      try {
        // Skip if no tracking data
        if (!project.uploadLinkTracking || !project.uploadLinkTracking.lastSentAt) {
          continue;
        }

        // Get organization settings
        const orgSettings = await OrganizationSettings.findOne({
          organizationId: project.organizationId
        }).lean();

        // Skip if follow-ups are disabled for this org
        if (!orgSettings || !orgSettings.enableCustomerFollowUps) {
          console.log(`Follow-ups disabled for org ${project.organizationId}`);
          continue;
        }

        // Calculate hours since link was sent
        const hoursSinceSent = (now - new Date(project.uploadLinkTracking.lastSentAt)) / (1000 * 60 * 60);
        
        // Check if customer has uploaded any images
        const hasUploads = await Image.exists({
          projectId: project._id,
          createdAt: { $gt: project.uploadLinkTracking.lastSentAt }
        });

        // Skip if customer has already uploaded
        if (hasUploads) {
          console.log(`Project ${project._id} already has uploads, skipping`);
          continue;
        }

        // Determine which follow-up to send
        let shouldSendFollowUp = false;
        let followUpType = null;

        // First follow-up logic
        if (!project.uploadLinkTracking.firstFollowUpSent && 
            hoursSinceSent >= orgSettings.followUpDelayHours) {
          shouldSendFollowUp = true;
          followUpType = 'first';
        }
        // Second follow-up logic (double the delay hours)
        else if (!project.uploadLinkTracking.secondFollowUpSent && 
                 project.uploadLinkTracking.firstFollowUpSent &&
                 hoursSinceSent >= (orgSettings.followUpDelayHours * 2)) {
          shouldSendFollowUp = true;
          followUpType = 'second';
        }

        if (shouldSendFollowUp && followUpType) {
          // Get the upload link details
          const customerUpload = await CustomerUpload.findOne({
            projectId: project._id,
            uploadToken: project.uploadLinkTracking.uploadToken,
            isActive: true
          }).lean();

          if (!customerUpload) {
            console.log(`No active upload link found for project ${project._id}`);
            continue;
          }

          // Check if link is still valid
          if (new Date(customerUpload.expiresAt) < now) {
            console.log(`Upload link expired for project ${project._id}`);
            continue;
          }

          // Construct upload URL
          const uploadUrl = `${process.env.APP_URL}/customer-upload/${customerUpload.uploadToken}`;
          
          // Prepare follow-up message
          let message = '';
          if (followUpType === 'first') {
            message = `Hi ${project.uploadLinkTracking.lastSentTo.customerName}! Just a friendly reminder to upload photos of your items for your move. Your upload link: ${uploadUrl}`;
          } else {
            message = `Hi ${project.uploadLinkTracking.lastSentTo.customerName}! We haven't received your inventory photos yet. Please upload them soon so we can prepare your moving quote: ${uploadUrl}`;
          }

          // Send SMS
          try {
            await twilioClient.messages.create({
              body: message,
              from: twilioPhoneNumber,
              to: project.uploadLinkTracking.lastSentTo.customerPhone
            });

            console.log(`Sent ${followUpType} follow-up to ${project.uploadLinkTracking.lastSentTo.customerPhone} for project ${project._id}`);

            // Update project to mark follow-up as sent
            const updateData = {};
            if (followUpType === 'first') {
              updateData['uploadLinkTracking.firstFollowUpSent'] = true;
              updateData['uploadLinkTracking.firstFollowUpSentAt'] = now;
            } else {
              updateData['uploadLinkTracking.secondFollowUpSent'] = true;
              updateData['uploadLinkTracking.secondFollowUpSentAt'] = now;
            }

            await Project.findByIdAndUpdate(project._id, {
              $set: updateData
            });

            followUpsSent++;
          } catch (twilioError) {
            console.error(`Failed to send SMS for project ${project._id}:`, twilioError);
            errors.push({
              projectId: project._id,
              error: twilioError.message
            });
          }
        }
      } catch (projectError) {
        console.error(`Error processing project ${project._id}:`, projectError);
        errors.push({
          projectId: project._id,
          error: projectError.message
        });
      }
    }

    // Return summary
    const response = {
      success: true,
      timestamp: now.toISOString(),
      projectsChecked: projectsWithLinks.length,
      followUpsSent,
      errors: errors.length,
      errorDetails: errors
    };

    console.log('Follow-up check completed:', response);
    return response;

  } catch (error) {
    console.error('Lambda execution error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// Optional: Local testing
if (require.main === module) {
  // Load environment variables for local testing
  require('dotenv').config();
  
  // Run the handler
  exports.handler({}, { callbackWaitsForEmptyEventLoop: false })
    .then(result => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}
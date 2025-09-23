import crypto from 'crypto';
import { client, twilioPhoneNumber } from '@/lib/twilio';
import { replaceSMSVariables, DEFAULT_SMS_UPLOAD_TEMPLATE } from '@/lib/sms-template-helpers';
import CustomerUpload from '@/models/CustomerUpload';
import Project from '@/models/Project';
import OrganizationSettings from '@/models/OrganizationSettings';
import Branding from '@/models/Branding';
import connectMongoDB from '@/lib/mongodb';

export interface AuthContext {
  userId: string;
  organizationId: string | null;
  isPersonalAccount: boolean;
}

export interface UploadLinkResult {
  success: boolean;
  uploadToken?: string;
  uploadUrl?: string;
  expiresAt?: Date;
  smsDelivered?: boolean;
  error?: string;
  customerUploadId?: string;
}

/**
 * Generate a unique upload token
 */
export function generateUploadToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Get the correct base URL for the application
 */
function getBaseUrl(): string {
  // Production URL
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  
  // Development URL
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  
  // Fallback for development
  return 'http://localhost:3000';
}

/**
 * Create upload URL from token
 */
export function createUploadUrl(token: string): string {
  return `${getBaseUrl()}/customer-upload/${token}`;
}

/**
 * Create a CustomerUpload record in the database
 */
export async function createCustomerUploadRecord(params: {
  projectId: string;
  userId: string;
  organizationId?: string | null;
  customerName: string;
  customerPhone: string;
  uploadToken: string;
  expiresAt: Date;
}): Promise<any> {
  await connectMongoDB();
  
  const customerUploadData: any = {
    projectId: params.projectId,
    userId: params.userId,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    uploadToken: params.uploadToken,
    expiresAt: params.expiresAt,
    isActive: true,
  };
  
  // Only add organizationId if provided (for organization accounts)
  if (params.organizationId) {
    customerUploadData.organizationId = params.organizationId;
  }
  
  return await CustomerUpload.create(customerUploadData);
}

/**
 * Get SMS template for the organization or default
 */
export async function getSMSTemplate(authContext: AuthContext): Promise<string> {
  await connectMongoDB();
  
  let smsTemplate = DEFAULT_SMS_UPLOAD_TEMPLATE;
  
  if (!authContext.isPersonalAccount && authContext.organizationId) {
    const orgSettings = await OrganizationSettings.findOne({ 
      organizationId: authContext.organizationId 
    });
    if (orgSettings?.smsUploadLinkTemplate) {
      smsTemplate = orgSettings.smsUploadLinkTemplate;
    }
  }
  
  return smsTemplate;
}

/**
 * Get company name from branding settings
 */
export async function getCompanyName(authContext: AuthContext): Promise<string> {
  await connectMongoDB();
  
  let companyName = 'Your Moving Company';
  
  try {
    const brandingQuery = authContext.isPersonalAccount 
      ? { userId: authContext.userId }
      : { organizationId: authContext.organizationId };
    
    const branding = await Branding.findOne(brandingQuery);
    if (branding?.companyName) {
      companyName = branding.companyName;
    }
  } catch (error) {
    console.warn('Error fetching branding:', error);
    // Continue with default company name
  }
  
  return companyName;
}

/**
 * Send SMS with upload link
 */
export async function sendUploadLinkSMS(params: {
  customerName: string;
  customerPhone: string;
  uploadUrl: string;
  authContext: AuthContext;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const [smsTemplate, companyName] = await Promise.all([
      getSMSTemplate(params.authContext),
      getCompanyName(params.authContext)
    ]);
    
    const message = replaceSMSVariables(smsTemplate, {
      customerName: params.customerName,
      uploadUrl: params.uploadUrl,
      companyName
    });

    await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: params.customerPhone,
    });

    return { success: true };
  } catch (error) {
    console.error('SMS sending failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to send SMS'
    };
  }
}

/**
 * Update project tracking information
 */
export async function updateProjectTracking(params: {
  projectId: string;
  customerName: string;
  customerPhone: string;
  uploadToken: string;
}): Promise<void> {
  await connectMongoDB();
  
  await Project.findByIdAndUpdate(params.projectId, {
    $set: {
      'uploadLinkTracking.lastSentAt': new Date(),
      'uploadLinkTracking.lastSentTo': {
        customerName: params.customerName,
        customerPhone: params.customerPhone
      },
      'uploadLinkTracking.uploadToken': params.uploadToken,
      // Reset follow-up flags when sending new link
      'uploadLinkTracking.firstFollowUpSent': false,
      'uploadLinkTracking.firstFollowUpSentAt': null,
      'uploadLinkTracking.secondFollowUpSent': false,
      'uploadLinkTracking.secondFollowUpSentAt': null
    },
    $inc: {
      'uploadLinkTracking.totalSent': 1
    }
  });
}

/**
 * Complete upload link generation and sending workflow
 * This is the main function that orchestrates the entire process
 */
export async function generateAndSendUploadLink(params: {
  projectId: string;
  customerName: string;
  customerPhone: string;
  authContext: AuthContext;
}): Promise<UploadLinkResult> {
  try {
    await connectMongoDB();
    
    // Generate upload token and expiration
    const uploadToken = generateUploadToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now
    
    const uploadUrl = createUploadUrl(uploadToken);
    
    // Create customer upload record
    const customerUpload = await createCustomerUploadRecord({
      projectId: params.projectId,
      userId: params.authContext.userId,
      organizationId: params.authContext.organizationId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      uploadToken,
      expiresAt,
    });
    
    // Send SMS
    const smsResult = await sendUploadLinkSMS({
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      uploadUrl,
      authContext: params.authContext,
    });
    
    if (smsResult.success) {
      // Update project tracking
      await updateProjectTracking({
        projectId: params.projectId,
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        uploadToken,
      });
      
      return {
        success: true,
        uploadToken,
        uploadUrl,
        expiresAt,
        smsDelivered: true,
        customerUploadId: customerUpload._id.toString(),
      };
    } else {
      // Delete the customer upload record if SMS failed
      await CustomerUpload.findByIdAndDelete(customerUpload._id);
      
      return {
        success: false,
        error: smsResult.error || 'Failed to send SMS',
        uploadToken,
        uploadUrl,
        expiresAt,
        smsDelivered: false,
      };
    }
  } catch (error) {
    console.error('Error in generateAndSendUploadLink:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate upload link',
    };
  }
}
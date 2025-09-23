// lib/sms-template-helpers.ts

// Default SMS upload link template
export const DEFAULT_SMS_UPLOAD_TEMPLATE = `Hi {customerName}! Greetings from {companyName} 👋🏼

Please upload photos of what you'll be moving for your moving inventory.

Click here: {uploadUrl}

🚚 Happy moving!`;

// Note: This function is now moved to the server-side route
// to avoid importing mongoose models in client components

// Replace variables in SMS template
export function replaceSMSVariables(
  template: string,
  variables: {
    customerName: string;
    uploadUrl: string;
    companyName: string;
  }
): string {
  return template
    .replace(/\{customerName\}/g, variables.customerName)
    .replace(/\{uploadUrl\}/g, variables.uploadUrl)
    .replace(/\{companyName\}/g, variables.companyName);
}

// Validate that template contains required variables
export function validateSMSTemplate(template: string): {
  isValid: boolean;
  missingVariables: string[];
} {
  const requiredVariables = ['customerName', 'uploadUrl', 'companyName'];
  const missingVariables: string[] = [];

  for (const variable of requiredVariables) {
    if (!template.includes(`{${variable}}`)) {
      missingVariables.push(variable);
    }
  }

  return {
    isValid: missingVariables.length === 0,
    missingVariables
  };
}
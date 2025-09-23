// Test script to verify URL generation logic
const crypto = require('crypto');

function getBaseUrl(nodeEnv, nextPublicAppUrl) {
  // Production URL
  if (nodeEnv === 'production') {
    return nextPublicAppUrl || 'https://app.qubesheets.com';
  }
  
  // Development URL
  if (nextPublicAppUrl) {
    return nextPublicAppUrl;
  }
  
  // Fallback for development
  return 'http://localhost:3000';
}

function createUploadUrl(token, nodeEnv, nextPublicAppUrl) {
  return `${getBaseUrl(nodeEnv, nextPublicAppUrl)}/customer-upload/${token}`;
}

// Test scenarios
const testToken = crypto.randomBytes(32).toString('hex');

console.log('🧪 Testing URL Generation:');
console.log('');

// Production with env var set
console.log('Production with NEXT_PUBLIC_APP_URL set:');
console.log(createUploadUrl(testToken, 'production', 'https://app.qubesheets.com'));
console.log('');

// Production without env var (fallback)
console.log('Production without NEXT_PUBLIC_APP_URL (fallback):');
console.log(createUploadUrl(testToken, 'production', undefined));
console.log('');

// Development with env var
console.log('Development with NEXT_PUBLIC_APP_URL set:');
console.log(createUploadUrl(testToken, 'development', 'http://localhost:3000'));
console.log('');

// Development without env var (fallback)
console.log('Development without NEXT_PUBLIC_APP_URL (fallback):');
console.log(createUploadUrl(testToken, 'development', undefined));
console.log('');

console.log('✅ All scenarios should show correct URLs');
console.log('❌ No localhost URLs should appear in production');
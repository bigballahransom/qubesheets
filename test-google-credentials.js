// test-google-credentials.js - Test Google Cloud Video Intelligence credentials
require('dotenv').config({ path: '.env.local' });
const { VideoIntelligenceServiceClient } = require('@google-cloud/video-intelligence');

async function testCredentials() {
  try {
    console.log('🔑 Testing Google Cloud credentials...');
    console.log('Project ID:', process.env.GOOGLE_CLOUD_PROJECT_ID);
    console.log('Credentials file:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    
    const client = new VideoIntelligenceServiceClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
    
    // Test by listing operations (should work without errors)
    const [operations] = await client.listOperations({});
    console.log('✅ Google Cloud Video Intelligence API connection successful!');
    console.log(`📋 Found ${operations.length} operations in your project`);
    
  } catch (error) {
    console.error('❌ Google Cloud credentials test failed:');
    console.error('Error:', error.message);
    
    if (error.message.includes('ENOENT')) {
      console.error('💡 Fix: Make sure the credentials file path is correct');
    } else if (error.message.includes('invalid_grant')) {
      console.error('💡 Fix: Your service account key may be expired or invalid');
    } else if (error.message.includes('permission')) {
      console.error('💡 Fix: Your service account needs Video Intelligence API permissions');
    }
  }
}

testCredentials();
// Test script to verify Railway service connection
const fetch = require('node-fetch');

// Configuration
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://your-railway-service.railway.app';
const LOCAL_SERVICE_URL = 'http://localhost:3001';

async function testConnection(baseUrl, serviceName) {
  console.log(`\n🧪 Testing ${serviceName} at ${baseUrl}`);
  
  try {
    // Test health endpoint
    console.log('  📊 Testing health endpoint...');
    const healthResponse = await fetch(`${baseUrl}/health`);
    
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log('  ✅ Health check passed:', healthData);
    } else {
      console.log('  ❌ Health check failed:', healthResponse.status, healthResponse.statusText);
      return false;
    }

    // Test CORS
    console.log('  🔒 Testing CORS...');
    const corsResponse = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST'
      }
    });
    
    console.log('  📝 CORS headers:', corsResponse.headers.get('Access-Control-Allow-Origin'));
    
    return true;
    
  } catch (error) {
    console.log('  ❌ Connection failed:', error.message);
    return false;
  }
}

async function testImageUpload(baseUrl, serviceName) {
  console.log(`\n📸 Testing image upload to ${serviceName}...`);
  
  try {
    // Create a simple test image buffer (1x1 white pixel PNG)
    const testImageBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
      0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0x0F, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);

    const FormData = require('form-data');
    const form = new FormData();
    form.append('images', testImageBuffer, {
      filename: 'test.png',
      contentType: 'image/png'
    });

    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      body: form
    });

    if (response.ok) {
      const result = await response.json();
      console.log('  ✅ Image upload test passed');
      return true;
    } else {
      const errorText = await response.text();
      console.log('  ❌ Image upload failed:', response.status, errorText);
      return false;
    }

  } catch (error) {
    console.log('  ❌ Image upload error:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing Railway Image Service Connection\n');
  
  // Test local service first
  console.log('=== LOCAL SERVICE TEST ===');
  const localWorks = await testConnection(LOCAL_SERVICE_URL, 'Local Service');
  if (localWorks) {
    await testImageUpload(LOCAL_SERVICE_URL, 'Local Service');
  }
  
  // Test Railway service
  console.log('\n=== RAILWAY SERVICE TEST ===');
  if (process.env.RAILWAY_URL) {
    const railwayWorks = await testConnection(RAILWAY_URL, 'Railway Service');
    if (railwayWorks) {
      await testImageUpload(RAILWAY_URL, 'Railway Service');
    }
  } else {
    console.log('⚠️  RAILWAY_URL not set - please set it to test production service');
    console.log('   Example: RAILWAY_URL=https://your-service.railway.app node test-railway-connection.js');
  }
  
  console.log('\n🏁 Testing complete!');
}

main().catch(console.error);
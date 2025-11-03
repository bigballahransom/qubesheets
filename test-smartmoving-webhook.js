// Test script for SmartMoving webhook endpoint
// This simulates a webhook call from SmartMoving

const testWebhook = async () => {
  const webhookPayload = {
    event_type: 'opportunity_created',
    'opportunity-id': 'test-opportunity-123',
    data: {
      customer: {
        name: 'Test Customer',
        phone: '5551234567'
      }
    }
  };

  try {
    console.log('Testing SmartMoving webhook endpoint...');
    console.log('Payload:', JSON.stringify(webhookPayload, null, 2));
    
    // Note: This test requires a valid API key and running server
    // Replace 'your_api_key_here' with an actual API key
    const response = await fetch('http://localhost:3000/api/external/smartmoving', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer your_api_key_here'
      },
      body: JSON.stringify(webhookPayload)
    });

    const result = await response.json();
    console.log('Response status:', response.status);
    console.log('Response body:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('Test failed:', error.message);
  }
};

// Test the GET endpoint for documentation
const testDocs = async () => {
  try {
    console.log('\nTesting documentation endpoint...');
    const response = await fetch('http://localhost:3000/api/external/smartmoving');
    const result = await response.json();
    console.log('Docs response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Docs test failed:', error.message);
  }
};

// Run tests
console.log('SmartMoving Webhook Test Suite');
console.log('================================');

testDocs();
// testWebhook(); // Uncomment when you have API key and server running
#!/bin/bash

# Test API endpoint documentation
echo "Testing GET endpoint for documentation..."
curl -X GET http://localhost:3000/api/external/projects | jq .

echo -e "\n\nTesting POST without auth (should fail)..."
curl -X POST http://localhost:3000/api/external/projects \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test Customer",
    "phone": "5551234567"
  }' | jq .

echo -e "\n\nTesting POST with invalid auth (should fail)..."
curl -X POST http://localhost:3000/api/external/projects \
  -H "Authorization: Bearer invalid_key" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Test Customer",
    "phone": "5551234567"
  }' | jq .

echo -e "\n\nTo test with a valid API key:"
echo "1. Go to http://localhost:3000/settings/api-keys"
echo "2. Create an API key"
echo "3. Run: curl -X POST http://localhost:3000/api/external/projects \\"
echo "     -H \"Authorization: Bearer YOUR_API_KEY\" \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"customerName\": \"Test Customer\", \"phone\": \"5551234567\"}'"
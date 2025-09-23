#!/bin/bash

echo "=== Testing Upload Link Integration ==="

echo -e "\n1. Testing GET endpoint (documentation)..."
curl -s -X GET http://localhost:3000/api/external/projects | jq '.requestBody, .responses."201".example.project.uploadLink' 2>/dev/null

echo -e "\n\n2. Testing POST without auth (should fail with 401)..."
curl -s -X POST http://localhost:3000/api/external/projects \
  -H "Content-Type: application/json" \
  -d '{"customerName": "Test Customer", "phone": "5551234567"}' | jq .

echo -e "\n\n3. Testing POST with invalid auth (should fail with 401)..."
curl -s -X POST http://localhost:3000/api/external/projects \
  -H "Authorization: Bearer invalid_key" \
  -H "Content-Type: application/json" \
  -d '{"customerName": "Test Customer", "phone": "5551234567"}' | jq .

echo -e "\n\n4. Testing POST without required field (should fail with 400)..."
curl -s -X POST http://localhost:3000/api/external/projects \
  -H "Authorization: Bearer invalid_key" \
  -H "Content-Type: application/json" \
  -d '{"phone": "5551234567"}' | jq .

echo -e "\n\n✅ Basic validation tests completed!"
echo -e "\nTo test with a valid API key:"
echo "1. Go to http://localhost:3000/settings/api-keys"
echo "2. Create an API key"
echo "3. Run: curl -X POST http://localhost:3000/api/external/projects \\"
echo "     -H \"Authorization: Bearer YOUR_API_KEY\" \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"customerName\": \"Test Customer\", \"phone\": \"5551234567\"}' | jq ."
echo -e "\n🔍 Check the response for the uploadLink field to verify auto-send functionality!"
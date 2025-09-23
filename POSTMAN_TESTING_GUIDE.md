# Postman Testing Guide for QubeSheets API

## Testing the Project Creation API in Postman

### Step 1: Create an API Key
1. Start your development server: `npm run dev`
2. Navigate to http://localhost:3000/settings/api-keys
3. Create a new API key and copy it immediately

### Step 2: Configure Postman

**1. Create New Request:**
- Method: `POST`
- URL: `http://localhost:3000/api/external/projects`

**2. Headers:**
```
Authorization: Bearer qbs_YOUR_KEY_HERE
Content-Type: application/json
```

**3. Request Body (raw JSON):**
```json
{
  "customerName": "John Smith",
  "phone": "5551234567"
}
```

### Test Scenarios

**✅ Test 1: Success - Minimal Required Fields**
```json
{
  "customerName": "Test Customer"
}
```

**✅ Test 2: Success - With Phone (Upload Link Sent)**
```json
{
  "customerName": "Jane Doe",
  "phone": "5559999999"
}
```

**❌ Test 3: Missing Customer Name (400 Error)**
```json
{
  "phone": "5551234567"
}
```

**❌ Test 4: Invalid Phone Format (400 Error)**
```json
{
  "customerName": "John Smith",
  "phone": "123"  // Not 10 digits
}
```

**❌ Test 5: Empty Customer Name (400 Error)**
```json
{
  "customerName": "",
  "phone": "5551234567"
}
```

**❌ Test 6: No Auth Header (401 Error)**
Remove the Authorization header completely

**❌ Test 7: Invalid API Key (401 Error)**
```
Authorization: Bearer invalid_key_format
```

**✅ Test 8: Upload Link Behavior Test**
Test different phone scenarios:
```json
// Valid 10-digit phone
{"customerName": "Valid Phone Test", "phone": "5551234567"}

// Invalid phone (too short)
{"customerName": "Invalid Phone Test", "phone": "555123"}

// No phone (should still succeed)
{"customerName": "No Phone Test"}
```

### Expected Responses

**Success Response (201) - With Phone:**
```json
{
  "success": true,
  "message": "Project created successfully",
  "project": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Smith",
    "customerName": "John Smith",
    "phone": "+15551234567",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "organizationId": "org_abc123",
    "uploadLink": {
      "attempted": true,
      "sent": true,
      "smsDelivered": true,
      "uploadUrl": "https://app.qubesheets.com/customer-upload/abc123...",
      "expiresAt": "2024-01-22T10:30:00.000Z"
    }
  }
}
```

**Success Response (201) - Without Phone:**
```json
{
  "success": true,
  "message": "Project created successfully",
  "project": {
    "id": "507f1f77bcf86cd799439011",
    "name": "John Smith",
    "customerName": "John Smith",
    "phone": null,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "organizationId": "org_abc123",
    "uploadLink": {
      "attempted": false,
      "reason": "No phone number provided"
    }
  }
}
```

**Error Response Examples:**
- 401: Invalid or missing API key
- 400: Missing required fields (name, customerName, or phone)
- 500: Server error

### Postman Collection Setup

1. **Create Environment:**
   - Name: "QubeSheets Local"
   - Variables:
     - `base_url`: `http://localhost:3000`
     - `api_key`: `qbs_your_actual_key_here`

2. **Update Request to Use Variables:**
   - URL: `{{base_url}}/api/external/projects`
   - Authorization: `Bearer {{api_key}}`

3. **Save as Collection:**
   - Name: "QubeSheets External API"
   - Add all test scenarios as separate requests

### Pre-request Script (Optional)
Add to generate unique project names:
```javascript
pm.environment.set("random_number", Math.floor(Math.random() * 10000));
```

Then in body:
```json
{
  "customerName": "Customer {{random_number}}",
  "phone": "555000{{random_number}}"
}
```

### Tests Tab (Optional)
Add automated tests:
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Response has project ID", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.project).to.have.property('id');
});

pm.test("Project name matches customer name", function () {
    var jsonData = pm.response.json();
    var requestData = JSON.parse(pm.request.body.raw);
    pm.expect(jsonData.project.name).to.eql(requestData.customerName);
    pm.expect(jsonData.project.customerName).to.eql(requestData.customerName);
});

pm.test("Upload link behavior is correct", function () {
    var jsonData = pm.response.json();
    var requestData = JSON.parse(pm.request.body.raw);
    
    pm.expect(jsonData.project).to.have.property('uploadLink');
    
    if (requestData.phone) {
        // Phone provided - upload link should be attempted
        pm.expect(jsonData.project.uploadLink.attempted).to.be.true;
        pm.expect(jsonData.project.uploadLink).to.have.property('sent');
        pm.expect(jsonData.project.uploadLink).to.have.property('smsDelivered');
        
        if (jsonData.project.uploadLink.sent) {
            pm.expect(jsonData.project.uploadLink).to.have.property('uploadUrl');
            pm.expect(jsonData.project.uploadLink).to.have.property('expiresAt');
        }
    } else {
        // No phone - upload link should not be attempted
        pm.expect(jsonData.project.uploadLink.attempted).to.be.false;
        pm.expect(jsonData.project.uploadLink).to.have.property('reason');
    }
});
```

### Quick Debugging Tips

1. **Check Server Console**: Look for authentication errors and upload link errors in terminal
2. **Verify API Key Format**: Must start with `qbs_`
3. **Check Required Field**: Only customerName is required
4. **Upload Link Troubleshooting**:
   - Check if Twilio credentials are configured in environment variables
   - Verify phone number format (10 digits for US numbers)
   - Look for SMS sending errors in server logs
   - Upload link failure won't prevent project creation
5. **Test GET Endpoint**: `GET http://localhost:3000/api/external/projects` for docs
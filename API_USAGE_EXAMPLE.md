# External API Usage Example

## Creating Projects with API Keys

### Step 1: Get your API Key
1. Navigate to Settings > API Keys in your dashboard
2. Click "Create API Key" 
3. Give it a descriptive name (e.g., "Production API", "Mobile App")
4. Copy the generated API key (format: `qbs_keyId_secret`)

### Step 2: Make API Requests

**Endpoint:** `POST /api/external/projects`

**Headers:**
```
Authorization: Bearer qbs_your_key_id_your_secret
Content-Type: application/json
```

**Request Body:**
```json
{
  "customerName": "Sarah Johnson",
  "phone": "5551234567"
}
```

**Required Fields:**
- `customerName` (string): Customer name (will be used as both project name and customer name)

**Optional Fields:**
- `phone` (string): Customer phone number (10 digits, will be formatted as +1)
  - **Note**: If phone number is provided, an upload link will be automatically generated and sent via SMS to the customer

### Example cURL Request

```bash
curl -X POST https://your-domain.com/api/external/projects \
  -H "Authorization: Bearer qbs_abc123_def456..." \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Sarah Johnson",
    "phone": "5551234567"
  }'
```

### Example JavaScript/Node.js

```javascript
const response = await fetch('https://your-domain.com/api/external/projects', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer qbs_abc123_def456...',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    customerName: 'Sarah Johnson',
    phone: '5551234567'
  })
});

const result = await response.json();
console.log(result);
```

### Success Response (201)

**With Phone Number (Upload Link Sent):**
```json
{
  "success": true,
  "message": "Project created successfully",
  "project": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Sarah Johnson",
    "customerName": "Sarah Johnson",
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

**Without Phone Number:**
```json
{
  "success": true,
  "message": "Project created successfully",
  "project": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Sarah Johnson",
    "customerName": "Sarah Johnson",
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

**Upload Link Fields:**
- `attempted` (boolean): Whether upload link sending was attempted
- `sent` (boolean): Whether the upload link was successfully generated and sent
- `smsDelivered` (boolean): Whether the SMS was successfully delivered
- `uploadUrl` (string): The upload URL sent to the customer (if successful)
- `expiresAt` (string): When the upload link expires (7 days from creation)
- `error` (string): Error message if upload link sending failed
- `reason` (string): Reason why upload link wasn't attempted

### Error Responses

**401 - Invalid API Key:**
```json
{
  "error": "Invalid or missing API key",
  "message": "Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret"
}
```

**400 - Missing Required Fields:**
```json
{
  "error": "Project name is required",
  "message": "Please provide a valid project name"
}
```

**400 - Missing Customer Name:**
```json
{
  "error": "Customer name is required",
  "message": "Please provide a valid customer name"
}
```

**400 - Invalid Phone (if provided):**
```json
{
  "error": "Invalid phone number",
  "message": "Phone number must be 10 digits if provided"
}
```

### API Documentation Endpoint

**GET** `/api/external/projects` - Returns API documentation and usage examples

### Security Notes

- API keys are organization-scoped and create projects within that organization
- Keep your API keys secure and never share them publicly
- API keys track usage (last used timestamp)
- You can create up to 10 API keys per organization
- Delete compromised keys immediately and create new ones
- All API requests are logged for security purposes
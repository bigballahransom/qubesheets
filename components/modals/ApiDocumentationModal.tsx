'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { BookOpen, Copy, CheckCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface ApiDocumentationModalProps {
  children?: React.ReactNode;
}

export default function ApiDocumentationModal({ children }: ApiDocumentationModalProps) {
  const [open, setOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const baseUrl = process.env.NODE_ENV === 'production' 
    ? 'https://your-domain.com' 
    : 'http://localhost:3000';

  const curlExample = `curl -X POST ${baseUrl}/api/external/projects \\
  -H "Authorization: Bearer qbs_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerName": "Sarah Johnson",
    "phone": "5551234567"
  }'`;

  const jsExample = `const response = await fetch('${baseUrl}/api/external/projects', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer qbs_your_key_here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    customerName: 'Sarah Johnson',
    phone: '5551234567'
  })
});

const result = await response.json();
console.log(result);`;

  const successResponse = `{
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
}`;

  const pythonExample = `import requests

url = '${baseUrl}/api/external/projects'
headers = {
    'Authorization': 'Bearer qbs_your_key_here',
    'Content-Type': 'application/json'
}
data = {
    'customerName': 'Sarah Johnson',
    'phone': '5551234567'
}

response = requests.post(url, headers=headers, json=data)
result = response.json()
print(result)`;

  const CodeBlock = ({ code, language, label }: { code: string; language: string; label: string }) => (
    <div className="relative">
      <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm overflow-x-auto">
        <div className="flex justify-between items-center mb-3">
          <span className="text-gray-400 text-xs uppercase">{language}</span>
          <Button
            onClick={() => copyToClipboard(code, label)}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white h-6 px-2"
          >
            {copiedCode === label ? (
              <CheckCircle className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
        <pre className="text-sm leading-relaxed">{code}</pre>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            API Documentation
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            API Documentation
          </DialogTitle>
          <DialogDescription>
            Complete guide to using the QubeSheets External API for project creation
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Quick Start */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Quick Start</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 mb-2">
                Create projects programmatically and automatically send upload links to customers via SMS.
              </p>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• <strong>Endpoint:</strong> POST /api/external/projects</li>
                <li>• <strong>Authentication:</strong> API Key via Bearer token</li>
                <li>• <strong>Auto SMS:</strong> Upload links sent automatically when phone provided</li>
              </ul>
            </div>
          </section>

          {/* Authentication */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Authentication</h3>
            <p className="text-sm text-gray-600 mb-3">
              All requests must include your API key in the Authorization header:
            </p>
            <CodeBlock 
              code="Authorization: Bearer qbs_your_key_here" 
              language="Header" 
              label="Auth Header"
            />
          </section>

          {/* Request Format */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Request Format</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2">Required Fields</h4>
                <ul className="text-sm space-y-1">
                  <li><code className="bg-gray-100 px-1 rounded">customerName</code> - Customer name</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2">Optional Fields</h4>
                <ul className="text-sm space-y-1">
                  <li><code className="bg-gray-100 px-1 rounded">phone</code> - 10-digit US phone number</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-800">
                <strong>📱 Auto SMS:</strong> When phone is provided, an upload link is automatically generated and sent via SMS to the customer.
              </p>
            </div>
          </section>

          {/* Code Examples */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Code Examples</h3>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">cURL</h4>
                <CodeBlock code={curlExample} language="bash" label="cURL Example" />
              </div>

              <div>
                <h4 className="font-medium mb-2">JavaScript/Node.js</h4>
                <CodeBlock code={jsExample} language="javascript" label="JavaScript Example" />
              </div>

              <div>
                <h4 className="font-medium mb-2">Python</h4>
                <CodeBlock code={pythonExample} language="python" label="Python Example" />
              </div>
            </div>
          </section>

          {/* Response Format */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Response Format</h3>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Success Response (201)</h4>
                <CodeBlock code={successResponse} language="json" label="Success Response" />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Upload Link Fields</h4>
                  <ul className="text-sm space-y-1">
                    <li><code className="bg-gray-100 px-1 rounded">attempted</code> - Whether SMS was attempted</li>
                    <li><code className="bg-gray-100 px-1 rounded">sent</code> - Whether upload link was created</li>
                    <li><code className="bg-gray-100 px-1 rounded">smsDelivered</code> - SMS delivery status</li>
                    <li><code className="bg-gray-100 px-1 rounded">uploadUrl</code> - Customer upload URL</li>
                    <li><code className="bg-gray-100 px-1 rounded">expiresAt</code> - Link expiration date</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium">Error Responses</h4>
                  <ul className="text-sm space-y-1">
                    <li><code className="bg-red-100 px-1 rounded">400</code> - Invalid request data</li>
                    <li><code className="bg-red-100 px-1 rounded">401</code> - Invalid API key</li>
                    <li><code className="bg-red-100 px-1 rounded">409</code> - Duplicate project</li>
                    <li><code className="bg-red-100 px-1 rounded">500</code> - Server error</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Rate Limits & Best Practices */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Best Practices</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="p-3 bg-green-50 border border-green-200 rounded">
                  <h4 className="font-medium text-green-900 mb-1">✅ Do</h4>
                  <ul className="text-sm text-green-800 space-y-1">
                    <li>• Store API keys securely</li>
                    <li>• Validate phone numbers before sending</li>
                    <li>• Handle errors gracefully</li>
                    <li>• Use HTTPS in production</li>
                  </ul>
                </div>
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <h4 className="font-medium text-red-900 mb-1">❌ Don't</h4>
                  <ul className="text-sm text-red-800 space-y-1">
                    <li>• Expose API keys in client code</li>
                    <li>• Ignore upload link errors</li>
                    <li>• Send duplicate requests</li>
                    <li>• Skip error handling</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Testing */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Testing</h3>
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 border rounded">
                <h4 className="font-medium mb-2">Test in Development</h4>
                <p className="text-sm text-gray-600 mb-2">
                  Use the following endpoint for testing:
                </p>
                <code className="text-sm bg-gray-200 px-2 py-1 rounded">
                  GET {baseUrl}/api/external/projects
                </code>
                <p className="text-xs text-gray-500 mt-1">Returns API documentation and examples</p>
              </div>
              
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded">
                <ExternalLink className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-blue-800">
                  Import our Postman collection for easy testing and integration
                </span>
              </div>
            </div>
          </section>

          {/* Support */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Support</h3>
            <div className="p-4 bg-gray-50 border rounded">
              <p className="text-sm text-gray-600 mb-2">
                Need help? Check your server logs for detailed error messages or contact support.
              </p>
              <div className="space-y-1 text-sm">
                <p><strong>Server Logs:</strong> Check console for upload link processing details</p>
                <p><strong>SMS Issues:</strong> Verify Twilio configuration and phone number format</p>
                <p><strong>API Errors:</strong> Ensure API key is valid and has proper permissions</p>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
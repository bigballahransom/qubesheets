# Production URL Fix for Upload Links

## ❌ Problem
When customers receive SMS upload links in production, they get `localhost` URLs instead of `app.qubesheets.com`.

## ✅ Solution Implemented

### Files Modified:
1. **`/lib/upload-link-helpers.ts`** - Added robust URL generation
2. **`/app/api/projects/[projectId]/send-upload-link/route.ts`** - Fixed URL generation
3. **`/components/modals/ApiDocumentationModal.tsx`** - Updated examples

### New URL Generation Logic:
```javascript
function getBaseUrl() {
  // Production: Use env var or fallback to app.qubesheets.com
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  
  // Development: Use env var or fallback to localhost
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}
```

## 🚀 Deployment Requirements

### 1. Environment Variable (Recommended)
Set in your production environment:
```bash
NEXT_PUBLIC_APP_URL=https://app.qubesheets.com
```

### 2. Automatic Fallback (Backup)
If the environment variable is not set, the code automatically uses `https://app.qubesheets.com` in production.

## ✅ What's Fixed

### Before:
- 🔴 Production SMS: `http://localhost:3000/customer-upload/abc123...`
- 🔴 Inconsistent URL generation across codebase

### After:
- ✅ Production SMS: `https://app.qubesheets.com/customer-upload/abc123...`
- ✅ Development SMS: `http://localhost:3000/customer-upload/abc123...`
- ✅ Consistent URL generation everywhere
- ✅ Robust fallback system

## 🧪 Testing

### Test Script Created:
Run `node test-url-generation.js` to verify URL generation logic.

### Test Results:
```
Production with NEXT_PUBLIC_APP_URL: ✅ https://app.qubesheets.com/customer-upload/...
Production without env var: ✅ https://app.qubesheets.com/customer-upload/...
Development: ✅ http://localhost:3000/customer-upload/...
```

## 📱 Impact on Customers

### Now Customers Will Receive:
- ✅ Working HTTPS links in production
- ✅ Proper SSL/security
- ✅ Links that actually work on their phones
- ✅ Professional appearance

## 🔧 Affected Features

### Both Fixed:
1. **API-Created Projects** - External API with auto-SMS
2. **Manual Upload Links** - From project management UI

### All SMS Templates:
- Organization-specific templates
- Default system templates
- Follow-up messages (existing system)

## 🚨 Deployment Notes

1. **Zero Downtime**: This fix is backward compatible
2. **Immediate Effect**: Upload links will use correct URLs immediately after deployment
3. **No Database Changes**: No migration required
4. **Environment Agnostic**: Works with or without `NEXT_PUBLIC_APP_URL` set

## 📋 Verification Checklist

After deployment, verify:
- [ ] Create project via API with phone number
- [ ] Check SMS received by customer
- [ ] Confirm URL starts with `https://app.qubesheets.com`
- [ ] Test manual upload link sending from UI
- [ ] Confirm both methods generate correct URLs

This fix ensures all upload links sent to customers will work properly in production! 🎉
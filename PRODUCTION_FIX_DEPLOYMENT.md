# Production MongoDB & Timeout Fixes - Deployment Guide

## Overview
This deployment addresses critical production issues:
1. MongoDB connection pool exhaustion and timeouts
2. Vercel function timeouts on video processing status
3. Database query optimization for inventory updates

## Changes Made

### 1. MongoDB Connection Configuration (`lib/mongodb.js`)
- **Increased connection pool**: 3 → 10 connections
- **Increased timeouts**: 
  - Server selection: 5s → 30s
  - Socket timeout: 10s → 45s
  - Connection timeout: Added 30s
- **Added retry helper**: `retryWithBackoff` function with exponential backoff
- **Added read preferences**: Primary preferred with stale secondary fallback
- **Reduced monitoring overhead**: Heartbeat 5s → 10s

### 2. Inventory Update Optimization (`app/api/projects/[projectId]/inventory/[itemId]/route.js`)
- **Reduced queries**: From 3 separate queries to 1-2 using transactions
- **Added mongoose sessions**: Atomic updates for inventory + project timestamp
- **Optimized logic**: Only fetch current item when necessary
- **Added proper error handling**: Transactional rollback on failures

### 3. Video Processing Status (`pages/api/video/processing-status.js`)
- **Fixed timeout handling**: Auto-close before Vercel 5-minute limit (4.5 minutes)
- **Dynamic polling intervals**: 5s when processing, 60s when idle
- **Added reconnection signal**: Client notification before timeout

### 4. New Polling Endpoint (`app/api/projects/[projectId]/videos/status/route.js`)
- **Vercel-optimized**: Standard request/response pattern
- **Lean queries**: Using `.lean()` for performance
- **Retry logic**: Built-in retry with exponential backoff
- **Smart filtering**: Only return active/recent videos

## Deployment Steps

1. **Environment Variables** (if needed):
   ```bash
   # Optional: Override default pool size
   MONGODB_MAX_POOL_SIZE=10
   ```

2. **Test Changes Locally**:
   ```bash
   npm run dev
   # Test inventory updates and video status checks
   ```

3. **Deploy to Production**:
   ```bash
   git add -A
   git commit -m "Fix: MongoDB connection pool and Vercel timeouts

   - Increase MongoDB connection pool from 3 to 10
   - Increase timeouts for better reliability
   - Optimize inventory updates with transactions
   - Fix video processing SSE timeouts
   - Add new polling endpoint for video status"
   
   git push origin main
   ```

4. **Monitor After Deployment**:
   - Check MongoDB Atlas metrics for connection count
   - Monitor Vercel function logs for timeout errors
   - Verify inventory bulk updates work smoothly

## Rollback Plan

If issues occur, revert the changes:

1. **MongoDB settings**: Revert to emergency settings:
   ```javascript
   maxPoolSize: 3,
   serverSelectionTimeoutMS: 5000,
   socketTimeoutMS: 10000,
   ```

2. **Remove transactions**: Revert inventory route to original sequential queries

3. **Restore SSE interval**: Change back to 15s fixed interval

## Migration for Frontend

The frontend should gradually migrate from SSE to polling:

```javascript
// Old SSE approach (can timeout)
const eventSource = new EventSource(`/api/video/processing-status?projectId=${projectId}`);

// New polling approach (more reliable)
const pollVideoStatus = async () => {
  const response = await fetch(`/api/projects/${projectId}/videos/status`);
  const data = await response.json();
  // Update UI with data.videos
  
  // Poll again if processing
  if (data.hasActiveProcessing) {
    setTimeout(pollVideoStatus, 5000);
  }
};
```

## Monitoring Commands

Check connection stats via API:
```bash
curl https://app.qubesheets.com/api/debug/connection-stats
```

## Notes

- All changes maintain backward compatibility
- No database schema changes required
- Frontend can use both old and new endpoints during migration
- Retry logic prevents temporary network issues from failing requests
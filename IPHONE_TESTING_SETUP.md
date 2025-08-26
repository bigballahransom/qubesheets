# 📱 iPhone HEIC Testing Setup Guide

## ✅ Setup Complete!

Your development server is configured and running for iPhone testing.

## 🔗 Connection Details

### Mac Development Server
- **Local URL:** http://localhost:3000 (Mac only)
- **External URL:** http://10.0.0.32:3000 (for iPhone)
- **Server Status:** Running with external access (`-H 0.0.0.0`)

### iPhone Connection Steps

1. **Connect iPhone to Same WiFi Network**
   - Make sure your iPhone is on the same WiFi as your Mac
   - WiFi name should be the same on both devices

2. **Access Your App on iPhone**
   - Open Safari on your iPhone
   - Go to: `http://10.0.0.32:3000`
   - Your app should load normally

## 🛠️ iPhone Developer Tools Setup

### Enable Web Inspector on iPhone
1. iPhone Settings → Safari → Advanced
2. Turn ON "Web Inspector"

### Connect to Mac Safari Dev Tools
1. Connect iPhone to Mac via USB cable
2. Open Safari on Mac
3. In Mac Safari: Develop menu → [Your iPhone Name] → localhost
4. Select your site to open dev tools

## 🧪 Testing HEIC Functionality

### What to Test
1. **Photo Library Selection:**
   - Tap photo upload button
   - Choose "Photo Library" 
   - Select a HEIC photo
   - Watch for conversion process

2. **Monitor Console Logs:**
   - Use Mac Safari dev tools connected to iPhone
   - Look for these key log messages:
   ```
   🔍 File analysis: { name: "IMG_1234.heic", type: "", size: 2500000 }
   📱 HEIC detection result: { isPotentialIPhoneHeic: true }
   📱 Detected iPhone HEIC file with empty MIME type, forcing conversion
   🔄 Starting HEIC conversion attempt 1
   ✅ HEIC conversion successful
   ```

### Expected Behavior
- ✅ HEIC files from photo library are detected
- ✅ Preview appears after selection  
- ✅ Conversion happens automatically
- ✅ "Analyze Items" works after conversion
- ✅ Items are extracted successfully

### Common Issues & Solutions

**Issue: Can't connect to 10.0.0.32:3000**
- Check WiFi connection (same network)
- Try restarting development server: `npm run dev:external`

**Issue: Empty MIME type detected**
- This is normal for iPhone photos
- Look for "isPotentialIPhoneHeic: true" in logs
- System should handle it automatically

**Issue: Conversion fails**
- Check retry logic (up to 3 attempts)
- Look for server fallback messages
- iPhone-specific error messages should appear

## 🎯 Key Test Scenarios

1. **Small HEIC (< 2MB):** Should convert quickly
2. **Large HEIC (5-10MB):** May take 15-30 seconds
3. **Photo Library vs Camera:** Different behavior expected
4. **Multiple Files:** Test one at a time
5. **Network Issues:** Test on cellular vs WiFi

## 📊 Success Metrics

### ✅ Working Correctly:
- Console shows detailed HEIC detection logs
- Conversion completes within timeout periods
- Preview displays properly
- Analysis extracts items successfully
- No "Bad Request" errors

### ❌ Issues to Debug:
- Empty error objects in console
- Timeouts during conversion
- "Failed to analyze image" errors
- Missing preview after selection

## 🚀 Quick Start Commands

```bash
# Start development server for iPhone testing
npm run dev:external

# Check if server is running
ps aux | grep "next dev"

# Find your Mac's IP address
ifconfig | grep "inet " | grep -v 127.0.0.1
```

## 📝 Debugging Tips

1. **Always use iPhone Safari** (not Chrome) for initial testing
2. **Keep Mac Safari dev tools open** to monitor logs
3. **Test with different HEIC file sizes** to verify timeout handling
4. **Compare photo library vs camera capture** behavior
5. **Check both client-side and server-side logs** for complete picture

---

**Ready to test!** 🎉

Go to `http://10.0.0.32:3000` on your iPhone and start testing HEIC uploads!
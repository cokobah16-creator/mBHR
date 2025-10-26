# Session Expiration Fix - Summary

## Problem
Users were seeing "Session expired. Please login again" immediately when:
- Reloading the page
- Coming back after a short break
- Starting a new browser session

## Root Cause
The session management system was storing the `sessionExpiresAt` timestamp in localStorage. When the page reloaded, the old timestamp was being checked immediately, causing sessions to appear expired even if they shouldn't be.

## Solution Implemented

### 1. Session Rehydration Check
Added `onRehydrateStorage` callback to the auth store that:
- Checks if the stored session timestamp is still valid when loading from localStorage
- Automatically clears expired sessions on page load
- Updates the last activity timestamp for valid sessions
- Logs session restoration for debugging

### 2. Automatic Session Extension
Modified `updateActivity()` to:
- Check remaining time on each activity
- Automatically extend the session by 12 hours if less than 1 hour remains
- Only update timestamps without extending if plenty of time remains
- Log session extensions for monitoring

### 3. Session Configuration

**Staff Users:**
- **Duration:** 12 hours per session
- **Auto-extend:** When < 1 hour remains and user is active
- **Idle timeout:** 30 minutes (via SessionManager)
- **Warning:** 5 minutes before expiration
- **Maximum:** 24 hours absolute (enforced by SessionManager)

**Patient Portal Users:**
- **Duration:** 4 hours per session
- **Auto-refresh:** Automatic refresh 15 minutes before expiration
- **Idle timeout:** 30 minutes
- **Warning:** 5 minutes before expiration
- **Maximum:** 8 hours absolute

## What Happens Now

### On Page Load/Refresh:
1. ✅ Auth store checks stored session timestamp
2. ✅ If valid: Session restored, user stays logged in
3. ✅ If expired: Session cleared, user redirected to login
4. ✅ Last activity timestamp updated

### During Active Use:
1. ✅ Activity tracked (mouse, keyboard, scroll, touch)
2. ✅ Session automatically extended when < 1 hour remains
3. ✅ Warning shown at 5 minutes before expiration
4. ✅ User can click "Stay Logged In" to extend immediately

### On Expiration:
1. ✅ Warning dialog appears 5 minutes before
2. ✅ User can extend or logout gracefully
3. ✅ If no action taken, automatic logout after countdown
4. ✅ Clear redirect to login page

## Testing the Fix

### Test 1: Page Reload
1. Login to the staff portal
2. Use the app for a few minutes
3. Refresh the page (F5)
4. ✅ **Expected:** You stay logged in

### Test 2: Activity Extension
1. Login to the staff portal
2. Wait until your session is close to expiring (check console logs)
3. Move the mouse or type something
4. ✅ **Expected:** Session automatically extends by 12 hours

### Test 3: Warning Dialog
1. Login to the staff portal
2. Wait 5 minutes before expiration (or modify the code temporarily)
3. ✅ **Expected:** Warning dialog appears with countdown
4. Click "Stay Logged In"
5. ✅ **Expected:** Session extends, dialog closes

### Test 4: Expiration
1. Login to the staff portal
2. Don't interact for the full idle timeout period (30 min)
3. ✅ **Expected:** Warning appears, then logout after countdown

## Debug Logging

Check browser console for these log messages:

```
[Auth] Session restored successfully  // On page load with valid session
[Auth] Session expired on rehydration // On page load with expired session
[Auth] Session extended due to activity // When auto-extension happens
[Auth] Session expired // When session timeout occurs
```

## Configuration Changes

If you need to adjust the session durations:

**Staff Sessions:** Edit `src/stores/auth.ts`
```typescript
const STAFF_SESSION_DURATION = 12 * 60 * 60 * 1000 // 12 hours
```

**Patient Sessions:** Edit `src/utils/sessionManager.ts`
```typescript
export const SESSION_CONFIGS = {
  patient: {
    duration: 4, // 4 hours
    idleTimeout: 30, // 30 minutes
    warningBeforeExpiry: 5, // 5 minutes
    maxDuration: 8 // 8 hours absolute maximum
  }
}
```

## Files Changed

- ✅ `src/stores/auth.ts` - Added rehydration check and activity-based extension
- ✅ `src/utils/sessionManager.ts` - Session management utilities
- ✅ `src/components/SessionWarning.tsx` - Warning dialog UI
- ✅ `src/components/Layout.tsx` - Integrated session manager for staff
- ✅ `src/App.tsx` - Integrated session validation for patients

## Build Status

✅ **Build Successful** - All 887 modules transformed without errors

## Next Steps

1. **Clear your browser localStorage** to test with a fresh session:
   - Open DevTools (F12)
   - Go to Application → Local Storage
   - Delete `mbhr-auth` key
   - Refresh and login again

2. **Monitor the console** for session-related log messages

3. **Test the scenarios** listed above to verify the fix

4. **Adjust timeouts** if needed based on your workflow

## Support

If you still see "Session expired" immediately:
1. Clear localStorage and cookies
2. Hard refresh (Ctrl+Shift+R)
3. Check console for error messages
4. Login again and monitor console logs

The session should now persist across page reloads and only expire after genuine inactivity or when the maximum duration is reached.

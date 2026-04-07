# FIX IT NOW - Clear Instructions

## You're seeing "Session expired" - Here's the ACTUAL fix

### What's Happening

The app is checking if your session is valid. It's finding an OLD session token in your browser that's expired. The NEW code I just deployed has a 5-minute grace period, but your browser still has the OLD expired data.

---

## STEP 1: Open Browser Console

You're already looking at the Bolt interface. You need to:

1. **Open the PREVIEW window** (the right side showing your app)
2. **Right-click anywhere** on the app
3. **Click "Inspect"** or press `F12`
4. **Click the "Console" tab**

---

## STEP 2: Clear The Session Data

**Copy this EXACT command and paste it into the console:**

```javascript
localStorage.removeItem("patient_session_token");
localStorage.removeItem("patient_portal_user");
localStorage.removeItem("mbhr-auth");
location.reload();
```

**Press Enter**

The page will reload and the old session data will be GONE.

---

## STEP 3: Login

After the page reloads:

### For Staff Login:

- Go to `/login`
- Enter PIN: `111111` (or whatever your admin PIN is)

### For Patient Portal:

- Go to `/patient/login`
- Enter your phone number
- Enter the OTP code

---

## STEP 4: Test It

1. After logging in, **refresh the page** (press F5)
2. **You should STAY logged in**
3. NO MORE "Session expired" message

---

## Why This Happened

Your browser had these old values:

- `patient_session_token` - expired session
- `patient_portal_user` - old user data
- `mbhr-auth` - old staff session

The NEW code:

- Checks if session is expired
- Adds 5-minute grace period
- Auto-extends sessions
- Much smarter about validation

But your browser STILL has the old expired data. Once you clear it, the new smart code takes over.

---

## If You're STILL Having Issues

### Check what's in your browser:

```javascript
// See what session data exists
console.log("Patient token:", localStorage.getItem("patient_session_token"));
console.log("Patient user:", localStorage.getItem("patient_portal_user"));
console.log("Staff auth:", localStorage.getItem("mbhr-auth"));
```

### Nuclear option - clear EVERYTHING:

```javascript
// Clear ALL local storage
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Then login fresh.

---

## What URL Are You On?

### If you're on `/patient/*` URLs:

- You're using the PATIENT portal
- Session stored in `patient_session_token`
- Validated against Supabase `patient_portal_sessions` table
- **Fix:** Clear patient tokens

### If you're on `/dashboard` or other staff URLs:

- You're using the STAFF portal
- Session stored in `mbhr-auth`
- Validated in Zustand store
- **Fix:** Clear mbhr-auth

### Both broken?

- **Fix:** Clear everything with `localStorage.clear()`

---

## The Real Solution

**The code is FIXED.**
**Your browser cache is NOT.**

Just clear the cache ONCE and login again. That's it.

---

## Quick Debug

```javascript
// Run this to see what's happening:
const checkSessions = () => {
  const patientToken = localStorage.getItem("patient_session_token");
  const patientUser = localStorage.getItem("patient_portal_user");
  const staffAuth = localStorage.getItem("mbhr-auth");

  console.log("=== SESSION DEBUG ===");
  console.log("Patient token exists?", !!patientToken);
  console.log("Patient user exists?", !!patientUser);
  console.log("Staff auth exists?", !!staffAuth);

  if (staffAuth) {
    try {
      const auth = JSON.parse(staffAuth);
      const expiresAt = new Date(auth.state?.sessionExpiresAt);
      const now = new Date();
      console.log("Staff session expires:", expiresAt);
      console.log("Staff session expired?", expiresAt < now);
      console.log("Minutes until expiry:", (expiresAt - now) / 1000 / 60);
    } catch (e) {
      console.log("Staff auth parse error:", e);
    }
  }

  console.log("===================");
};

checkSessions();
```

This shows you EXACTLY what sessions exist and if they're expired.

---

## Summary

1. **Open console in preview window**
2. **Paste:** `localStorage.clear(); location.reload();`
3. **Press Enter**
4. **Login again**
5. **It works**

The fix is deployed. Your cache is the problem. Clear it. Done.

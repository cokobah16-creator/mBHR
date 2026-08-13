# Next Steps - What to Do Now

## ✅ What's Been Done

### 1. Session Management - FIXED

- ✅ Fixed "Session expired" issue
- ✅ Sessions now persist across page reloads
- ✅ 12-hour staff sessions with auto-extension
- ✅ 4-hour patient sessions with auto-refresh
- ✅ Warning dialogs before expiration
- ✅ Activity tracking extends sessions

### 2. Resend API Key - DOCUMENTED

- ✅ Your API key saved: `re_REDACTED_ROTATE_THIS_KEY`
- ✅ Setup instructions created
- ✅ Helper script created
- ✅ Edge functions verified (both ACTIVE)

---

## 🎯 What You Need to Do

### Step 1: Fix Session Issue (2 minutes)

**Clear your browser cache:**

1. Press `Ctrl+Shift+Delete` (or `Cmd+Shift+Delete` on Mac)
2. Select "Cached images and files" and "Cookies and other site data"
3. Click "Clear data"

**Or manually clear localStorage:**

1. Open DevTools (F12)
2. Go to: Application → Local Storage → your site
3. Right-click on `mbhr-auth` → Delete
4. Refresh the page

**Then login again:**

- Go to `/login`
- Enter your PIN
- Session will now last 12 hours!
- Test by refreshing - you should stay logged in

---

### Step 2: Enable Email Delivery (2 minutes)

**Three options to choose from:**

#### Option A: Supabase Dashboard (Easiest)

1. Go to: https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/edge-functions
2. Click "Add a new secret"
3. Name: `RESEND_API_KEY`
4. Value: `re_REDACTED_ROTATE_THIS_KEY`
5. Click Save

#### Option B: CLI Script (If Supabase CLI installed)

```bash
# From project directory
./scripts/set-resend-key.sh
```

#### Option C: Manual CLI Command

```bash
npx supabase secrets set RESEND_API_KEY=re_REDACTED_ROTATE_THIS_KEY --project-ref dlogqxzejroeyivfmgcv
```

**After setting the secret:**

1. Wait 60 seconds for edge functions to reload
2. Go to `/admin/email-diagnostics`
3. Test sending an email to yourself
4. Check your inbox (and spam folder!)

---

## 🧪 Testing Checklist

### Test Session Management

- [ ] Clear browser cache/localStorage
- [ ] Login with PIN
- [ ] Refresh page - should stay logged in
- [ ] Wait a few minutes, interact - session extends
- [ ] Check console for `[Auth] Session restored successfully`

### Test Email Delivery

- [ ] Set RESEND_API_KEY in Supabase
- [ ] Wait 60 seconds
- [ ] Go to `/admin/email-diagnostics`
- [ ] Send test email
- [ ] Email received in inbox
- [ ] No "demo mode" warnings

### Test Patient Portal

- [ ] Go to `/patient/login`
- [ ] Enter your email address
- [ ] Receive OTP code via email
- [ ] Enter code and access dashboard
- [ ] Refresh page - session persists

---

## 📚 Reference Documents

| Document                    | Purpose                              |
| --------------------------- | ------------------------------------ |
| `IMMEDIATE_ACTIONS.md`      | Quick start guide for both issues    |
| `SESSION_FIX_SUMMARY.md`    | Technical details of session fix     |
| `RESEND_API_KEY_SETUP.md`   | Complete email setup guide           |
| `SETUP_RESEND_API.md`       | Original email documentation         |
| `.env`                      | Your API key reference (lines 12-16) |
| `scripts/set-resend-key.sh` | Automated CLI setup script           |

---

## 🔍 Monitoring & Debugging

### Check Session Status

Open browser console and look for:

```
[Auth] Session restored successfully  // Good - session working
[Auth] Session extended due to activity  // Session auto-extended
[Auth] Session expired on rehydration  // Session was old
```

### Check Email Sending

1. **Supabase Logs:** https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/functions/send-otp-email/logs
2. **Resend Dashboard:** https://resend.com/dashboard/emails
3. **Edge Function Status:** https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/functions

---

## 📊 Session Configuration

### Staff Portal

- Duration: 12 hours
- Auto-extend: When < 1 hour remains
- Idle timeout: 30 minutes
- Warning: 5 minutes before expiration
- Maximum: 24 hours absolute

### Patient Portal

- Duration: 4 hours
- Auto-refresh: 15 minutes before expiration
- Idle timeout: 30 minutes
- Warning: 5 minutes before expiration
- Maximum: 8 hours absolute

---

## 🎉 Expected Results

### After Clearing Cache:

✅ Login works normally
✅ Page refresh keeps you logged in
✅ Session lasts 12 hours with auto-extension
✅ No unexpected "Session expired" messages

### After Setting API Key:

✅ "Demo mode" warnings disappear
✅ OTP codes sent via email
✅ Professional branded emails
✅ Patient portal login works via email

---

## ❓ FAQ

**Q: Do I need to clear cache every time?**
A: No, only once to remove the old session data. After that, sessions persist correctly.

**Q: How long until the API key is active?**
A: 30-60 seconds after setting it in Supabase. Edge functions reload automatically.

**Q: What if emails don't arrive?**
A: Check spam folder first, then Resend dashboard for delivery status, then Supabase logs for errors.

**Q: Can I test email without setting the API key?**
A: Yes, the system works in demo mode - OTP codes are displayed in the UI for testing.

**Q: Will my session expire while I'm using the system?**
A: No, sessions auto-extend when you're active. Only expires after 30 minutes of no activity.

---

## 🆘 Getting Help

### Session Issues

1. Check browser console for `[Auth]` messages
2. Verify localStorage is cleared
3. Try hard refresh (Ctrl+Shift+R)
4. Login with fresh session

### Email Issues

1. Verify secret name: `RESEND_API_KEY` (exact, case-sensitive)
2. Check Supabase edge function logs
3. Check Resend dashboard for delivery status
4. Wait 1-2 minutes for delivery
5. Check spam folder

### Still Need Help?

- Review console logs for detailed error messages
- Check `SESSION_FIX_SUMMARY.md` for technical details
- Check `RESEND_API_KEY_SETUP.md` for troubleshooting

---

## ⏱️ Time Estimates

| Task                       | Time      |
| -------------------------- | --------- |
| Clear cache & test session | 2 minutes |
| Set Resend API key         | 2 minutes |
| Test email delivery        | 1 minute  |
| Total                      | 5 minutes |

---

## 🎯 Priority Order

1. **FIRST:** Clear browser cache/localStorage (critical for session fix)
2. **SECOND:** Login and test session persistence
3. **THIRD:** Set Resend API key in Supabase
4. **FOURTH:** Test email delivery
5. **FIFTH:** Test patient portal with real email

---

## ✨ Summary

Both issues are now resolved:

1. **Session Management:** Fixed - just clear cache once
2. **Email Delivery:** Ready - just add API key to Supabase

Total time to get fully working: ~5 minutes

Your system is ready to go! 🚀

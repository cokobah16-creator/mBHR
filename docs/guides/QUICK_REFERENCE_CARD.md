# Quick Reference Card

## 🎯 Two Issues, Two Solutions

### Issue 1: Session Expired

**Fix:** Clear browser cache → Login again
**Time:** 2 minutes
**Result:** Sessions persist across page reloads

### Issue 2: Email Demo Mode

**Fix:** Add API key to Supabase Edge Functions
**Time:** 2 minutes
**Result:** Portal invitation emails are sent when a staff member signed in online sends them

---

## 🔑 Your Resend API Key

```
re_your_api_key
```

This is a placeholder. Use the key from your Resend dashboard, and never
commit a real key to this repository. `scripts/set-resend-key.sh` asks for
the key without showing it.

**Where to add it:**
https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/edge-functions

**Secret name:** `RESEND_API_KEY` (exactly, case-sensitive)

---

## ⚡ Quick Actions

### Clear Cache (Fix Session Issue)

1. Press `Ctrl+Shift+Delete`
2. Clear "Cookies and other site data"
3. Click "Clear data"
4. Login again at `/login`

### Add API Key (Enable Email)

1. Go to Supabase dashboard → Edge Functions → Secrets
2. Add secret: `RESEND_API_KEY` = `re_your_api_key`
3. Wait 60 seconds
4. Test at `/admin/email-diagnostics`

### Or Use CLI

```bash
# Asks for the key without showing it (or reads RESEND_API_KEY from the environment)
./scripts/set-resend-key.sh
```

---

## 🧪 Test Everything

### Session Test

1. Login with PIN
2. Refresh page (F5)
3. ✅ Should stay logged in

### Email Test

1. Sign in online as an administrator (email and password; a PIN unlock is not enough)
2. Go to `/admin/email-diagnostics`
3. Send test email
4. ✅ Check inbox (and spam!)

### Patient Portal Test

1. Signed in online, open a patient record with an email, turn on portal access and send a portal invitation
2. ✅ The patient receives an email with a registration link
3. The patient opens the link and registers with their date of birth and a password
4. The patient logs in at `/patient/login` with their email and password (no emailed code)
5. ✅ Access dashboard

---

## 📚 Full Documentation

| Document                  | Purpose                     |
| ------------------------- | --------------------------- |
| `NEXT_STEPS.md`           | Complete guide - start here |
| `RESEND_API_KEY_SETUP.md` | Detailed email setup        |
| `SESSION_FIX_SUMMARY.md`  | Technical session details   |
| `IMMEDIATE_ACTIONS.md`    | Quick action steps          |

---

## 🔍 Debug Commands

### Check Session Status

```javascript
// In browser console
localStorage.getItem("mbhr-auth");
```

### Check Edge Functions

```bash
# List deployed functions
npx supabase functions list
```

### Check Secrets

```bash
# List secrets (names only)
npx supabase secrets list --project-ref dlogqxzejroeyivfmgcv
```

---

## ⏱️ Session Timings

| User Type | Duration | Auto-Extend | Max |
| --------- | -------- | ----------- | --- |
| Staff     | 12 hours | Yes         | 24h |
| Patient   | 4 hours  | Yes         | 8h  |

**Idle timeout:** 30 minutes for both
**Warning:** 5 minutes before expiration

---

## 📞 Support Links

- **Supabase Dashboard:** https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv
- **Edge Functions:** https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/functions
- **Resend Dashboard:** https://resend.com/dashboard
- **Function Logs:** https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/functions/send-otp-email/logs

---

## ✅ Success Indicators

**Session Working:**

- Console shows: `[Auth] Session restored successfully`
- Page refresh keeps you logged in
- No unexpected "Session expired" messages

**Email Working:**

- No "demo mode" warnings in UI
- Portal invitation emails arrive
- Test emails arrive in inbox
- Resend dashboard shows deliveries

---

## 🚀 Total Time: 5 Minutes

1. Clear cache (2 min)
2. Set API key (2 min)
3. Test both (1 min)

**Done!** 🎉

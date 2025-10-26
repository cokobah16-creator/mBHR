# Patient Portal Demo Mode - Quick Start

## ✅ Ready to Test NOW (No Setup Required!)

The patient portal is **fully functional in demo mode**. All OTP codes are logged instead of sent via SMS/email.

---

## How to Test Patient Portal

### Step 1: Access Patient Portal
```
Navigate to: https://your-app-url/patient
```

### Step 2: Create Test Account
1. Click **"Create Account"** or **"Login"**
2. Enter test phone or email:
   - Phone: `+2348012345678`
   - Email: `test@example.com`
3. Click **"Send Code"**

### Step 3: Get OTP from Logs
1. Open **Supabase Dashboard**
2. Navigate to: **Edge Functions** → **Logs**
3. Look for recent log entry:
   ```
   OTP for +2348012345678: 123456
   ```
4. Copy the 6-digit code

### Step 4: Complete Login
1. Return to patient portal
2. Enter the OTP code
3. Complete registration if new user
4. Access dashboard!

---

## Test Scenarios

### ✅ New Patient Registration
```
Phone: +2348099999999
Email: patient1@test.com
Name: Test Patient
DOB: 1990-01-01

Check Supabase logs for OTP → Enter code → Complete profile
```

### ✅ Returning Patient Login
```
Use previously registered phone/email
Check logs for new OTP → Enter code → Access dashboard
```

### ✅ View Medical History
```
Login → Dashboard → "View Medical History" → See visits
```

### ✅ Request Appointment
```
Login → "Request Appointment" → Fill form → Submit
```

---

## Demo Mode Indicators

When testing, you'll see:
- ✅ Function response: `"demo": true`
- ✅ Console logs show OTP codes
- ✅ No actual SMS/emails sent
- ✅ All other features work normally

---

## Quick Troubleshooting

### OTP Not Appearing in Logs?
- Refresh the Supabase logs page
- Check you're viewing the correct function (send-otp-sms or send-otp-email)
- Verify function was called (should see request in logs)

### Can't Find Supabase Logs?
```
Supabase Dashboard → 
  Left sidebar → Edge Functions → 
  Click on function name (send-otp-sms) →
  Logs tab
```

### Function Returns Error?
- Check the error message in response
- Common: "Rate limit exceeded" - Wait 15 minutes
- Check function status in Supabase

---

## Sample Test Flow (Complete)

```bash
# 1. Patient visits portal
Visit: /patient

# 2. Enters phone number
Phone: +2348012345678
Click: "Send Verification Code"

# 3. Check Supabase logs
Dashboard → Edge Functions → send-otp-sms → Logs
Find: "OTP for +2348012345678: 456789"

# 4. Enter OTP
Input: 456789
Click: "Verify"

# 5. Complete registration (if new)
Given Name: John
Family Name: Doe
DOB: 1985-05-15
Click: "Complete Registration"

# 6. Access dashboard
View: Appointments, Medical History, Messages, etc.
```

---

## When to Move to Production

You can test everything in demo mode. Move to production when:
- ✅ All features tested and working
- ✅ Staff trained on the system
- ✅ Ready for real patients
- ✅ Budget approved for SMS/email costs

Then follow: `SECRETS_SETUP_GUIDE.md`

---

## Key Benefits of Demo Mode

1. **Zero Cost** - Test unlimited OTPs for free
2. **Instant** - No waiting for SMS delivery
3. **Reliable** - No dependency on external services
4. **Debugging** - See exact OTP codes in logs
5. **Training** - Perfect for staff training sessions

---

## What Works in Demo Mode

✅ **Everything!**
- User registration
- OTP authentication
- Session management  
- Patient dashboard
- Medical history viewing
- Appointment requests
- All portal features

The only difference: OTP delivery method (logs vs SMS/email)

---

## Next Steps

1. **Test Now**: Follow the steps above
2. **Train Staff**: Use demo mode for training
3. **UAT**: Get feedback from test patients
4. **Production**: Configure real OTP delivery when ready

See `SECRETS_SETUP_GUIDE.md` for production setup details.

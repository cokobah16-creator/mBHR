# 🏥 Med Bridge Health Reach - Acceptance Test Runbook

## 🎯 **10-Minute End-to-End Test**

### ✅ **A1: Login & Setup (1 min)**
1. Open http://localhost:5173
2. Should show login screen with "Offline PIN" tab active
3. Enter PIN: `123456`
4. Should login successfully and show Dashboard
5. **✓ Verify:** "Local Only" badge in header (yellow)

### ✅ **A2: Patient Registration (2 min)**
1. Click "Register Patient" from dashboard
2. Fill out form:
   - **Given Name:** John
   - **Family Name:** Doe
   - **Sex:** Male
   - **DOB:** 1990-01-01
   - **Phone:** 08012345678
   - **Address:** 123 Test Street, Lagos
   - **State:** Lagos
   - **LGA:** Ikeja
3. **Optional:** Tap camera icon to add photo
4. Click "Register Patient"
5. **✓ Verify:** Success message, redirected to dashboard
6. **✓ Verify:** Patient appears in Queue (Registration stage)

### ✅ **A3: Record Vitals (2 min)**
1. Go to Queue page
2. Find John Doe in Registration queue
3. Click "Start" button
4. Should navigate to vitals form
5. Enter vitals:
   - **Height:** 175 cm
   - **Weight:** 70 kg
   - **Temperature:** 37.5°C
   - **Pulse:** 85 bpm
   - **Blood Pressure:** 140/90 mmHg
   - **SpO2:** 98%
6. **✓ Verify:** BMI auto-calculates to 22.9
7. **✓ Verify:** "High BP" flag appears (red badge)
8. Click "Save Vitals"
9. **✓ Verify:** Patient moves to Vitals → Consult queue

### ✅ **A4: Consultation (2 min)**
1. Find John Doe in Consult queue
2. Click "Start" to begin consultation
3. **✓ Verify:** Patient info + vitals summary displayed
4. Fill SOAP notes:
   - **Subjective:** "Patient reports headache and dizziness"
   - **Objective:** "BP elevated at 140/90, otherwise normal exam"
   - **Assessment:** "Hypertension, likely essential. Rule out secondary causes."
   - **Plan:** "Start ACE inhibitor, lifestyle modifications, follow-up in 2 weeks"
5. Add diagnosis: "Essential Hypertension"
6. Click "Save Consultation"
7. **✓ Verify:** Patient moves to Consult → Pharmacy queue

### ✅ **A5: Pharmacy Dispensing (2 min)**
1. Find John Doe in Pharmacy queue
2. Click "Start" to begin dispensing
3. **✓ Verify:** Patient + consultation summary shown
4. Select medication: "Paracetamol 500mg"
5. Enter details:
   - **Quantity:** 20
   - **Dosage:** 500mg
   - **Directions:** "Take 1 tablet twice daily with food"
6. Click "Dispense Medication"
7. **✓ Verify:** Success message
8. **✓ Verify:** Go to Inventory - Paracetamol stock decreased by 20

### ✅ **A6: Offline Resilience Test (1 min)**
1. **Enable airplane mode** or disconnect internet
2. **Hard refresh** browser (Ctrl+F5)
3. **✓ Verify:** App still loads, shows "Offline" badge (red)
4. **✓ Verify:** All patient data still visible
5. **Try registering new patient** while offline
6. **✓ Verify:** Registration works normally
7. Re-enable internet
8. **✓ Verify:** Badge changes back to "Local Only" (yellow)

### ✅ **A7: Data Export (1 min)**
1. Go to Dashboard
2. **✓ Verify:** "Data Export" section visible (admin only)
3. Click "Patients" export button
4. **✓ Verify:** CSV file downloads with patient data
5. Click "Export All Data (JSON)" 
6. **✓ Verify:** JSON file downloads with complete dataset

## 🎉 **Success Criteria**

**✅ All tests pass = MVP Ready!**

- Offline-first architecture working
- PIN authentication secure
- Patient workflow complete (Registration → Vitals → Consult → Pharmacy)
- Data persistence across browser refreshes
- Role-based access (admin features)
- Export functionality working

## 🚨 **Common Issues & Fixes**

**Login fails:** Check browser console, may need to clear IndexedDB
**Vitals flags not showing:** Verify values exceed thresholds (BP ≥140/90, etc.)
**Export not visible:** Ensure logged in as admin role
**Offline test fails:** Check service worker registration in DevTools

---

**🏆 Ready for Step B: Supabase Sync Setup!**
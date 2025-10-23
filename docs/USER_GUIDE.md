# mBHR User Guide

**Version:** 1.0
**For:** Community Health Workers, Nurses, Doctors, and Pharmacists
**Language:** English (Hausa, Igbo, Yoruba, and Pidgin versions available in app)

---

## 🏥 Welcome to mBHR!

mBHR (Med Bridge Health Reach) is your offline-first medical records system for community health outreach. This guide will help you get started and make the most of the application.

---

## 📱 Getting Started

### Installing the App

**On Android:**
1. Open the mBHR website in Chrome
2. Tap the menu (⋮) in top right
3. Select "Install app" or "Add to Home screen"
4. Tap "Install"
5. App icon appears on your home screen

**On iPhone/iPad:**
1. Open the mBHR website in Safari
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Give it a name
5. Tap "Add"

### First Time Login

1. Tap the mBHR icon on your home screen
2. Enter your email and password
3. Tap "Login"
4. You'll see the Dashboard

**Important:** Remember your password! Contact your administrator if you forget it.

---

## 🌐 Working Offline

### What is Offline Mode?

mBHR works **completely offline**! You can:
- Register patients
- Record vitals
- Write notes
- Prescribe medications
- Dispense drugs

All without internet!

### How Offline Works

1. **Saving:** Everything you do is saved to your device immediately
2. **Syncing:** When internet returns, data automatically syncs to the cloud
3. **Conflicts:** If two people edit the same patient, you'll be asked which version to keep

### Sync Indicators

Look at the top right of the screen:

- **Green checkmark ✓:** Everything synced
- **Blue number badge:** Operations waiting to sync
- **Red badge:** Some operations failed (will retry automatically)
- **Spinning arrow:** Syncing now

### Tips for Offline Work

✅ **DO:**
- Work normally without worrying about internet
- Let the app auto-sync when internet is available
- Check sync status before end of shift

❌ **DON'T:**
- Force close the app while syncing
- Clear browser data without syncing first
- Use multiple devices with same login simultaneously

---

## 👥 Patient Registration

### Finding an Existing Patient

1. From Dashboard, tap "Patients" or use search box
2. Type patient name or phone number
3. Matching patients appear as you type
4. Tap patient name to open their record

**Search Tips:**
- Use first name, last name, or both
- Phone numbers work best for exact matches
- Partial matches are shown (e.g., "Ade" finds "Adebayo")

### Registering a New Patient

1. From Dashboard or Patients page, tap **"Register Patient"**
2. Fill in required fields (marked with *):
   - Given Name (first name)
   - Family Name (last name)
   - Sex (Male/Female/Other)
   - Date of Birth
   - Phone Number
   - Address
   - State
   - LGA (Local Government Area)

3. **Optional:** Take a photo
   - Tap camera icon
   - Allow camera access
   - Position patient's face in frame
   - Tap "Capture Photo"
   - Review and "Use Photo" or "Retake"

4. Tap **"Register Patient"**

### Duplicate Detection

If mBHR finds similar patients, you'll see a warning:

**"Possible Duplicate Patient Found"**

Options:
- **This is a new patient:** Proceed with registration
- **This is patient [name]:** Use the existing patient instead

This prevents duplicate records!

### Photo Guidelines

✅ **Good Photo:**
- Face clearly visible
- Good lighting
- Neutral expression
- No sunglasses or hats

❌ **Avoid:**
- Blurry or dark photos
- Multiple people in frame
- Extreme angles

---

## 🩺 Recording Vital Signs

### Taking Vitals

1. Find the patient
2. Tap **"Add Vitals"** from patient detail page or Queue
3. Enter measurements:
   - **Height** (cm)
   - **Weight** (kg)
   - **Temperature** (°C)
   - **Pulse** (beats per minute)
   - **Blood Pressure** (systolic/diastolic)
   - **SpO2** (oxygen saturation %)

4. BMI calculates automatically
5. Tap **"Save Vitals"**

### Understanding Flags

Abnormal vitals are **automatically flagged**:

- **🔴 High BP:** Systolic >140 or Diastolic >90
- **🔴 Low BP:** Systolic <90 or Diastolic <60
- **🔴 High Temp:** >38°C
- **🔴 Low Temp:** <35°C
- **🔴 High Pulse:** >100 bpm
- **🔴 Low Pulse:** <60 bpm
- **🔴 Low SpO2:** <95%
- **🔴 High BMI:** >30 (obese)
- **🔴 Low BMI:** <18.5 (underweight)

Flagged vitals appear in **red** and alert clinicians to review.

### Vital Signs Tips

✅ **Best Practices:**
- Take multiple readings if abnormal
- Note patient position (sitting/standing)
- Wait 5 minutes after activity
- Use calibrated equipment

---

## 📋 Queue Management

### Using the Queue

The queue tracks patient flow through:
1. **Registration** → New arrivals
2. **Vitals** → Awaiting vital signs
3. **Consultation** → Awaiting doctor/nurse
4. **Pharmacy** → Awaiting medication
5. **Complete** → Done

### Moving Patients

1. Go to **"Queue"** from menu
2. Find the patient
3. Tap their card
4. Tap **"Move to [Next Stage]"**

### Queue Board View

Large display for waiting area:
- Shows ticket numbers
- Current stage
- Estimated wait time
- Called patients highlighted

Access: **Menu** → **"Queue Board"**

---

## 📝 Clinical Documentation (Nurses/Doctors)

### SOAP Notes

**SOAP** = Subjective, Objective, Assessment, Plan

1. Find patient from Queue or Search
2. Tap **"Start Consultation"**
3. Review vitals (if recorded)
4. Document:
   - **Subjective:** Patient's complaints in their words
   - **Objective:** Your observations and exam findings
   - **Assessment:** Your diagnosis or impression
   - **Plan:** Treatment plan and follow-up

5. Add **Provisional Diagnosis** (ICD codes if available)
6. Tap **"Save Consultation"**

### Writing Prescriptions

During or after consultation:

1. Tap **"Add Prescription"**
2. Enter:
   - **Medication Name**
   - **Dosage** (e.g., "500mg")
   - **Frequency** (e.g., "2x daily")
   - **Duration** (e.g., "7 days")
   - **Directions** (e.g., "Take with food")

3. Tap **"Add" **
4. Repeat for additional medications
5. Tap **"Save Prescription"**

Prescription sends to pharmacy queue.

---

## 💊 Pharmacy (Pharmacists)

### Dispensing Workflow

1. Go to **"Pharmacy"** from menu
2. View **"Pending Dispenses"**
3. Select patient prescription
4. For each medication:
   - Verify medication name
   - Check stock availability
   - Select batch (FEFO - First Expiry First Out)
   - Enter quantity dispensed
   - Note if any changes from prescription

5. Tap **"Dispense"**
6. Print label or write on medication package

### FEFO (First Expiry First Out)

mBHR **automatically suggests** which batch to dispense:
- Batches closest to expiry appear first
- Prevents waste from expired stock
- Alerts if batch expires within 30 days

### Stock Management

**Adding Stock:**
1. Go to **"Pharmacy"** → **"Stock"**
2. Tap **"Add Stock"**
3. Enter:
   - Item name
   - Batch number
   - Expiry date
   - Quantity received
   - Unit (tablets, ml, etc.)

4. Tap **"Add"**

**Low Stock Alerts:**
- Items below reorder threshold appear in red
- Notification badge on Pharmacy menu
- Print stock report for procurement

**Expiry Monitoring:**
- Items expiring within 30 days flagged
- Items expiring within 7 days appear in red
- Notifications to remove expired items

---

## 🎮 Gamification (Optional Feature)

### Earning Points

You earn points for:
- Registering patients: 10 pts
- Recording vitals: 5 pts
- Completing consultations: 15 pts
- Dispensing medications: 5 pts
- Daily login streak: 5 pts

### Leaderboards

See top performers:
- **Daily:** Today's points
- **Weekly:** This week's points
- **Monthly:** This month's points
- **All-Time:** Total career points

### Mini-Games

Fun challenges to improve skills:
- **Vitals Precision:** Practice reading vitals accurately
- **Queue Maestro:** Optimize patient flow
- **Triage Sprint:** Quick triage decisions
- **Knowledge Blitz:** Medical knowledge quiz

Access: **Menu** → **"Games"**

---

## 🔐 Privacy & Security

### Patient Confidentiality

- Never share login credentials
- Lock device when stepping away
- Don't discuss patient details in public
- Only access records you need for care

### Data Security

- All data encrypted
- Sync over secure connection (HTTPS)
- Photos stored securely
- Regular backups maintained

### Role Permissions

You can only access features for your role:
- **CHW:** Registration, vitals, queue
- **Nurse:** CHW + consultations, triage
- **Doctor:** Nurse + prescriptions, care plans
- **Pharmacist:** Dispensing, inventory
- **Admin:** All features + user management

---

## 🆘 Troubleshooting

### App won't load
- Check internet connection (first time)
- Clear browser cache
- Reinstall PWA
- Contact administrator

### Can't login
- Verify email and password
- Check internet connection
- Request password reset from admin
- Try different device

### Data not syncing
- Check internet connection
- Look for sync status icon
- Wait for automatic retry
- Manually tap sync button
- Check with administrator if persistent

### Photo won't capture
- Allow camera permissions
- Check camera is working in other apps
- Try different browser
- Use file upload instead

### Patient not found
- Try different search terms
- Check spelling
- Use phone number if available
- Patient may be newly registered (wait for sync)

---

## 💡 Pro Tips

### Speed Up Your Workflow

1. **Use Search:** Faster than scrolling lists
2. **Take Photos:** Helps with patient identification
3. **Add Notes:** Future you will thank you
4. **Check Vitals:** Before seeing doctor saves time
5. **Batch Similar Tasks:** Register all patients, then vitals, etc.

### Improve Data Quality

1. **Verify Phone Numbers:** Critical for follow-up
2. **Complete Addresses:** Helps with home visits
3. **Accurate Vitals:** Double-check abnormal readings
4. **Detailed SOAP Notes:** Helps next provider
5. **Review Before Saving:** Catch typos early

### Work Smarter Offline

1. **Start Day Online:** Sync latest data
2. **Work Offline:** Don't worry about connection
3. **End Day Online:** Sync before going home
4. **Check Sync Status:** Green checkmark = all good
5. **Resolve Conflicts:** If prompted, review carefully

---

## 📞 Getting Help

### In-App Help

- Tap **"?"** icon for context help
- Audio prompts in multiple languages
- Tooltips on hover/tap

### Training Resources

- Video tutorials (coming soon)
- Quick reference cards
- Training sessions with supervisor

### Support Contacts

- **Technical Issues:** Contact IT support
- **Clinical Questions:** Consult supervisor
- **Training:** Request additional training
- **Feedback:** Share ideas for improvement

---

## 🌍 Language Support

mBHR supports 5 languages:
- **English**
- **Hausa** (Hausa)
- **Igbo** (Igbo)
- **Yoruba** (Yorùbá)
- **Pidgin** (Nigerian Pidgin)

**To change language:**
1. Tap language selector (top right)
2. Select your preferred language
3. App updates immediately

---

## ✅ Quick Reference

### Daily Workflow

**Morning:**
1. Login to app
2. Check sync status
3. Review queue
4. Plan day's tasks

**During Shift:**
1. Register new patients
2. Record vitals
3. Manage queue
4. Document encounters
5. Dispense medications

**End of Shift:**
1. Complete pending tasks
2. Check sync status (green checkmark)
3. Logout (optional)

### Keyboard Shortcuts (Desktop)

- **Ctrl+/** : Search patients
- **Ctrl+N:** New patient
- **Ctrl+Q:** Open queue
- **Ctrl+P:** Open pharmacy
- **Esc:** Close modal/dialog

---

## 📚 Appendices

### Common Abbreviations

- **BP:** Blood Pressure
- **BMI:** Body Mass Index
- **CHW:** Community Health Worker
- **FEFO:** First Expiry First Out
- **LGA:** Local Government Area
- **PWA:** Progressive Web App
- **RLS:** Row Level Security
- **SOAP:** Subjective, Objective, Assessment, Plan
- **SpO2:** Oxygen Saturation

### Units of Measurement

- **Height:** Centimeters (cm)
- **Weight:** Kilograms (kg)
- **Temperature:** Celsius (°C)
- **Blood Pressure:** mmHg
- **Pulse:** Beats per minute (bpm)
- **SpO2:** Percentage (%)

---

**Thank you for using mBHR to provide excellent care to your community!** 🏥

*For the latest version of this guide, visit the app's Help section.*

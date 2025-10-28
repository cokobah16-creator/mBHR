# Issue Ticket Tab - Quick Reference Guide

## How to Use

### Adding a Patient to Queue

1. **Navigate**: Click "Issue Tickets" in the sidebar menu
2. **Search Patient**: Type patient name or phone number in search box
3. **Select Patient**: Click on the patient from search results
4. **Choose Stage**: Select which queue stage to add patient to:
   - **Registration** - Patient needs to be registered first
   - **Vitals** - Patient needs vital signs recorded (recommended)
   - **Consultation** - Patient ready to see doctor
   - **Pharmacy** - Patient needs medication dispensed

5. **Choose Priority**:
   - **Normal** - Standard priority, added to end of queue
   - **Urgent** - High priority, moves to front of queue
   - **Low Priority** - Non-critical cases

6. **Submit**: Click "Add to [Stage] Queue" button

### What You'll See

**Success Message Shows**:
- Patient name and stage
- Queue position number
- Urgent badge (if applicable)

**Queue Statistics Shows**:
- Real-time count of patients in each stage
- Updates automatically every 5 seconds

## Features List

### Working Features ✓

1. **Patient Search**
   - Search by name (first or last)
   - Search by phone number
   - Shows patient photo, demographics
   - Displays up to 5 results
   - 300ms debounce for performance

2. **Stage Selection**
   - 4 stages available
   - Clear descriptions
   - Help text for each stage

3. **Priority Selection** (NEW)
   - Normal, Urgent, Low
   - Dynamic help text
   - Urgent patients jump queue

4. **Add to Queue**
   - Validates patient exists
   - Prevents duplicates
   - Shows queue position
   - Tracks staff member
   - Error handling

5. **Queue Statistics**
   - Live counts per stage
   - Color-coded display
   - Auto-refresh every 5s

6. **Navigation**
   - Link to Queue Board
   - Link back to Dashboard

### What's Fixed

- ✓ Patient search now loads data properly
- ✓ Priority selection available
- ✓ Duplicate detection works correctly
- ✓ Queue position shown after adding
- ✓ Error messages are clear and helpful
- ✓ Success state shows for 3 seconds
- ✓ Staff member tracked for each addition
- ✓ All form fields reset after success

## Common Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Please select a patient" | No patient selected | Search and select a patient first |
| "User session expired" | Login expired | Log in again |
| "Patient not found" | Invalid patient ID | Search for patient again |
| "Patient is already in queue at [stage]" | Duplicate entry | Patient already queued, check Queue Board |
| "Failed to load patient data" | Database error | Refresh page or contact admin |

## Tips

1. **Urgent Patients**: Use urgent priority for emergencies - they'll be seen first
2. **Queue Position**: Lower numbers = sooner service (Position #1 is next)
3. **Stage Selection**: Most patients start at Vitals unless they need registration first
4. **Check Statistics**: Before adding, check queue counts to see wait times
5. **View Queue**: Click "View Queue" to see full queue board with all patients

## Keyboard Shortcuts

- **Tab**: Navigate between fields
- **Enter**: Submit form (when all fields filled)
- **Escape**: Clear search (when in search field)

## Integration with Other Features

### Queue Board
- Patients added here appear immediately in Queue Board
- Queue position determines display order
- Status updates in real-time

### Doctor Dashboard
- Patients in consultation queue appear in Doctor Station
- Urgent patients highlighted at top
- Shows patient details, vitals, history

### Patient Registration
- New patients automatically added to registration queue
- Queue item created with normal priority
- Tracked by system user

## Data Tracked

Each queue entry records:
- Patient ID
- Stage (registration/vitals/consult/pharmacy)
- Position in queue
- Status (waiting/in_progress/done)
- Priority (urgent/normal/low)
- Staff member who added patient
- Timestamp when added
- Last update timestamp

## Reporting

Queue data can be used for:
- Wait time analysis
- Staff performance tracking
- Patient flow optimization
- Peak hour identification
- Bottleneck detection

## Troubleshooting

**Search shows no results**:
- Check spelling
- Try phone number instead
- Patient might not be registered yet

**Can't add to queue**:
- Check if patient already in queue
- Verify you're logged in
- Refresh page and try again

**Statistics not updating**:
- Wait 5 seconds for auto-refresh
- Manually refresh page if needed
- Check internet connection

**Queue position seems wrong**:
- Position is relative to current queue
- Urgent patients are always first
- Check Queue Board for full picture

## Questions?

See `ISSUE_TICKET_FIX_SUMMARY.md` for technical details and all changes made.

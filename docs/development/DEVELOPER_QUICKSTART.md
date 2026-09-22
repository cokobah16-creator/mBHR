# mBHR Developer Quick Start Guide

## Understanding the Database Architecture

### Two-Tier System
```
┌─────────────────────────────────────┐
│   Browser (Offline-First)           │
│   ┌─────────────────────────────┐   │
│   │  Dexie/IndexedDB            │   │
│   │  (Local Storage)            │   │
│   └─────────────┬───────────────┘   │
│                 │ Sync              │
│                 ↕                   │
└─────────────────┼───────────────────┘
                  │
┌─────────────────┼───────────────────┐
│   Cloud Backend │                   │
│   ┌─────────────┴───────────────┐   │
│   │  Supabase PostgreSQL        │   │
│   │  (Cloud Storage)            │   │
│   └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Important:** There is NO separate "Bolt Database". Supabase PostgreSQL IS your cloud database.

---

## Quick Setup

### 1. Apply New Migration

```bash
# In Supabase SQL Editor, run:
supabase/migrations/20251024120000_add_missing_gamification_tables.sql
```

This adds 13 missing tables to achieve 100% parity between Dexie and Supabase.

### 2. Seed Vitals Reference Ranges

```typescript
import { seedVitalsRanges } from '@/db/seedVitalsRanges'

// Run once in browser console or setup script
await seedVitalsRanges()
```

### 3. Test Enhanced Sync

```typescript
import { enhancedSync } from '@/services/enhancedSync'

// Check if initialized
console.log(enhancedSync.isInitialized()) // true

// Get pending changes
const pending = await enhancedSync.getPendingChangesCount()
console.log(`${pending} changes waiting to sync`)

// Perform full sync
const result = await enhancedSync.syncAll()
console.log(result) // { success: true, pushed: 5, pulled: 3, conflicts: 0 }
```

---

## Using New Features

### Patient Deduplication

```typescript
import { patientDeduplication } from '@/services/patientDeduplication'

// Find potential duplicates
const candidates = await patientDeduplication.findDuplicates({
  givenName: 'Mohammed',
  familyName: 'Ibrahim',
  phone: '08012345678',
  dob: new Date('1990-01-15'),
  address: 'Lagos'
})

// candidates = [
//   {
//     patient: { id: '...', givenName: 'Muhammad', ... },
//     score: 0.92,
//     matchReasons: [
//       'Names sound similar (phonetic match)',
//       'Exact phone number match',
//       'Overall match confidence: 92%'
//     ]
//   }
// ]

// Merge patients if duplicate confirmed
await patientDeduplication.mergePatients(
  'winner-id',
  'loser-id',
  'current-user-id'
)

// Get merge history
const history = await patientDeduplication.getMergeHistory('patient-id')
```

### Queue Management

```typescript
import { queueManagement } from '@/services/queueManagement'

// Add patient to queue with priority
await queueManagement.addToQueue(
  'patient-id',
  'vitals', // stage: registration | vitals | consult | pharmacy
  'urgent'  // priority: urgent | normal | low
)

// Get current queue
const queue = await queueManagement.getQueueWithPatients('vitals')

// Move to next stage
await queueManagement.moveToNextStage('patient-id')

// Skip to front (for emergencies)
await queueManagement.skipQueue('patient-id', 'medical emergency')

// Get statistics
const stats = await queueManagement.getQueueStats('vitals')
// stats = {
//   stage: 'vitals',
//   waiting: 5,
//   inProgress: 2,
//   done: 23,
//   averageWaitTime: 12 // minutes
// }

// Subscribe to real-time updates
const unsubscribe = queueManagement.subscribe('vitals', (items) => {
  console.log('Queue updated:', items.length, 'items')
})

// Enable Supabase realtime sync
await queueManagement.setupRealtimeSync('vitals')
```

### Vitals Range Checking

```typescript
import {
  checkVitalInRange,
  flagAbnormalVitals,
  getVitalsInterpretation
} from '@/db/seedVitalsRanges'

// Check single vital
const hrCheck = await checkVitalInRange(
  5, // age in years
  'M', // sex: M | F | U
  'hr', // metric
  135 // value
)
// hrCheck = {
//   inRange: false,
//   low: false,
//   high: true,
//   reference: { min: 70, max: 120, ... }
// }

// Get all abnormal flags
const flags = await flagAbnormalVitals(5, 'M', {
  pulseBpm: 135,
  tempC: 38.5,
  systolic: 110,
  diastolic: 70,
  spo2: 97
})
// flags = [
//   'High heart rate (tachycardia)',
//   'High temperature (fever)'
// ]

// Get full interpretation
const interpretation = await getVitalsInterpretation(5, 'M', {
  pulseBpm: 135,
  tempC: 38.5,
  systolic: 110,
  diastolic: 70,
  spo2: 97
})
// interpretation = {
//   severity: 'moderate',
//   flags: ['High heart rate (tachycardia)', 'High temperature (fever)'],
//   recommendations: [
//     'Close monitoring required',
//     'Consider escalation to physician'
//   ]
// }
```

### Sync Dashboard

```typescript
import { SyncDashboard } from '@/components/SyncDashboard'

// Use in your admin/settings page
function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <SyncDashboard />
    </div>
  )
}
```

---

## Database Schema Reference

### Key Tables and Relationships

```
patients (1) ←──┬─→ (∞) visits
                ├─→ (∞) vitals
                ├─→ (∞) consultations
                ├─→ (∞) dispenses
                ├─→ (∞) queue
                ├─→ (∞) triage_records
                ├─→ (∞) patient_allergies
                ├─→ (∞) patient_preferences
                └─→ (∞) care_tasks

inventory (1) ←─┬─→ (∞) stock_batches
                └─→ (∞) inventory_discrepancies

dispenses (1) ──→ (∞) medication_reminders

visits (1) ──────→ (∞) lab_orders
lab_orders (1) ──→ (∞) lab_results

patients (1) ────→ (∞) appointments

app_users (1) ───→ (∞) game_sessions
app_users (1) ───→ (1) gamification_wallets
```

### Critical Fields

#### Sync Fields (all syncable tables):
- `_dirty: number` - 0 = clean, 1 = needs sync
- `_syncedAt: string` - ISO timestamp of last sync

#### Patient Deduplication Fields:
- `phoneN: string` - Normalized phone (digits only)
- `nameKey: string` - Metaphone phonetic key
- `dobDay: number` - Epoch day for fast matching
- `mergeInto: string` - ID of merged-into patient

---

## Common Patterns

### Creating a New Syncable Entity

1. **Add to Dexie schema** (`src/db/index.ts`):
```typescript
export interface MyEntity {
  id: string
  someField: string
  createdAt: Date
  updatedAt: Date
  _dirty?: number
  _syncedAt?: string
}

// In MBHRDatabase class:
myEntities!: Table<MyEntity>

// In version definition:
this.version(11).stores({
  // ... existing tables
  myEntities: 'id, someField, createdAt, _dirty, _syncedAt'
})
```

2. **Create Supabase migration**:
```sql
CREATE TABLE IF NOT EXISTS my_entities (
  id text PRIMARY KEY,
  some_field text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE my_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view"
  ON my_entities FOR SELECT
  TO authenticated
  USING (true);

-- Add appropriate INSERT/UPDATE/DELETE policies

CREATE INDEX IF NOT EXISTS idx_my_entities_field ON my_entities(some_field);

CREATE TRIGGER update_my_entities_updated_at
  BEFORE UPDATE ON my_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

3. **Add to enhanced sync** (`src/services/enhancedSync.ts`):
```typescript
{
  localTable: 'myEntities',
  remoteTable: 'my_entities',
  hasDirtyFlag: true,
  localToRemote: (local) => ({
    id: local.id,
    some_field: local.someField,
    created_at: local.createdAt.toISOString(),
    updated_at: local.updatedAt.toISOString()
  }),
  remoteToLocal: (remote) => ({
    id: remote.id,
    someField: remote.some_field,
    createdAt: new Date(remote.created_at),
    updatedAt: new Date(remote.updated_at),
    _dirty: 0,
    _syncedAt: new Date().toISOString()
  })
}
```

### Triggering a Sync

```typescript
// Mark record as dirty
await db.myEntities.update(id, {
  someField: newValue,
  updatedAt: new Date(),
  _dirty: 1
})

// Sync will pick it up next time
await enhancedSync.syncAll()
```

---

## Debugging Tips

### Check Local Database

```typescript
// Open browser console
const { db } = await import('@/db')

// Count records
await db.patients.count()

// Find dirty records
await db.patients.where('_dirty').equals(1).toArray()

// Check specific patient
await db.patients.get('patient-id')
```

### Check Sync Status

```typescript
const { enhancedSync } = await import('@/services/enhancedSync')

// Pending changes
await enhancedSync.getPendingChangesCount()

// Last sync per table
enhancedSync.getLastSyncTime('patients')

// Is currently syncing
enhancedSync.isSyncing()
```

### Test Deduplication Algorithm

```typescript
const { patientDeduplication } = await import('@/services/patientDeduplication')

// Create test patients
await db.patients.bulkAdd([
  {
    id: 'test-1',
    givenName: 'Mohammed',
    familyName: 'Ali',
    phone: '08012345678',
    dob: '1990-01-15',
    // ... other required fields
  },
  {
    id: 'test-2',
    givenName: 'Muhammad',
    familyName: 'Ali',
    phone: '2348012345678', // Same phone, different format
    dob: '1990-01-15',
    // ... other required fields
  }
])

// Find duplicates
const dups = await patientDeduplication.findDuplicates({
  givenName: 'Mohammed',
  familyName: 'Ali',
  phone: '08012345678',
  dob: new Date('1990-01-15')
})

console.log(dups) // Should find test-2 with high score
```

---

## Performance Considerations

### Sync Batch Size
Current: 100 records per batch per table
Adjust in `enhancedSync.ts` if needed for your network conditions.

### Deduplication Threshold
Current: 0.7 (70% confidence)
Adjust in `patientDeduplication.ts` if too sensitive/lenient.

### Queue Auto-Escalation
Current: 60 minutes max wait time
Adjust in `queueManagement.ts` based on your clinic flow.

---

## Troubleshooting

### Sync Failing

1. Check Supabase connection:
```typescript
const { supabase } = await import('@/lib/supabase')
const { data, error } = await supabase.from('patients').select('count')
console.log(data, error)
```

2. Check for conflicts:
```typescript
await db.conflictResolutions.where('status').equals('pending').toArray()
```

3. Clear dirty flags if stuck:
```typescript
// DANGER: Only in development!
await db.patients.toCollection().modify({ _dirty: 0 })
```

### Deduplication Too Sensitive

Lower the threshold:
```typescript
import { PatientDeduplication } from '@/services/patientDeduplication'

const dedupe = new PatientDeduplication({
  threshold: 0.8 // Increase from 0.7
})
```

### Queue Not Updating

1. Check subscription:
```typescript
const unsub = queueManagement.subscribe('vitals', (items) => {
  console.log('Update received:', items)
})
```

2. Force reorder:
```typescript
await queueManagement['reorderQueue']('vitals')
```

---

## Best Practices

1. **Always mark records as dirty** when modifying offline
2. **Sync before critical operations** (e.g., before closing clinic)
3. **Handle conflicts promptly** - don't let them accumulate
4. **Use phonetic matching** for Nigerian names (built-in)
5. **Test with real data** - names, phones, addresses
6. **Monitor sync metrics** - use SyncDashboard regularly
7. **Seed vitals ranges** - required for clinical decision support
8. **Enable realtime** for collaborative features (queue, etc.)

---

## Support

- Architecture: See `docs/ARCHITECTURE.md`
- Enhancement Details: See `ENHANCEMENT_SUMMARY.md`
- User Guide: See `docs/USER_GUIDE.md`
- Testing: See `docs/TESTING_GUIDE.md`

---

*Last Updated: October 24, 2025*

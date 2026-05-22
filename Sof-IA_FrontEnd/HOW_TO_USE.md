# Unified Storage Interface - How to Use

> **API reference:** For the complete `IRepository` interface, see the **Repository Layer** section of [`HOW_TO_USE_CAPABILITIES.md`](./HOW_TO_USE_CAPABILITIES.md). This guide covers setup, common patterns, and troubleshooting.

Complete guide for using the unified storage system in your React Native/Web app with automatic data cleanup and cross-platform support.

---

## Quick Start

### 1. Install Dependencies
```bash
cd Sof-IA_FrontEnd
npm install --legacy-peer-deps
```

### 2. Run Tests
```bash
npm test
```

### 3. Start the App
```bash
npx expo start
```

Then press:
- **`w`** for Web (IndexedDB via Dexie)
- **`a`** for Android (SQLite)
- **`i`** for iOS (SQLite)

### 4. Verify Bootstrap
In console, you should see:
```
[Bootstrap] Initializing storage...
[Bootstrap] Storage initialized successfully
[Bootstrap] Purging expired records...
[Bootstrap] Purged 0 expired record(s)
```

---

## Using the Storage Interface

### Basic CRUD Operations

```typescript
import { getStorage } from '@/repositories';

const storage = await getStorage();

// CREATE
const session = await storage.create('sessions', {
  nurse_name: 'R.N. Martinez',
  started_at: new Date().toISOString(),
  status: 'active',
  device_id: 'device_123',
  app_version: '1.0.0',
  patient_count: 0,
  total_recording_duration: 0,
  synced: false,
});

// READ
const found = await storage.read('sessions', session.id);

// UPDATE
await storage.update('sessions', session.id, {
  patient_count: 5,
  status: 'ended',
  ended_at: new Date().toISOString(),
});

// DELETE
await storage.delete('sessions', session.id);
```

### Query Operations

```typescript
// Find all records where a field matches a value
const activeSessions = await storage.findByField(
  'sessions',
  'status',
  'active'
);

// Find all records for a session (shift-scoped query)
const sessionPatients = await storage.queryBySession('patients', sessionId);

// Find card-type records scoped to a session and bed
const meds = await storage.queryBySessionAndBed(
  'medications',
  sessionId,
  bedId
);
```

### Relationships

```typescript
// Get all patients for a session
const patients = await storage.findByField(
  'patients',
  'session_id',
  session.session_id
);

// Get all recordings for a patient
const recordings = await storage.findByField(
  'audio_recordings',
  'patient_id',
  patient.id
);

// Get transcriptions for a recording
const transcriptions = await storage.findByField(
  'transcriptions',
  'audio_recording_id',
  recording.id
);
```

### Bulk Operations

```typescript
// Batch create — create multiple records in parallel
const patients = [
  { nombre: 'John', edad: 45, session_id: sessionId },
  { nombre: 'Jane', edad: 38, session_id: sessionId },
];
await Promise.all(patients.map(p => storage.create('patients', p)));

// Bulk delete — delete all records matching a where clause
await storage.bulkDelete('patients', { session_id: sessionId });

// Bulk delete with operator (e.g. old records)
await storage.bulkDelete('audio_recordings', {
  field: 'created_at',
  operator: '<',
  value: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
});
```

---

## Using SessionService

SessionService provides high-level session management using the storage interface.

### API Reference

```typescript
import SessionService from '@/services/SessionService';

// Get/Save nurse name (UI preference)
const name = await SessionService.getNurseName();
await SessionService.saveNurseName('RN. Martinez');

// Start a shift
const session = await SessionService.startShift('RN. Martinez');

// Get active shift
const activeShift = await SessionService.getActiveShift();

// Check if shift is active
const isActive = await SessionService.hasActiveShift();

// End shift
const endedSession = await SessionService.endShift();

// Get active session ID
const sessionId = await SessionService.getActiveSessionId();

// Update shift statistics
await SessionService.incrementPatientCount();
await SessionService.addRecordingDuration(120); // seconds

// Clear cache (if needed)
SessionService.clearCache();
```

### Typical Workflow

```typescript
// 1. App Launch - Check for active shift
const hasActive = await SessionService.hasActiveShift();

if (hasActive) {
  // Resume shift - navigate to Dashboard
  navigation.navigate('Dashboard');
} else {
  // No active shift - show mode selection
  navigation.navigate('ModeSelection');
}

// 2. Start Shift
const session = await SessionService.startShift('Dr. Martinez');
console.log('Shift started:', session.session_id);

// 3. During Shift - Track activity
await SessionService.incrementPatientCount();
await SessionService.addRecordingDuration(180);

// 4. End Shift
const ended = await SessionService.endShift();
console.log('Shift ended:', ended.ended_at);
```

---

## Data Management

### Automatic Data Cleanup (TTL)

Records expire according to per-entity retention policies. On app launch, `purgeExpired()` removes all records whose `expires_at` has passed:

| Entity | Retention |
|--------|-----------|
| Sessions | 30 days after shift ends |
| Audio recordings | 7 days or end-of-shift |
| Transcriptions | 14 hours from session start |
| Patients / clinical notes | Purged when session expires |

```typescript
// Called automatically in App.js on bootstrap
const purgedCount = await storage.purgeExpired();
console.log(`Purged ${purgedCount} expired record(s)`);
```

### Manual Cleanup

```typescript
// Purge all expired records
const count = await storage.purgeExpired();

// Delete all records for a session
await storage.bulkDelete('patients', { session_id: sessionId });
```

### Health Monitoring

```typescript
import { StorageFactory } from './src/repositories/adapters';

const health = StorageFactory.getHealth();
console.log('Storage healthy:', health.healthy);
console.log('Last check:', health.lastCheck);
console.log('Error count:', health.errorCount);
```

---

## Platform-Specific Features

### Web (IndexedDB via Dexie)

**View Data in Browser:**
1. Open Chrome DevTools (F12)
2. Application tab → IndexedDB → `sofia_db`
3. Click `sessions` to view records

**Features:**
- Compound indexes for multi-field queries
- Schema versioning
- Transaction support
- Type-safe API via Dexie

### Android/iOS (SQLite)

**Features:**
- WAL mode for concurrent reads
- Foreign key constraints
- 20+ performance indexes
- Prepared statements (SQL injection protection)
- Automatic migrations

**Location:**
- Stored by `expo-sqlite` under the app's document directory in an `SQLite/` subfolder (database file `sofia.db`). The exact absolute path varies by OS and is managed by Expo.

---

## Testing

### Run All Tests
```bash
npm test
```

### Run Specific Tests
```bash
npm run test:dexie      # Web adapter only
npm run test:sqlite     # Mobile adapter only
npm run test:factory    # Factory tests
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

### Test Checklist
- [ ] `npm test` → all tests pass
- [ ] Start app on Web → Session persists
- [ ] Start app on Android → Session persists
- [ ] Close/reopen app → Auto-navigates to Dashboard
- [ ] Bootstrap logs show "Storage initialized successfully"
- [ ] Bootstrap logs show "Purged X expired record(s)"

---

## Testing Your Implementation

### Test 1: Storage Initialization
1. Start app: `npx expo start`
2. Press `w` for Web
3. Check console for bootstrap logs

### Test 2: Session Persistence
1. Enter name → "Start working!"
2. Close browser tab
3. Reopen app
4. **Should navigate directly to Dashboard** (session persisted)

### Test 3: Verify Data
**On Web:**
1. F12 → Application → IndexedDB → sofia_db → sessions
2. You should see your session record

**On Mobile:**
Use a SQLite viewer app or export the database

### Test 4: Cleanup
```typescript
// Create expired session
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
await storage.create('sessions', {
  session_id: 'test_expired',
  expires_at: yesterday,
  // ... other fields
});

// Purge
const count = await storage.purgeExpired();
console.log('Purged:', count); // Should be 1

// Verify deleted
const found = await storage.read('sessions', 'test_expired');
console.log('Found:', found); // Should be null
```

---

## Common Patterns

### Pattern 1: Find or Create
```typescript
async function findOrCreateSession(nurseName: string) {
  // Check for active session
  const active = await storage.findByField('sessions', 'status', 'active');

  if (active.length > 0) {
    return active[0];
  }

  // Create new session
  return await storage.create('sessions', {
    nurse_name: nurseName,
    status: 'active',
    // ... other fields
  });
}
```

### Pattern 2: Cascading Delete
```typescript
async function deleteSessionAndRelated(sessionId: string) {
  const session = await storage.read('sessions', sessionId);
  if (!session) return;

  // Delete related data
  await storage.bulkDelete('patients', { session_id: session.session_id });
  await storage.bulkDelete('audio_recordings', { session_id: session.session_id });

  // Delete session
  await storage.delete('sessions', sessionId);
}
```

### Pattern 3: Aggregate Stats
```typescript
async function getSessionStats(sessionId: string) {
  const session = await storage.read('sessions', sessionId);
  const patients = await storage.findByField('patients', 'session_id', session.session_id);
  const recordings = await storage.findByField('audio_recordings', 'session_id', session.session_id);

  return {
    patientCount: patients.length,
    recordingCount: recordings.length,
    totalDuration: recordings.reduce((sum, r) => sum + r.duration_ms, 0),
    duration: session.ended_at
      ? new Date(session.ended_at) - new Date(session.started_at)
      : Date.now() - new Date(session.started_at),
  };
}
```

---

## Troubleshooting

### App Won't Start
```bash
# Clear cache and restart
npx expo start -c
```

### "JSX syntax" Error
```bash
# Reinstall Babel preset
npm install babel-preset-expo --save-dev
npx expo start -c
```

### Tests Fail
```bash
# Clear Jest cache
npm test -- --clearCache
npm test
```

### Session Not Persisting
1. Check console for errors
2. Verify bootstrap completed: "Storage initialized successfully"
3. Check if session was created: `storage.findByField('sessions', 'status', 'active')`
4. Verify platform detection: Check logs for adapter type

### Data Not Purging
1. Check `expires_at` field format (ISO 8601 string)
2. Verify `purgeExpired()` is called in App.js
3. Check console logs for purge count
4. Manually verify: Create expired record, run purge, check it's deleted

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│  App.js (Bootstrap)                 │
│  - Initialize storage               │
│  - Call purgeExpired()              │
└─────────────┬───────────────────────┘
              │
              ↓
┌─────────────────────────────────────┐
│  Feature Layer                      │
│  - SessionService                   │
│  - TranscriptionService, etc.       │
└─────────────┬───────────────────────┘
              │
              ↓
┌─────────────────────────────────────┐
│  IRepository Interface              │
│  - Unified API for all platforms    │
└─────────────┬───────────────────────┘
              │
       ┌──────┴──────┐
       ↓             ↓
┌─────────────┐ ┌─────────────┐
│SqliteAdapter│ │DexieAdapter │
│(Android/iOS)│ │   (Web)     │
└──────┬──────┘ └──────┬──────┘
       ↓               ↓
┌─────────────┐ ┌─────────────┐
│expo-sqlite  │ │  Dexie.js   │
│(WAL mode)   │ │ (IndexedDB) │
└─────────────┘ └─────────────┘
```

---

## Data Schema

### Tables
- **sessions** - Nurse shifts
- **patients** - Patient records
- **audio_recordings** - Voice recordings metadata
- **transcriptions** - Speech-to-text results
- **clinical_notes** - AI-extracted clinical data

### Common Fields (All Tables)
- `id` - UUID (auto-generated)
- `created_at` - ISO 8601 timestamp
- `expires_at` - ISO 8601 timestamp (TTL is per-entity — see the retention table above, not a fixed 30 days)
- `session_id` - Foreign key to sessions

---

## Performance Tips

1. **Use `bulkDelete`** to remove many records in one call (e.g. session cleanup)
2. **Cache frequently accessed data** (e.g., active session — see `SessionService`)
3. **Leverage indexes** for common queries (`session_id`, `status`, `expires_at` — already configured)
4. **Run `create` calls in parallel** with `Promise.all(...)` when inserting many records

---

## Next Steps

1. ✅ Start the app and verify storage works
2. ✅ Run tests to ensure both adapters work
3. ✅ Create your first session and verify persistence
4. ✅ Test on both Web and mobile platforms
5. ✅ Add more entities following the same pattern

---

## Quick Reference

```bash
# Start app
npx expo start

# View on Web (IndexedDB)
Press 'w'

# View on Android (SQLite)
Press 'a'

# Run tests
npm test

# Clear everything
npx expo start -c
```


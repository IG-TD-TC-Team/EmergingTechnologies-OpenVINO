# Repository Layer - Usage Guide

Complete guide to using the unified storage interface in Sof-IA.

## Quick Start

```typescript
import { getRepository, Patient, Session, CreatePatientInput } from '@/repositories';

// Get repository instance (auto-detects platform)
const repo = await getRepository();

// Create a patient
const patient = await repo.create<Patient>("patients", {
  session_id: "shift_20260325_143022",
  name: "John Smith",
  status: PatientStatus.ACTIVE,
  mrn: "MRN-123456",
  bed: "301-A",
  date_of_birth: "1965-07-15",
  diagnosis: null,
  allergies: null,
  medications: null,
  notes: null,
});

// Read a patient
const retrieved = await repo.read<Patient>("patients", patient.id);

// Update a patient
const updated = await repo.update<Patient>("patients", patient.id, {
  diagnosis: "Pneumonia",
  medications: "Amoxicillin 500mg PO TID",
});

// Query all patients in current session
const sessionPatients = await repo.queryBySession<Patient>(
  "patients",
  "shift_20260325_143022"
);

// Delete a patient
await repo.delete("patients", patient.id);
```

---

## Platform-Specific Behavior

### Android/iOS (SqliteAdapter)
- **Storage**: SQLite database with WAL mode
- **Location**: `{app-directory}/sofia.db`
- **Features**:
  - Prepared statements (SQL injection protection)
  - Foreign key constraints
  - Automatic migrations
  - Concurrent reads during writes (WAL mode)

### Web (DexieAdapter)
- **Storage**: IndexedDB via Dexie.js
- **Location**: Browser IndexedDB (`sofia_db`)
- **Features**:
  - Compound indexes for fast queries
  - Promise-based API
  - No SQL injection risk (NoSQL)
  - Automatic schema versioning

---

## CRUD Operations

### Create

```typescript
const session = await repo.create<Session>("sessions", {
  nurse_name: "Julia Martinez",
  started_at: new Date().toISOString(),
  status: SessionStatus.ACTIVE,
  device_id: "android_device_abc123",
  app_version: "1.0.0",
});

// Auto-generated fields:
// - id: UUID v4
// - created_at: Current timestamp
// - expires_at: 30 days from now
// - session_id: Same as id for sessions
```

### Read

```typescript
const patient = await repo.read<Patient>("patients", patientId);

if (!patient) {
  console.log("Patient not found");
}
```

### Update

```typescript
// Partial update (only specified fields)
const updated = await repo.update<Patient>("patients", patientId, {
  status: PatientStatus.DISCHARGED,
  note_count: 5,
});
```

### Delete

```typescript
await repo.delete("patients", patientId);
```

---

## Query Operations

### Query by Session

```typescript
// Get all patients for current shift
const patients = await repo.queryBySession<Patient>(
  "patients",
  currentSessionId
);

// Get all recordings for current shift
const recordings = await repo.queryBySession<AudioRecording>(
  "audio_recordings",
  currentSessionId
);
```

### Bulk Delete

```typescript
// Delete all patients in a session
const deletedCount = await repo.bulkDelete("patients", {
  session_id: "shift_20260325_143022",
});

// Delete records older than 24 hours
const deletedOld = await repo.bulkDelete("audio_recordings", {
  field: "created_at",
  operator: "<",
  value: new Date(Date.now() - 86400000).toISOString(),
});

// Delete multiple fields match
const deletedInactive = await repo.bulkDelete("patients", {
  session_id: "shift_20260325_143022",
  status: PatientStatus.DISCHARGED,
});
```

### Purge Expired Records

```typescript
// Run daily cleanup
const purgedCount = await repo.purgeExpired();
console.log(`Cleaned up ${purgedCount} expired records`);
```

---

## Working with Nested Objects

### SOAP Notes

```typescript
const clinicalNote = await repo.create<ClinicalNote>("clinical_notes", {
  session_id: currentSessionId,
  patient_id: patientId,
  transcription_id: transcriptionId,
  note_type: NoteType.SOAP,
  content: "Patient assessment",
  soap: {
    subjective: "Patient reports chest pain",
    objective: "BP 140/90, HR 88",
    assessment: "Possible MI",
    plan: "Administer aspirin, activate cath lab",
  },
  confidence_score: 0.92,
});
```

### Vital Signs

```typescript
const vitalsNote = await repo.create<ClinicalNote>("clinical_notes", {
  session_id: currentSessionId,
  patient_id: patientId,
  transcription_id: null,
  note_type: NoteType.VITALS,
  content: "Routine vitals",
  vitals: {
    blood_pressure: "120/80",
    heart_rate: 72,
    respiratory_rate: 16,
    temperature: "37.2°C",
    spo2: 98,
    pain_level: 2,
  },
  confidence_score: null, // Manually entered
});
```

### Audio Format

```typescript
const recording = await repo.create<AudioRecording>("audio_recordings", {
  session_id: currentSessionId,
  patient_id: patientId,
  status: RecordingStatus.RECORDING,
  audio_source: AudioSource.USB_MIC,
  file_path: "file:///recordings/rec_123.m4a",
  filename: "rec_20260325_143022.m4a",
  file_size_bytes: 1048576,
  format: {
    mime_type: "audio/mp4",
    codec: "aac",
    sample_rate: 48000,
    channels: 1,
    bit_depth: 16,
    bitrate: 128,
  },
  started_at: new Date().toISOString(),
  tags: ["urgent", "family-present"],
  notes: null,
});
```

---

## Data Lifecycle Management

### Session-Based Cleanup

```typescript
// End shift and mark all data for deletion
const session = await repo.read<Session>("sessions", sessionId);
const endedAt = new Date().toISOString();

await repo.update<Session>("sessions", sessionId, {
  ended_at: endedAt,
  status: SessionStatus.ENDED,
});

// Set expiration for all session data
const patients = await repo.queryBySession<Patient>("patients", sessionId);

for (const patient of patients) {
  await repo.update<Patient>("patients", patient.id, {
    expires_at: endedAt, // Immediate expiration
  });
}

// Purge immediately
await repo.purgeExpired();
```

### Retention Policies

```typescript
// Sessions: 30 days after shift end
const sessionExpiresAt = new Date(
  Date.now() + 30 * 24 * 60 * 60 * 1000
).toISOString();

// Patient data: Deleted on shift end
const patientExpiresAt = session.ended_at || sessionExpiresAt;

// Audio recordings: 7 days after creation
const recordingExpiresAt = new Date(
  Date.now() + 7 * 24 * 60 * 60 * 1000
).toISOString();
```

---

## Integration with Services

### SessionService Migration

**Before (AsyncStorage):**
```typescript
// src/services/SessionService.js
async getActiveShift() {
  const raw = await AsyncStorage.getItem(StorageKeys.ACTIVE_SHIFT);
  return raw ? JSON.parse(raw) : null;
}
```

**After (Repository):**
```typescript
// src/services/SessionService.ts
import { getRepository, Session, SessionStatus } from '@/repositories';

async getActiveShift(): Promise<Session | null> {
  const repo = await getRepository();

  const sessions = await repo.queryBySession<Session>(
    "sessions",
    currentSessionId
  );

  return sessions.find(s => s.status === SessionStatus.ACTIVE) || null;
}
```

### PatientService Example

```typescript
// src/services/PatientService.ts
import { getRepository, Patient, CreatePatientInput, PatientStatus } from '@/repositories';

class PatientService {
  private async getRepo() {
    return await getRepository();
  }

  async createPatient(sessionId: string, name: string, bed: string): Promise<Patient> {
    const repo = await this.getRepo();

    const input: CreatePatientInput = {
      session_id: sessionId,
      name,
      bed,
      status: PatientStatus.ACTIVE,
      mrn: null,
      date_of_birth: null,
      diagnosis: null,
      allergies: null,
      medications: null,
      notes: null,
    };

    return await repo.create<Patient>("patients", input);
  }

  async getSessionPatients(sessionId: string): Promise<Patient[]> {
    const repo = await this.getRepo();
    return await repo.queryBySession<Patient>("patients", sessionId);
  }

  async updatePatientDiagnosis(patientId: string, diagnosis: string): Promise<Patient> {
    const repo = await this.getRepo();
    return await repo.update<Patient>("patients", patientId, { diagnosis });
  }
}

export default new PatientService();
```

---

## Error Handling

```typescript
try {
  const patient = await repo.create<Patient>("patients", patientData);
} catch (error) {
  if (error.message.includes('FOREIGN KEY constraint')) {
    console.error('Invalid session_id reference');
  } else if (error.message.includes('UNIQUE constraint')) {
    console.error('Duplicate record');
  } else {
    console.error('Database error:', error);
  }
}
```

---

## Testing

### Reset Repository (for tests)

```typescript
import { RepositoryFactory } from '@/repositories';

// In test teardown
afterEach(() => {
  RepositoryFactory.reset();
});
```

### Mock Repository

```typescript
const mockRepo: IRepository = {
  create: jest.fn(),
  read: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  queryBySession: jest.fn(),
  queryBySessionAndBed: jest.fn(),
  findByField: jest.fn(),
  bulkDelete: jest.fn(),
  purgeExpired: jest.fn(),
};
```

---

## Performance Tips

### Batch Operations

```typescript
// Bad: Multiple individual creates
for (const note of notes) {
  await repo.create<ClinicalNote>("clinical_notes", note);
}

// Good: Use transactions (SQLite) or batch (Dexie)
// For now, minimize round trips:
const promises = notes.map(note => repo.create<ClinicalNote>("clinical_notes", note));
await Promise.all(promises);
```

### Index Usage

Queries using indexed fields are much faster:

**Indexed fields (fast):**
- `session_id`
- `patient_id`
- `status`
- `expires_at`
- Compound indexes: `[session_id+status]`, `[patient_id+note_type]`

**Non-indexed fields (slower):**
- `name`
- `diagnosis`
- `content`

```typescript
// Fast: Uses session_id index
const patients = await repo.queryBySession<Patient>("patients", sessionId);

// Slower: No index on 'name'
// Use custom query methods for complex filters
```

---

## Debugging

### Enable Logging

**SQLite:**
```typescript
// Migrations log automatically
// Check console for:
// [SQLite] Running migrations...
// [SQLite] Migration 1 applied successfully
```

**Dexie:**
```typescript
// Enable Dexie debug mode
Dexie.debug = true;

// Check console for:
// [Dexie] Database initialized
// [Dexie] Opening database 'sofia_db'
```

### Inspect Database

**Android/iOS (SQLite):**
```bash
# Extract database from Android device
adb pull /data/data/com.sofia.app/databases/sofia.db

# Open with SQLite browser
sqlite3 sofia.db
.tables
SELECT * FROM patients;
```

**Web (IndexedDB):**
```javascript
// Chrome DevTools > Application > IndexedDB > sofia_db
// Inspect tables and data visually
```

---

## Migration Guide

### From AsyncStorage to Repository

1. **Identify data types**: Map AsyncStorage keys to entity types
2. **Create migration service**: Read from AsyncStorage, write to repository
3. **Run migration on app start**: One-time data transfer
4. **Clear AsyncStorage**: After successful migration
5. **Update services**: Replace AsyncStorage calls with repository calls

Example migration script:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRepository, Session, SessionStatus } from '@/repositories';

async function migrateAsyncStorageToRepository() {
  const repo = await getRepository();

  // Migrate nurse name and active shift
  const nurseName = await AsyncStorage.getItem('nurse_name');
  const activeShiftRaw = await AsyncStorage.getItem('active_shift');

  if (activeShiftRaw) {
    const legacyShift = JSON.parse(activeShiftRaw);

    // Create session in repository
    await repo.create<Session>("sessions", {
      nurse_name: legacyShift.nurse_name || nurseName,
      started_at: legacyShift.started_at,
      status: SessionStatus.ACTIVE,
      device_id: 'migrated',
      app_version: '1.0.0',
    });

    // Clear legacy data
    await AsyncStorage.removeItem('active_shift');
  }

  if (nurseName) {
    await AsyncStorage.removeItem('nurse_name');
  }

  console.log('[Migration] AsyncStorage data migrated to repository');
}
```

---

## Security Considerations

### PHI (Protected Health Information)

All patient data is PHI and must be handled securely:

1. **Local storage only** (no backend sync in v1)
2. **Automatic purging** on shift end
3. **Encryption at rest** (handled by OS on Android/iOS)
4. **No cloud backup** (disable in app settings)

### Future: Secure Token Storage

When backend API is added:

```typescript
// DO NOT store tokens in repository
// Use expo-secure-store instead
import * as SecureStore from 'expo-secure-store';

await SecureStore.setItemAsync('auth_token', token);
```

---

## Troubleshooting

### "Table does not exist" error

**Solution:** Ensure repository is initialized before use

```typescript
const repo = await getRepository(); // Always await!
await repo.create(...); // Now safe to use
```

### Foreign key constraint errors

**Solution:** Ensure referenced entities exist

```typescript
// Bad: Patient references non-existent session
await repo.create<Patient>("patients", {
  session_id: "invalid_session_id", // ❌ Error!
});

// Good: Create session first
const session = await repo.create<Session>("sessions", {...});
await repo.create<Patient>("patients", {
  session_id: session.session_id, // ✅ Valid reference
});
```

### Web: IndexedDB quota exceeded

**Solution:** Run purgeExpired() regularly

```typescript
// Run daily or on app start
setInterval(async () => {
  const repo = await getRepository();
  await repo.purgeExpired();
}, 24 * 60 * 60 * 1000); // 24 hours
```

---

## API Reference

See `IRepository.ts` for full interface documentation.

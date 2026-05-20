# Integration Tests Suite

Comprehensive test suite for the unified storage interface, ensuring both SQLite (Android/iOS) and Dexie (Web) adapters work identically with business logic.

## 📁 Test Structure

```
src/__tests__/
├── README.md                          # This file
├── helpers/
│   ├── test-helpers.ts               # Test utilities and factory functions
│   └── transcription-fixture.ts      # Transcription test data fixtures
├── integration/
│   ├── shared/
│   │   ├── storage.integration.suite.ts        # Shared test suite (runs on both adapters)
│   │   └── storage.integration.suite.simple.ts # Simplified variant
│   ├── bedcard-navigation.test.js              # Bed card navigation flow
│   ├── card-tables.integration.test.ts         # Card-type table integration
│   ├── cross-platform.integration.test.ts      # Cross-platform consistency
│   ├── dexie.integration.test.ts               # Dexie adapter tests
│   ├── offline-queue.integration.test.js       # Offline queue end-to-end
│   ├── sqlite.integration.test.ts              # SQLite adapter tests
│   ├── storage-factory.integration.test.ts     # Factory tests
│   └── web-platform.integration.test.ts        # Web platform specifics
├── networkMonitor/
│   └── NetworkMonitor.test.ts
├── offlineQueue/
│   ├── OfflineQueueManager.test.ts
│   ├── recordingPipeline.integration.test.ts
│   └── shiftEndGate.integration.test.ts
├── presenters/
│   ├── CardDetailPresenter.test.js
│   ├── DashboardPresenter.endshift.test.js
│   ├── DashboardPresenter.us21.test.js
│   ├── DashboardPresenter.us23.test.js
│   ├── EditPatientPresenter.test.js
│   ├── LoadingPresenter.us23.test.js
│   └── PatientDetailsPresenter.test.js
├── screens/
│   ├── BedDetailScreen.test.js
│   ├── CardDetailScreen.test.js
│   ├── DashboardScreen.scroll.test.js
│   └── SettingsScreen.test.js
└── services/
    ├── ChunkUploadService.test.js
    ├── EndShiftService.test.ts
    ├── PermissionsService.web.test.js
    ├── ServiceWorkerManager.test.js
    ├── TranscriptionService.test.js
    └── WebRecorderService.test.js
```

## 🎯 Test Coverage

The shared integration test suite verifies:

### ✅ Initialization & Health
- Storage initialization
- Health checks
- Table creation

### ✅ CRUD Operations
- **Sessions**: Create, Read, Update, Delete
- **Patients**: Full CRUD with session relationships
- **AudioRecordings**: CRUD with patient relationships
- **Transcriptions**: CRUD with audio relationships
- **ClinicalNotes**: CRUD with patient relationships

### ✅ Query Operations
- Count records
- Check existence
- Pagination (limit/offset)
- Find by field

### ✅ Data Expiration
- `purgeExpired()` removes expired records
- Purges from all tables (sessions, patients, audio_recordings, transcriptions, clinical_notes)
- Preserves non-expired records
- Returns correct purge count

### ✅ Advanced Features
- Transaction support
- Batch operations (create/delete)
- Error handling
- Data integrity (types, nulls, timestamps)

### ✅ Platform-Specific
- IndexedDB usage (Dexie)
- SQLite with WAL mode
- Factory platform detection

## 🚀 Running Tests

### Run All Tests
```bash
npm test
```

### Run Integration Tests Only
```bash
npm run test:integration
```

### Run Specific Adapter Tests
```bash
# Test Dexie adapter (Web)
npm run test:dexie

# Test SQLite adapter (Android/iOS)
npm run test:sqlite

# Test StorageFactory
npm run test:factory
```

### Watch Mode (auto-rerun on changes)
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## 📝 Writing New Tests

### Using the Shared Test Suite

The shared test suite ensures both adapters behave identically:

```typescript
import { runStorageIntegrationTests } from './shared/storage.integration.suite';
import { MyAdapter } from '../../repositories/adapters/MyAdapter';

describe('MyAdapter Integration Tests', () => {
  runStorageIntegrationTests(() => {
    return new MyAdapter('test_db');
  });
});
```

### Using Test Helpers

Create test data easily with factory functions:

```typescript
import {
  createTestSession,
  createTestPatient,
  createExpiredEntity,
  createTestEntities,
} from '../helpers/test-helpers';

// Create a single session
const session = createTestSession();

// Create an expired session
const expired = createExpiredEntity(createTestSession);

// Create multiple patients
const patients = createTestEntities(createTestPatient, 5);

// Create with overrides
const customPatient = createTestPatient({
  nombre: 'Maria',
  edad: 40,
});
```

## 🧪 Test Patterns

### Testing CRUD Operations

```typescript
it('should create and retrieve a patient', async () => {
  const patient = createTestPatient();

  // Create
  const created = await storage.create('patients', patient);
  expect(created.id).toBe(patient.id);

  // Read
  const found = await storage.findById('patients', patient.id);
  expect(found).toMatchObject({
    nombre: patient.nombre,
    apellido: patient.apellido,
  });
});
```

### Testing Data Expiration

```typescript
it('should purge expired records', async () => {
  // Create expired entity
  const expired = createExpiredEntity(createTestSession);
  await storage.create('sessions', expired);

  // Purge
  const purgedCount = await storage.purgeExpired();
  expect(purgedCount).toBeGreaterThanOrEqual(1);

  // Verify removed
  const found = await storage.findById('sessions', expired.id);
  expect(found).toBeNull();
});
```

### Testing Relationships

```typescript
it('should find patients by session_id', async () => {
  const sessionId = 'test-session-123';
  const patients = createTestEntities(createTestPatient, 3, {
    session_id: sessionId,
  });

  for (const patient of patients) {
    await storage.create('patients', patient);
  }

  const found = await storage.findByField('patients', 'session_id', sessionId);
  expect(found.length).toBe(3);
});
```

## 🏗️ Architecture

### Shared Test Suite Pattern

The test suite uses a factory function pattern to test both adapters:

```typescript
export function runStorageIntegrationTests(
  createAdapter: () => IRepository | Promise<IRepository>
) {
  // Tests that run against any adapter implementing IRepository
}
```

This ensures:
- **Single source of truth** for test logic
- **Identical behavior** across platforms
- **Easy maintenance** - update tests in one place
- **Platform-agnostic** business logic

### Test Isolation

Each test:
1. Creates a fresh adapter instance with unique DB name
2. Initializes the adapter
3. Runs the test
4. Closes and cleans up the adapter

This prevents test pollution and ensures reliable results.

## 🔧 Configuration

### Jest Configuration (`jest.config.js`)
- **Preset**: `jest-expo` for React Native
- **Test Environment**: `node`
- **Transform Ignore Patterns**: Configured for Expo modules
- **Module Name Mapper**: `@/` alias for `src/`
- **Coverage Threshold**: 70% for all metrics

### Jest Setup (`jest.setup.js`)
- Mocks AsyncStorage
- Mocks React Native Platform
- Sets up fake-indexeddb for Dexie tests
- Mocks expo-sqlite for SQLite tests
- Suppresses console logs during tests

## 📊 Coverage Goals

| Metric     | Target |
|------------|--------|
| Branches   | 70%    |
| Functions  | 70%    |
| Lines      | 70%    |
| Statements | 70%    |

## 🐛 Debugging Tests

### Run a Single Test File
```bash
npx jest src/__tests__/integration/dexie.integration.test.ts
```

### Run a Single Test Case
```bash
npx jest -t "should purge expired records"
```

### Enable Verbose Output
```bash
npx jest --verbose
```

### Debug with Chrome DevTools
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Then open `chrome://inspect` in Chrome.

## 📚 Best Practices

1. **Always use test helpers** - Don't manually create test data
2. **Test both success and failure cases** - Error handling is critical
3. **Use descriptive test names** - Should read like documentation
4. **Keep tests independent** - No shared state between tests
5. **Test at the right level** - Integration tests for adapters, unit tests for business logic
6. **Mock external dependencies** - AsyncStorage, expo-sqlite, etc.
7. **Assert meaningful behavior** - Not just "it doesn't throw"

## 🔗 Related Documentation

- [IRepository Interface](../repositories/interfaces/IRepository.ts) - Storage contract
- [StorageFactory](../repositories/adapters/StorageFactory.ts) - Factory implementation
- [SqliteAdapter](../repositories/adapters/sqlite/SqliteAdapter.ts) - SQLite implementation
- [DexieAdapter](../repositories/adapters/dexie/DexieAdapter.ts) - Dexie implementation

## 🤝 Contributing

When adding new features to the storage layer:

1. **Update the shared test suite** - Add tests to `storage.integration.suite.ts`
2. **Run all tests** - Ensure both adapters pass
3. **Update this README** - Document new test patterns
4. **Check coverage** - Maintain 70% threshold

## 📞 Support

If tests fail:
1. Check if it's adapter-specific or shared behavior
2. Review recent changes to storage interfaces
3. Verify test data factories are correct
4. Check mock configurations in `jest.setup.js`
5. Run tests in isolation to identify issues


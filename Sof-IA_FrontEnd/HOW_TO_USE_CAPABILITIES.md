# How to Use Platform Capabilities

**Quick Guide:** Adapt your app's features based on the platform (Android vs Web)

---

## What Is It?

The **capabilities system** automatically detects the platform and tells you which features are available.

**Simple Example:**
- Android: ✅ Bluetooth available
- Web: ❌ Bluetooth NOT available

Your code checks the capability before showing UI or calling APIs.

---

## How It Works

### 1. Platform Detection (Automatic)

When the app starts, it detects the platform:

```typescript
// This happens automatically - you don't need to do anything
Platform.OS === 'android' → All features enabled
Platform.OS === 'web'     → Native features disabled
```

### 2. Capabilities Object Created

The system creates a `capabilities` object with flags:

```typescript
{
  hasBluetooth: true/false,
  hasFileSystem: true/false,
  hasBackgroundTasks: true/false,
  audioRecorder: 'expo-av' or 'MediaRecorder',
  storage: 'sqlite' or 'dexie',
  isNative: true/false,
  isWeb: true/false
}
```

### 3. You Use It In Your Code

Check capabilities before rendering UI or calling APIs.

---

## How to Use It

### Step 1: Import Capabilities

**Option A: Direct Import (Services/Utilities)**
```javascript
import { capabilities } from '../config/capabilities';

if (capabilities.hasBluetooth) {
  // Do Bluetooth stuff
}
```

**Option B: React Hook (UI Components)**
```javascript
import { useCapabilities } from '../config/CapabilitiesContext';

function MyComponent() {
  const { hasBluetooth, isWeb } = useCapabilities();

  // Use them in your component
}
```

---

### Step 2: Check Capability Before Use

**Pattern: Conditional Rendering (UI)**

```javascript
// ✅ CORRECT - Feature is completely hidden on web
{hasBluetooth && (
  <Button onPress={connectBluetooth}>
    Connect Bluetooth
  </Button>
)}

// ❌ WRONG - Feature is grayed out (bad UX)
<Button
  disabled={!hasBluetooth}
  onPress={connectBluetooth}
>
  Connect Bluetooth
</Button>
```

**Pattern: Conditional Execution (Code)**

```javascript
// ✅ CORRECT - Check before calling native API
async function openSettings() {
  if (capabilities.isWeb) {
    console.warn('Not available on web');
    return;
  }

  await Linking.openSettings();
}

// ❌ WRONG - Will crash on web
async function openSettings() {
  await Linking.openSettings(); // 💥 Crashes on web
}
```

---

## Common Use Cases

### Use Case 1: Show/Hide Bluetooth Button

```javascript
import { useCapabilities } from '../config/CapabilitiesContext';

function RecordingScreen() {
  const { hasBluetooth } = useCapabilities();

  return (
    <View>
      {/* Regular recording - always visible */}
      <Button>Record with Microphone</Button>

      {/* Bluetooth - only on Android/iOS */}
      {hasBluetooth && (
        <Button>Record with Bluetooth</Button>
      )}
    </View>
  );
}
```

---

### Use Case 2: Show/Hide File Export

```javascript
import { capabilities } from '../config/capabilities';

function SettingsScreen() {
  return (
    <View>
      {/* General settings - always visible */}
      <Section title="General">
        <Setting name="Language" />
      </Section>

      {/* File management - only on Android/iOS */}
      {capabilities.hasFileSystem && (
        <Section title="File Management">
          <Button>Export Recordings</Button>
          <Button>Import Data</Button>
        </Section>
      )}
    </View>
  );
}
```

---

### Use Case 3: Choose Audio Recorder

```javascript
import { capabilities } from '../config/capabilities';

async function startRecording() {
  if (capabilities.audioRecorder === 'expo-av') {
    // Use native recorder (Android/iOS)
    await Audio.Recording.createAsync();
  } else {
    // Use web recorder (Chrome)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recorder.start();
  }
}
```

---

### Use Case 4: Protect Native API Calls

```javascript
import { capabilities } from '../config/capabilities';

class SqliteAdapter {
  constructor() {
    // Prevent instantiation on web
    if (!capabilities.isNative) {
      throw new Error('SQLite only works on Android/iOS');
    }

    // Safe to call native API now
    this.db = SQLite.openDatabaseSync('mydb.db');
  }
}
```

---

### Use Case 5: Platform-Specific Features

```javascript
import { capabilities } from '../config/capabilities';

function StatusBar() {
  return (
    <View>
      <Text>Platform: {capabilities.platform}</Text>
      <Text>Storage: {capabilities.storage}</Text>

      {/* Show service worker status on web only */}
      {capabilities.isWeb && (
        <Text>Service Worker: Active</Text>
      )}

      {/* Show background sync on Android only */}
      {capabilities.hasBackgroundTasks && (
        <Toggle label="Background Sync" />
      )}
    </View>
  );
}
```

---

## Available Capabilities

### Boolean Flags

| Flag | Android / iOS | Web | Usage |
|------|--------------|-----|-------|
| `hasBluetooth` | ✅ true | ❌ false | Show Bluetooth UI |
| `hasFileSystem` | ✅ true | ❌ false | Show file operations |
| `hasBackgroundTasks` | ✅ true | ❌ false | Enable background sync |
| `isNative` | ✅ true | ❌ false | Check if native platform |
| `isWeb` | ❌ false | ✅ true | Check if web platform |

### String Values

| Flag | Android | iOS | Web | Usage |
|------|---------|-----|-----|-------|
| `audioRecorder` | `'expo-av'` | `'expo-av'` | `'MediaRecorder'` | Choose audio API |
| `storage` | `'sqlite'` | `'sqlite'` | `'dexie'` | Choose database |
| `platform` | `'android'` | `'ios'` | `'web'` | Display platform name |

---

## Quick Reference

### Import

```javascript
// For React components
import { useCapabilities } from '../config/CapabilitiesContext';
const { hasBluetooth } = useCapabilities();

// For services/utilities
import { capabilities } from '../config/capabilities';
if (capabilities.hasBluetooth) { ... }
```

### Check Before Render

```javascript
{capabilities.hasBluetooth && <BluetoothButton />}
```

### Check Before API Call

```javascript
if (!capabilities.isNative) {
  console.warn('Not available on web');
  return;
}
```

### Choose Implementation

```javascript
const recorder = capabilities.audioRecorder === 'expo-av'
  ? new ExpoRecorder()
  : new WebRecorder();
```

---

## Rules to Follow

### ✅ DO

1. **Hide features completely**
   ```javascript
   {hasBluetooth && <Button />}
   ```

2. **Check before calling native APIs**
   ```javascript
   if (capabilities.isNative) {
     await NativeAPI.call();
   }
   ```

3. **Use the right implementation**
   ```javascript
   if (capabilities.audioRecorder === 'expo-av') {
     // Use native
   } else {
     // Use web
   }
   ```

### ❌ DON'T

1. **Don't gray out features**
   ```javascript
   // ❌ WRONG - Grayed out is bad UX
   <Button disabled={!hasBluetooth} />
   ```

2. **Don't call native APIs without checking**
   ```javascript
   // ❌ WRONG - Will crash on web
   await SQLite.openDatabase();
   ```

3. **Don't use Platform.OS directly**
   ```javascript
   // ❌ WRONG - Use capabilities instead
   if (Platform.OS === 'android') {
     showBluetooth();
   }

   // ✅ CORRECT - Use capabilities
   if (capabilities.hasBluetooth) {
     showBluetooth();
   }
   ```

---

## Testing Your Code

### Test on Android

```bash
npm run android
```

**What to check:**
- ✅ Bluetooth button is VISIBLE
- ✅ File management is VISIBLE
- ✅ All native features work

### Test on Web

```bash
npm run web
```

**What to check:**
- ✅ Bluetooth button is ABSENT (not just disabled)
- ✅ File management is ABSENT
- ✅ No console errors about native APIs
- ✅ MediaRecorder works

### Quick Console Check

In the Metro bundler or browser DevTools console, import and log capabilities directly:

```javascript
// In a component or service file — add temporarily for debugging
import { capabilities } from '../config/capabilities';
console.log('Capabilities:', capabilities);

// On Android/iOS should show:
// { hasBluetooth: true, hasFileSystem: true, isNative: true, isWeb: false, ... }

// On Web should show:
// { hasBluetooth: false, hasFileSystem: false, isNative: false, isWeb: true, ... }
```

---

## Troubleshooting

### Problem: Feature shows on wrong platform

**Solution:** Check your conditional
```javascript
// Make sure you're checking the right capability
{capabilities.hasBluetooth && <Button />}  // ✅ Correct
{capabilities.hasFileSystem && <Button />} // ✅ Correct for files
```

### Problem: Native API crashes on web

**Solution:** Add capability check before API call
```javascript
if (!capabilities.isNative) {
  console.warn('Not available on web');
  return;
}
await NativeAPI.call();
```

### Problem: Can't import capabilities

**Solution:** Check import path
```javascript
// For React components
import { useCapabilities } from '../config/CapabilitiesContext';

// For services
import { capabilities } from '../config/capabilities';
```

---

## Examples by Feature

### Bluetooth

```javascript
// In UI component
const { hasBluetooth } = useCapabilities();

{hasBluetooth && (
  <TouchableOpacity onPress={connectBluetooth}>
    <Text>Connect Bluetooth Device</Text>
  </TouchableOpacity>
)}
```

### File Operations

```javascript
// In settings screen
import { capabilities } from '../config/capabilities';

{capabilities.hasFileSystem && (
  <View>
    <Button onPress={exportFiles}>Export</Button>
    <Button onPress={importFiles}>Import</Button>
  </View>
)}
```

### Background Tasks

```javascript
// In service
import { capabilities } from '../config/capabilities';

async function enableBackgroundSync() {
  if (!capabilities.hasBackgroundTasks) {
    console.log('Background sync not available on web');
    return;
  }

  await BackgroundFetch.registerTaskAsync('sync-task');
}
```

### Audio Recording

```javascript
// In recording service
import { capabilities } from '../config/capabilities';

async function initRecorder() {
  if (capabilities.audioRecorder === 'expo-av') {
    // Android/iOS - use expo-av
    const { recording } = await Audio.Recording.createAsync();
    return recording;
  } else {
    // Web - use MediaRecorder
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MediaRecorder(stream);
  }
}
```

---

## Summary

### The Pattern

1. **Import** capabilities
2. **Check** capability flag
3. **Conditionally** show UI or call API
4. **Handle** unavailable features gracefully

### Remember

- ✅ Hide features completely (not grayed out)
- ✅ Check before calling native APIs
- ✅ Use capabilities instead of Platform.OS
- ✅ Test on both Android and Web

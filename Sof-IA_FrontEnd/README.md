# Sof-IA FrontEnd

A mobile application built with **React Native** and **Expo**.

---

## What is React Native?

React Native lets you build mobile apps using JavaScript and React.
Instead of HTML elements like `<div>` or `<p>`, you use mobile components like `<View>` and `<Text>`.

Your code runs on **iOS** and **Android** from a single codebase.

---

## What is Expo?

Expo is a set of tools built on top of React Native that makes development easier:
- No need to install Android Studio or Xcode to get started
- Scan a QR code with the **Expo Go** app to see your app live on your phone
- Provides ready-to-use APIs (camera, location, notifications, etc.)

---

## Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Start the development server
```bash
npx expo start
```

### 3. Open on your device
- Install **Expo Go** on your phone (Android / iOS)
- Scan the QR code shown in the terminal

### 4. Or run on an emulator
```bash
npm run android   # Android emulator
npm run web       # Browser
```

> **Note:** To run on web, you need to install extra dependencies first:
> ```bash
> npx expo install react-dom react-native-web
> ```
> Then run `npm run web` again.

---

## Project Structure

```
Sof-IA_FrontEnd/
├── App.js                  # Entry point — mounts AppNavigator
├── index.js                # Expo root registration
├── assets/
│   └── icons/              # Icons from Figma (SVG) and app logo (PNG)
├── src/
│   ├── models/             # Plain data classes (Patient, Session, ClinicalNote...)
│   ├── repositories/
│   │   ├── interfaces/     # Storage contracts (IStorageRepository...)
│   │   └── adapters/       # SQLiteRepository (Android), IndexedDBRepository (Web)
│   ├── services/
│   │   ├── audio/          # USBMicStrategy, DeviceMicStrategy
│   │   ├── transcription/  # WhisperStrategy, AzureSTTStrategy
│   │   ├── extraction/     # NLPExtractionHandler, ClinicalNoteFactory
│   │   ├── ScriberService.js   # Facade — recording pipeline entry point
│   │   └── SessionService.js
│   ├── presenters/         # One Presenter per screen (pure JS, no RN imports)
│   ├── screens/            # One Screen per route (View only, no business logic)
│   └── navigation/
│       └── AppNavigator.js # React Navigation stack
├── app.json                # Expo configuration (name, icon, splash screen)
└── package.json            # Dependencies and scripts
```

---

## App Navigation Flow

```
App launch
    │
    ▼
LoadingScreen (1.8s splash)
    │
    ├── active shift in storage? ──► DashboardScreen
    │
    └── no shift ──► ModeSelectionScreen
                          │
                          └── "Start working!" ──► DashboardScreen
                                                        │
                                                        └── bed card ──► PatientDetailScreen
```

### Screens implemented

| Screen | File | Status |
|---|---|---|
| Loading / Splash | `src/screens/LoadingScreen.js` | Done |
| Mode Selection | `src/screens/ModeSelectionScreen.js` | Done |
| Dashboard | `src/screens/DashboardScreen.js` | Placeholder |
| Patient Detail | — | Not started |

---

## Design Resources

- **Figma designs:** https://www.figma.com/design/xatJv9J3dQWl258H1l4eWM/Sof-IA-HealthCare-assistant
- **Azure DevOps (user stories):** https://dev.azure.com/Sof-IA/Front-End-React/_workitems/recentlyupdated/

---

## Color Palette

All screens use Material Design 3 tokens. Hardcode these values — do not invent new colors without checking Figma first.

| Token | Hex | Usage |
|---|---|---|
| Surface (background) | `#FFFFFF` | All screen backgrounds |
| On-surface (text/icons) | `#1D1B20` | Primary text, icon strokes |
| Outline-variant (borders) | `#CAC4D0` | Dividers, input borders, tab underlines |
| Logo circle background | `#E1E3F8` | Loading screen lavender circle |
| Disabled text | `#767676` | Disabled labels |
| Placeholder text | `#9E9E9E` | Input placeholders |

---

## Core Components

| Component | HTML equivalent | Description |
|---|---|---|
| `<View>` | `<div>` | Container / layout box |
| `<Text>` | `<p>` / `<span>` | Display text |
| `<Image>` | `<img>` | Display images |
| `<TextInput>` | `<input>` | Text input field |
| `<TouchableOpacity>` | `<button>` | Pressable element |
| `<ScrollView>` | `<div style="overflow:scroll">` | Scrollable container |
| `<FlatList>` | — | Optimized list for large data |

---

## Styling

React Native uses JavaScript objects for styles (no CSS files):

```js
import { StyleSheet, View, Text } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello World</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
});
```

Key differences from CSS:
- Property names are **camelCase** (`backgroundColor` not `background-color`)
- Values are strings or numbers (`fontSize: 24` not `font-size: 24px`)
- Layout uses **Flexbox** by default

---

## Navigation

> Already installed in this project — run `npm install` and you are ready to go.

React Navigation is used to move between screens:

```bash
# Already installed — do not run again
npm install @react-navigation/native @react-navigation/stack
npx expo install react-native-screens react-native-safe-area-context
```

Basic usage:
```js
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Details" component={DetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

---

## SVG Icons

Icons exported from Figma are SVG files. To render them in React Native use `react-native-svg`:

```bash
# Already installed — do not run again
npx expo install react-native-svg
```

Usage in a screen:

```js
import { SvgXml } from 'react-native-svg';

const mySvg = `<svg viewBox="0 0 24 24" ...>...</svg>`;

<SvgXml xml={mySvg} width={48} height={48} />
```

> **Important:** CSS variables inside SVG strings (e.g. `stroke="var(--stroke-0, #1E1E1E)"`) are **not supported** in React Native. Replace them with literal hex values before using `SvgXml`.

---

## Local Storage (nurse name & session data)

To persist data locally across app restarts:

```bash
# Already installed — do not run again
npx expo install @react-native-async-storage/async-storage
```

Usage:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

await AsyncStorage.setItem('nurse_name', 'Julia');
const name = await AsyncStorage.getItem('nurse_name');
```

> Do **not** use `expo-async-storage` — that package does not exist. The correct package is `@react-native-async-storage/async-storage`.

---

## Useful Expo APIs

| Package | What it does |
|---|---|
| `expo-av` | Audio recording (used for mic capture on Android) |
| `expo-camera` | Access device camera |
| `expo-location` | Get GPS location |
| `expo-notifications` | Push notifications |
| `@react-native-async-storage/async-storage` | Save data locally (key/value) |
| `expo-font` | Load custom fonts |

Install any of them with:
```bash
npx expo install expo-av
```

---

## Architecture Proposition

> This is a **proposition** — the team should adapt and adopt what makes sense for each feature. Not everything needs to be applied everywhere.

### What is Sof-IA?

An **ambient scribe app for nurses**. Nurses use a **USB-C microphone** (e.g. Rhode Mini Wireless) or their **device built-in mic** to continuously capture bedside conversations. Audio is transcribed (Whisper API) and AI-extracted into structured clinical data (medications, vitals, allergies) — all without manual note-taking. Data lives locally on the device and is wiped at shift end.

Runs on **Android** (primary) and **Chrome/Web** (fallback).

---

### Layered Architecture (MVP)

```
┌─────────────────────────────────────────────────────────┐
│  VIEW LAYER  (React Native Screens)                      │
│  ModeSelectionScreen, DashboardScreen,                   │
│  PatientDetailScreen, CorrectionScreen                   │
└──────────────────────┬──────────────────────────────────┘
                       │ (interface only — no logic here)
┌──────────────────────▼──────────────────────────────────┐
│  PRESENTER LAYER  (pure JS classes, no RN imports)       │
│  ModeSelectionPresenter, DashboardPresenter, ...         │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  SERVICE LAYER  (Facade + Strategy + Chain)              │
│  ScriberService (Facade), AudioCaptureService,           │
│  TranscriptionService, AIExtractionService,              │
│  SessionService, PatientService                          │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  REPOSITORY LAYER  (Adapter pattern)                     │
│  IStorageRepository                                      │
│  ├── SQLiteRepository  (Android — expo-sqlite)           │
│  └── IndexedDBRepository  (Web — Dexie.js)               │
└─────────────────────────────────────────────────────────┘
```

**Rule:** Views call Presenters. Presenters call Services. Services call Repositories. Never skip a layer.

---

### Proposed Folder Structure

```
src/
├── models/             # Plain data classes: Patient, Session, ClinicalNote, Transcription
├── repositories/
│   ├── interfaces/     # IStorageRepository, IPatientRepository (contracts)
│   ├── adapters/       # SQLiteRepository (Android), IndexedDBRepository (Web)
│   └── PatientRepository.js
├── services/
│   ├── audio/          # USBMicStrategy, DeviceMicStrategy
│   ├── transcription/  # WhisperStrategy, AzureSTTStrategy
│   ├── extraction/     # NLPExtractionHandler, ClinicalNoteFactory
│   ├── ScriberService.js   # Facade — single entry point for recording pipeline
│   └── SessionService.js
├── presenters/         # One per screen (pure JS, no React Native imports)
├── screens/            # One per screen (View only, no business logic)
└── navigation/
    └── AppNavigator.js
```

---

### Design Patterns — When and Why

| Pattern | Where to use it | Why |
|---|---|---|
| **MVP** | Every screen | Views stay dumb and testable; all logic in Presenter |
| **Strategy** | Audio capture, Transcription API | Swap USB-C mic↔device mic or Whisper↔Azure without touching callers |
| **Adapter** | Storage layer | `expo-sqlite` on Android, `Dexie.js` on Web — same interface for both |
| **Repository** | Patient, Session, Note data | Presenters never touch storage directly |
| **Observer / Event Bus** | Real-time transcription | Words stream in live; Views subscribe to events, not polling |
| **State Machine** | Recording, Shift lifecycle | Prevent invalid transitions (e.g. save while still recording) |
| **Chain of Responsibility** | Audio processing pipeline | `Audio → Transcription → NLP → Storage`, each step transforms and passes |
| **Circuit Breaker / Proxy** | Transcription API calls | Queue audio locally when API is unreachable; retry on reconnect |
| **Factory** | Clinical note creation | Same transcription → SOAP note, medication list, vitals record, etc. |
| **Command** | Recording & correction actions | Audit trail for medical compliance; enables undo/redo |
| **Facade** | `ScriberService` | Hides audio + transcription + AI complexity from Presenters |

---

### Recording State Machine (v1 — always-on)

```
Idle ◄── mic button ──► Recording ──► Processing (background) ──► Saved
```

> `Review` step is a future feature. In v1, processing and saving happen automatically.

### Shift State Machine

```
NoShift ──► NameEntry ──► Active ──► EndingShift ──► Cleared
```

---

### How to Add a New Screen (MVP pattern)

Every screen follows the same 3-file structure. Example for a new `PatientDetailScreen`:

**1. Create the Presenter** `src/presenters/PatientDetailPresenter.js`
```js
class PatientDetailPresenter {
  constructor(view) {
    this.view = view; // reference to the screen's state setters
  }

  loadPatient(patientId) {
    // fetch from repository, call this.view.setPatient(data)
  }

  onEditField(field, value) {
    // validate, save, update view
  }
}

export default PatientDetailPresenter;
```

**2. Create the Screen** `src/screens/PatientDetailScreen.js`
```js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PatientDetailPresenter from '../presenters/PatientDetailPresenter';

function PatientDetailScreen({ navigation, route }) {
  const [patient, setPatient] = useState(null);

  const presenter = useRef(
    new PatientDetailPresenter({ setPatient })
  ).current;

  useEffect(() => {
    presenter.loadPatient(route.params.patientId);
  }, []);

  return (
    <View style={styles.container}>
      <Text>{patient?.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
});

export default PatientDetailScreen;
```

**3. Register it in the navigator** `src/navigation/AppNavigator.js`
```js
<Stack.Screen name="PatientDetail" component={PatientDetailScreen} />
```

**Rules:**
- The Screen (`View`) only calls Presenter methods and renders state — no logic
- The Presenter has no React Native imports — pure JS class
- Navigate with `navigation.navigate('PatientDetail', { patientId: '...' })`

---

### Recording State Machine (v1)

In v1, recording is always-on in the background. The nurse only pauses/resumes manually via the mic button.

```
Idle ◄──────────────────── mic button ────────────────────► Recording
                                                                │
                                                        (auto in background)
                                                                │
                                                         Processing (API)
                                                                │
                                                         Saved to local DB
```

> The `Review` step is a **future feature** — not implemented in v1.

---

## API Migration Guide

### What was done now to prepare

| What | File | Why |
|---|---|---|
| Centralized storage keys | `src/constants/storageKeys.js` | One place to update when keys move to the API |
| `SessionService` | `src/services/SessionService.js` | **Only this file changes** when the API arrives — Presenters stay untouched |
| Presenters use `SessionService` | `LoadingPresenter`, `ModeSelectionPresenter` | No direct `AsyncStorage` calls in business logic |

### When the API arrives — what to change

**`SessionService.js` is the single migration point.** Replace each method body:

| Method | v1 (local) | vFuture (API) |
|---|---|---|
| `getNurseName()` | `AsyncStorage.getItem(...)` | `GET /auth/me → response.nurse_name` |
| `saveNurseName()` | `AsyncStorage.setItem(...)` | `PATCH /auth/profile { nurse_name }` |
| `getActiveShift()` | `AsyncStorage.getItem(...)` | `GET /sessions/active` |
| `startShift()` | `AsyncStorage.setItem(...)` | `POST /sessions { nurse_name, started_at }` |
| `endShift()` | `AsyncStorage.removeItem(...)` | `DELETE /sessions/:id` |

No Presenter or Screen needs to change.

### Known gaps — to address before API integration

These are conscious shortcuts made in v1 that will need attention before connecting a backend:

1. **No `AuthService`** — The logout button is reserved for future auth but there is no auth interface yet. When auth arrives (SSO, JWT, hospital directory), create `src/services/AuthService.js` and wire it to the logout button in `ModeSelectionScreen`.

2. **No `Repository` layer implemented** — The architecture plans a Repository layer (Adapter pattern for SQLite/IndexedDB) but it is not built yet. All data is going through `SessionService` directly for now. Build repositories when the Dashboard and patient data features are implemented.

3. **Session object is minimal** — `startShift()` currently stores only `nurse_name` and `started_at`. The future API will expect more fields (device ID, app version, shift type, etc.). Extend the session object in `SessionService.startShift()` before the API integration.

4. **No token storage** — When the API introduces JWT or session tokens, a secure storage solution is needed. Do **not** store tokens in `AsyncStorage` (not encrypted). Use `expo-secure-store` instead.
   ```bash
   npx expo install expo-secure-store
   ```

---

## Useful Links

- [React Native Docs](https://reactnative.dev/docs/getting-started)
- [Expo Docs](https://docs.expo.dev)
- [React Navigation](https://reactnavigation.org)
- [Expo SDK API Reference](https://docs.expo.dev/versions/latest/)
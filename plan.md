# US10 — Patient Details Dashboard ("What do I know")

**Story**: As a nurse I want to see all information Sofia knows about a specific patient organized in cards so that I have a complete overview of their current status, medications, and activities.

**Points**: 3 | **Sprint**: Sprint 3 | **Predecessor**: US9 | **Successors**: US11, US19, US22

**Figma Design**: https://www.figma.com/design/xatJv9J3dQWl258H1l4eWM/Sof-IA-HealthCare-assistant?node-id=0-1&t=wM6oBNnyuvEnom4G-1
**Figma Prototype**: https://www.figma.com/proto/xatJv9J3dQWl258H1l4eWM/Sof-IA-HealthCare-assistant?node-id=7-2251&starting-point-node-id=7%3A2250

---

## Sprint 3 Story Map

These 4 stories form a layered stack on the same `BedDetails` screen area. US10 is the foundation; the others extend it.

| US | Owner | What it owns |
|---|---|---|
| **US10** (this branch) | Julio | Screen shell, card UI components, `BedDetailScreen` rewrite, navigation entry point |
| **US22** | Tatiana | Dedicated storage tables (`medications`, `vital_signs`, `allergies`, `safety_info`), richer card schemas, `flagged`/`confidence` system, real-time updates from API |
| **US11** | — | `ActivityDetailScreen` — tap Recent Activity card → full clinical narrative + collapsible translation |
| **US19** | — | `CorrectionScreen` — tap flagged card → edit AI values locally, audit trail |

### Layering contract

- **US10** reads card data from `transcription_segments.structured_json` — this is intentionally temporary. When US22 lands, Tatiana replaces the data source in `PatientDetailsPresenter._loadCards()` to read from dedicated tables. The view (`BedDetailScreen`) is not touched.
- **US10 `InfoCard` must already accept `flagged` + `confidence` props** so US22 can set them without touching the component.
- **`onCardPress`** passes `{ card, patient }` to navigation. US11 adds the `ActivityDetail` route; US19 adds `CorrectionScreen`. US10 stubs both with a `console.log` — do NOT add blank nav routes in `AppNavigator.js`.
- **Storage tables** (`medications`, `vital_signs`, `allergies`, `safety_info`) are US22's responsibility. US10 creates no new migrations.

---

## Context & Constraints

- **Entry point**: tap a bed card on the Main Dashboard → navigates to `BedDetails` (already registered in `AppNavigator.js`).
- **Existing file** `src/screens/BedDetailScreen.js` is a placeholder — must be **fully replaced**.
- **Architecture**: MVP — `PatientDetailsPresenter.js` owns all logic; `BedDetailScreen.js` is pure view.
- **Data source (US10)**: `transcription_segments`, queried per session and filtered by `bed_id == patient.id`.
- `DashboardPresenter.onBedPress` currently passes `{ patient, segments }` — add `sessionId` so `PatientDetailsPresenter` can poll for live updates.
- **Bottom controls** are the same as the Main Dashboard — reuse `AudioSourceBadge` / `MicInputIcon`.
- **Do NOT add** `ActivityDetail` or `CorrectionScreen` routes to `AppNavigator.js` (US11/US19 own those).

---

## Card Specification

Cards are displayed in this fixed priority order:

| # | Card type | Icon | Data source (US10) | Always shown | Tappable |
|---|---|---|---|---|---|
| 1 | Session Active | Shield | `sessions.started_at` / `expires_at` | Yes (if active session) | No |
| 2 | Recent Activity | Clock | Latest `transcription_segments` row | No | Yes (eye icon if hasData) |
| 3 | Medications | Pill | `medications[]` across segments, deduplicated | No | Yes |
| 4 | Next Reminder | Bell | `actions[]` across segments (first action) | No | Yes |
| 5 | Vital Signs | Heart | Latest `vitals` object from segments | No | Yes |
| 6 | Allergies | Warning | `patients.allergies` field | No | Yes |
| 7 | Safety Information | Info | `patients.notes` field | No | Yes |

**Card props (forward-compatible with US22)**:
```js
{
  type: string,           // 'recent_activity' | 'medications' | 'vital_signs' | ...
  hasData: bool,          // true → show green eye icon
  flagged: bool,          // false in US10; US22 sets true when confidence < threshold
  confidence: number,     // 1.0 in US10 (no AI scoring yet); US22 sets real value
  preview: string,        // one-line summary text
  items?: any[],          // structured data for detail screens (US11/US19)
  data?: object,          // raw object (vitals)
}
```

**Card interaction**:
- `hasData && !flagged` → green eye icon top-right, tap → `onCardPress` (stub for US11/US19)
- `flagged` → orange/yellow background, warning icon instead of eye, tap → `onCardPress` (stub for US19)
- `!hasData` → muted card, no icon, tap → `onCardPress` (stub for US19)

**Empty state**: Session Active card + `"No information extracted yet. Start recording to capture patient data."`

**Animations**: fade-in slide when a new card appears; brief pulse scale on card data update.

---

## Screen Header

```
[←]   [patient icon + bed icon]   "What do I know"
[AudioSourceBadge — green: "Rode Wireless Mini connected" / gray: "Using device mic"]
[Bed X: 'Name']   ← patient identifier, below badge
```

---

## Execution Order

| Step | Status | Description |
|---|---|---|
| F1 | ✓ Done | `PatientDetailsPresenter.js` — mount, card aggregation, live polling |
| F2 | ✓ Done | Rewrite `BedDetailScreen.js` — full "What do I know" UI |
| F3 | ✓ Done | Update `DashboardPresenter.onBedPress` — add `sessionId` to nav params |
| F4 | ✓ Done | Tests |

---

## Implementation Steps

### ~~Step 1 — `PatientDetailsPresenter.js`~~ ✓

**File**: `src/presenters/PatientDetailsPresenter.js` — created.

Key behaviours:
- `mount({ patient, sessionId })` → resolves audio source, loads session card, loads info cards, subscribes to recording state, starts 5s poll.
- `_loadCards()` → queries `transcription_segments` by session, filters by `bed_id`, calls `buildCards()`, only calls `setCards` when result changes (JSON key diff).
- `buildCards(segments, patient)` exported as pure function for unit tests and future replacement by US22.
- `onCardPress(card, navigation)` stubs with `console.log` — US11/US19 will implement.

---

### Step 2 — Rewrite `BedDetailScreen.js` (F2)

**File**: `src/screens/BedDetailScreen.js` — full replacement.

**View interface** injected by the screen into the presenter:
```js
{
  setAudioSource({ sourceKey, sourceLabel, canToggle }),
  setRecording(bool),
  setConnectionStatus('online' | 'offline-buffering'),
  setBrowserSupported(bool),
  setSessionCard({ startedAt, expiresAt } | null),
  setCards(card[]),
}
```

**Screen state** (useState):
```js
audioSource, recording, browserSupported, sessionCard, cards
```

**Layout** (top → bottom):
1. `SafeAreaView`
2. **Header row** (height 64): back arrow `←` | patient icon SVG + bed icon SVG + `"What do I know"` (centered flex:1) | spacer 48px
3. **`AudioSourceBadge`** (centered, same as Dashboard, with `onPress → presenter.onToggleSource()`)
4. **Patient identifier** `Text`: `"Bed X: 'Name'"` or `"Bed X"` if no name
5. **`ScrollView`** (flex:1):
   - `SessionActiveCard` (always shown if `sessionCard != null`)
   - `InfoCard[]` for each card in `cards`
   - Empty state `Text` if `cards.length === 0`
6. **Bottom bar** (fixed, same layout as Dashboard): Speaker placeholder (left, disabled) | `PulsingMicButton` (center) | `MicInputIcon` + label (right)

**`SessionActiveCard`** (not tappable):
- Inline shield SVG, title `"Session Active"`, body `Started: HH:MM  /  Expires: HH:MM`
- Background `#F5F5F5`, border radius 12

**`InfoCard`** (tappable):
```js
// Props: type, hasData, flagged, confidence, preview, onPress
```
- Icon per type (inline SVG constants at top of file)
- Preview text (1 line, ellipsis)
- If `hasData && !flagged`: green eye SVG icon top-right
- If `flagged`: orange/yellow background (`#FFFBEC`), warning SVG icon top-right
- `TouchableOpacity` → `onPress`
- Animated entry: `Animated.Value(0)` opacity + translateY `+12 → 0` on mount

**`PulsingMicButton`**: copy from `DashboardScreen.js` (identical — do not abstract yet).

**SVG icons needed** (inline constants): shield, clock, pill, bell, heart, warning-triangle, info-circle, eye, arrow-back, patient-with-bed.

---

### Step 3 — Update `DashboardPresenter.onBedPress` (F3)

**File**: `src/presenters/DashboardPresenter.js`

Add `sessionId` to the navigation params:

```js
async onBedPress(patient, navigation) {
  this._activePatient = { id: patient.id, name: patient.name, bed: patient.bed };
  this._view.setActivePatient(this._activePatient);

  const sessionId = await SessionService.getActiveSessionId();
  try {
    const storage = await getStorage();
    const segments = sessionId
      ? await storage.queryBySession('transcription_segments', sessionId)
      : [];
    navigation.navigate('BedDetails', { patient, segments, sessionId }); // ← add sessionId
  } catch (e) {
    console.error('[DashboardPresenter] onBedPress nav error:', e);
    navigation.navigate('BedDetails', { patient, segments: [], sessionId: null });
  }
}
```

---

### Step 4 — Tests (F4)

| File | What to test |
|---|---|
| `src/__tests__/presenters/PatientDetailsPresenter.test.js` | `buildCards`: segments with medications → card present; empty segments → empty array; `flagged=false` default; session card falls back to `started_at + 14h` when `expires_at` is null |
| `src/__tests__/screens/BedDetailScreen.test.js` | Renders `"What do I know"` title; `SessionActiveCard` visible; empty state message when `cards=[]`; `InfoCard` shows eye icon when `hasData=true && flagged=false`; flagged card has orange bg |

---

## File Checklist

| Action | File | Status |
|---|---|---|
| CREATE | `src/presenters/PatientDetailsPresenter.js` | ✓ Done |
| REPLACE | `src/screens/BedDetailScreen.js` | Next |
| MODIFY | `src/presenters/DashboardPresenter.js` | — |
| CREATE | `src/__tests__/presenters/PatientDetailsPresenter.test.js` | — |
| CREATE | `src/__tests__/screens/BedDetailScreen.test.js` | — |

---

## Out of Scope

- `ActivityDetailScreen` — US11 (tap Recent Activity card → clinical narrative)
- `CorrectionScreen` — US19 (tap flagged card → edit AI values)
- Dedicated tables (`medications`, `vital_signs`, `allergies`, `safety_info`) — US22 (Tatiana)
- `flagged` cards being triggered — US22 sets `flagged=true` based on `confidence`; US10 only wires the UI for it
- Medications sorted by next due time — no `next_due` field until US22
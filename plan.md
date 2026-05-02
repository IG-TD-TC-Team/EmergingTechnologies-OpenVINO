# US11 — Clinical Activity Detail View

**Story**: As a nurse, I want to view the complete clinical narrative of a documented activity (assessment, examination, patient interaction) so that I can review the full context, reasoning, and observations that were captured during the voice recording.

**Points**: 3 | **Sprint**: Final Sprint | **Predecessors**: US10, US6 | **Successor**: US19

**Figma Design**: https://www.figma.com/design/xatJv9J3dQWl258H1l4eWM/Sof-IA-HealthCare-assistant?node-id=0-1&t=wM6oBNnyuvEnom4G-1
**Figma Prototype**: https://www.figma.com/proto/xatJv9J3dQWl258H1l4eWM/Sof-IA-HealthCare-assistant?node-id=7-2251&p=f&viewport=96%2C335%2C0.03&t=fmQ4xeKLXRZ9wFQu-1&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=7%3A2250&page-id=0%3A1

---

## MVP Scope

- **Translation section**: removed — language is displayed in the metadata bar only (ISO 639-1 code from `transcription_segments.language`, captured by Whisper).
- **Timestamp format**: "Today HH:MM" — always same-day since all data is cleared at end of shift.
- **Demo navigation**: demo cards (`recent_activity`, `next_reminder`, `vital_signs`) already have `hasData: true && !flagged`. Once T4 registers the `CardDetail` route, tapping any of them navigates to `CardDetailScreen`. No extra demo logic needed. Demo cards have no `ts_start` / `language` — metadata bar shows "Today –" / "Language: –" for those fields, which is acceptable.

---

## Context & Constraints

- **Entry point**: tap "Recent Activity" card (`hasData && !flagged`) from `BedDetailScreen`. `PatientDetailsPresenter.onCardPress` already calls `navigation.navigate('CardDetail', { card, patient })`.
- **Architecture**: MVP — `CardDetailPresenter.js` owns all logic; `CardDetailScreen.js` is pure view.
- **Read-only**: this screen does not write to any storage.
- **Scroll position on back**: `navigation.goBack()` on the React Navigation stack preserves `BedDetailScreen` state naturally.
- **Clipboard**: `expo-clipboard` must be added to `package.json` (T0) so it installs automatically with `npm install`. Use `Clipboard.setStringAsync(text)`.

---

## Card Payload (via navigation params)

The `card` object from `PatientDetailsPresenter.onCardPress`:

```js
{
  type: 'recent_activity',
  hasData: true,
  flagged: false,
  preview: '14:10  ·  Fatigue post-partum',
  activityType: 'Fatigue post-partum' | null,
  transcript: 'Patiente : Je dors pas bien...' | null,
  // ← T1 adds these:
  language: 'fr' | null,       // ISO 639-1 from Transcription.language
  ts_start: 1714567890000 | null,
  sections: [{ header: 'Assessment', body: '...' }] | null,
}
```

---

## Navigation Contract

```js
// Entry — already wired in PatientDetailsPresenter.onCardPress:
navigation.navigate('CardDetail', { card, patient });

// Edit button (US19 stub — do NOT add CardCorrection route yet):
// console.log('[CardDetailPresenter] edit stub')
// US19 will receive: { patientId: patient.id, fieldKey: 'recent_activity', currentValue: card.transcript }
```

---

## Screen Spec

```
╔══════════════════════════════════════════════╗
║  [←]  [patient+bed icon]  "Pain assessment"  ║  Header (h=64)
║  [AudioSourceBadge: "Pin device connected…"] ║
║  Bed 1: 'Alice'                              ║
╠══════════════════════════════════════════════╣
║  Today 14:10   Language: fr   [✏️]  [📋]    ║  Metadata bar (fixed, bg #F7F7F7)
╠══════════════════════════════════════════════╣
║  Assessment                                  ║  ↑
║  Patient reports fatigue post-partum…        ║  |
║                                              ║  ScrollView (flex:1)
║  Plan                                        ║  |
║  Monitor BP. Educate on breastfeeding…       ║  ↓
╚══════════════════════════════════════════════╝
```

- **If `sections` present**: render each `{ header, body }` as section header + body text.
- **Else if `transcript`**: render raw text as plain paragraphs.
- **Else**: `"No narrative available."`
- **If `ts_start` is null**: show `"Today –"`. **If `language` is null**: show `"Language: –"`.

---

## Execution Order

| Step | Status | Description |
|---|---|---|
| T0 | ✓ Done | Add `expo-clipboard` to `package.json` → auto-installs with `npm install` |
| T1 | ✓ Done | Enrich `buildCards()` in `PatientDetailsPresenter.js` — add `language`, `ts_start`, `sections` to `recent_activity` card |
| T2 | ✓ Done | `CardDetailPresenter.js` — mount, metadata derivation, clipboard, edit stub |
| T3 | ✓ Done | `CardDetailScreen.js` — full UI per spec |
| T4 | ✓ Done | Register `CardDetail` in `AppNavigator.js` |
| T5 | ✓ Done | Tests |

---

## Implementation Steps

### Task 0 — Add `expo-clipboard` to `package.json`

**File**: `Sof-IA_FrontEnd/package.json`

Add to `dependencies`:
```json
"expo-clipboard": "~7.0.0"
```

Expo 55 is compatible with `expo-clipboard` 7.x. This ensures `npm install` (or `yarn`) handles it automatically with no manual step.

---

### Task 1 — Enrich `recent_activity` card in `buildCards()`

**File**: `src/presenters/PatientDetailsPresenter.js`

In the `// 2 — Recent Activity` block, add three fields:

```js
cards.push(card({
    type: 'recent_activity',
    hasData: true,
    preview: [...],
    activityType,
    transcript: latest.transcript ?? null,
    language: latest.language ?? null,              // ← ADD (ISO 639-1 from Whisper)
    ts_start: latest.ts_start ?? null,              // ← ADD
    sections: latest.structured?.sections ?? null,  // ← ADD
}));
```

No other changes. Update `PatientDetailsPresenter.test.js` assertions to pass through the three new fields.

---

### Task 2 — `CardDetailPresenter.js`

**File**: `src/presenters/CardDetailPresenter.js` — CREATE

**View interface** (injected by the screen):
```js
{
  setAudioSource({ sourceKey, sourceLabel, canToggle }),
  setMetadata({ timeLabel, language }),   // timeLabel = "Today HH:MM" or "Today –"
  setNarrative({ transcript, sections }),
  showCopyToast(),
}
```

**Key behaviours**:
- `mount({ card, patient })` → `_resolveAudioSource()`, `_view.setMetadata(_deriveMetadata(card.ts_start, card.language))`, `_view.setNarrative({ transcript: card.transcript ?? null, sections: card.sections ?? null })`.
- `_deriveMetadata(tsStart, language)`:
  - `timeLabel`: if `tsStart` → `"Today " + HH:MM formatted from tsStart`; else `"Today –"`.
  - `language`: pass through or `"–"` if null.
- `onCopyPress()` → builds full text (sections joined, or raw transcript) → `Clipboard.setStringAsync(text)` → `this._view.showCopyToast()`.
- `onEditPress()` → `console.log('[CardDetailPresenter] edit stub — US19')`.
- `unmount()` → `AudioSourceResolver.resetOverride()`.

---

### Task 3 — `CardDetailScreen.js`

**File**: `src/screens/CardDetailScreen.js` — CREATE

**State** (`useState`): `audioSource`, `metadata`, `narrative`, `copyToastVisible`

**View interface** bound to presenter:
```js
{
  setAudioSource:  (src)  => setAudioSource(src),
  setMetadata:     (m)    => setMetadata(m),
  setNarrative:    (n)    => setNarrative(n),
  showCopyToast:   ()     => { setCopyToastVisible(true); setTimeout(() => setCopyToastVisible(false), 2000); },
}
```

**Layout** (top → bottom):

1. `SafeAreaView`
2. **Header row** (h=64): `←` `TouchableOpacity` → `navigation.goBack()` | `[patient-with-bed SVG]` + `Text` (card.activityType or `"Clinical Activity"`) centered flex:1 | spacer 48px
3. **`AudioSourceBadge`** — same component as `BedDetailScreen`, `onPress → presenter.onToggleSource()`
4. **Patient identifier** `Text`: `"Bed X: 'Name'"` or `"Bed X"` if no name
5. **Metadata bar** (`backgroundColor: '#F7F7F7'`, padding 10–12, fixed — not inside ScrollView):
   - Left: `"{metadata.timeLabel}"` · `"Language: {metadata.language}"` (small muted text)
   - Right: `[edit-pencil SVG]` `TouchableOpacity` → `presenter.onEditPress()` | `[copy SVG]` `TouchableOpacity` → `presenter.onCopyPress()` (min 44×44pt each)
6. **`ScrollView`** (flex:1, padding 16):
   - If `narrative.sections`: map each `{ header, body }` → section header `Text` + body `Text`
   - Else if `narrative.transcript`: `<Text>{narrative.transcript}</Text>`
   - Else: `<Text style={styles.empty}>"No narrative available."</Text>`
7. **Copy toast** (Animated, absolute overlay, centered, `backgroundColor: 'rgba(0,0,0,0.7)'`, borderRadius 8): `"Copied to clipboard"` — visible for 2s when `copyToastVisible`

**SVG icons** (inline constants, same pattern as `BedDetailScreen.js`): `arrow-back`, `patient-with-bed`, `edit-pencil`, `copy-clipboard`.

---

### Task 4 — Register `CardDetail` in `AppNavigator.js`

**File**: `src/navigation/AppNavigator.js`

```js
import CardDetailScreen from '../screens/CardDetailScreen';

// Inside Stack.Navigator, after BedDetails:
<Stack.Screen name="CardDetail" component={CardDetailScreen} options={SLIDE_OPTIONS} />
```

This also enables demo card navigation — once this route exists, tapping any demo card with `hasData: true && !flagged` (recent_activity, next_reminder, vital_signs) will open `CardDetailScreen`.

---

### Task 5 — Tests

| File | What to test |
|---|---|
| `src/__tests__/presenters/CardDetailPresenter.test.js` | `mount` sets metadata and narrative; `_deriveMetadata` returns `"Today 14:10"` for valid ts_start; returns `"Today –"` when null; `onCopyPress` calls `Clipboard.setStringAsync` and triggers `showCopyToast`; `onEditPress` does not throw |
| `src/__tests__/screens/CardDetailScreen.test.js` | Renders activityType as title; falls back to "Clinical Activity" if null; metadata bar shows timeLabel and language; sections rendered when present; falls back to transcript; "No narrative available." when both null; copy icon present and pressable |

---

## File Checklist

| Action | File | Status |
|---|---|---|
| MODIFY | `package.json` — add expo-clipboard | — |
| MODIFY | `src/presenters/PatientDetailsPresenter.js` | — |
| CREATE | `src/presenters/CardDetailPresenter.js` | — |
| CREATE | `src/screens/CardDetailScreen.js` | — |
| MODIFY | `src/navigation/AppNavigator.js` | — |
| CREATE | `src/__tests__/presenters/CardDetailPresenter.test.js` | — |
| CREATE | `src/__tests__/screens/CardDetailScreen.test.js` | — |

---

## Out of Scope

- Translation section — removed from MVP; language code from transcription API shown in metadata bar only
- `CardCorrection` / edit persistence — US19
- `PatientField` / `PatientRecord` types in `types/patient.ts` — US19's responsibility
- Analytics tracking of copy/edit actions — future sprint
# US19 — Card Editing Refactor + Bug Fixes

**Story**: As a nurse, I want to correct any clinical card captured by the AI so that the data in the system accurately reflects what happened with the patient.

**Sprint**: Post-sprint bug-fix phase
**Azure DevOps**: Work item #19 (Active) — https://dev.azure.com/Sof-IA/Front-End-React/_workitems/edit/19

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Remove PatientInfoSection entirely | Administrative fields (name, MRN, DOB) are not AI-captured; editing them from the app adds no clinical value and creates UX confusion. The real US19 goal is correcting AI-captured clinical cards. |
| Keep PatientRepository + field_edits storage | The `field_edits` JSON blob on the patient record is still the persistence layer for card edits (synthetic keys: `recent_activity`, `vital_signs`, etc.). Only the view layer changes. |
| Pre-populate from `_buildCopyText()` | Reuses existing formatting logic. One-line fix. The nurse must see what the AI captured before editing — blank form is unusable. |
| FlatList scroll fix | Without `flex: 1`, FlatList never claims bounded height → items clip behind the bottom bar. |

---

## DB Impact — PatientInfoSection removal

`PatientRepository.get()` and `updateField()` remain in use after the removal:

| Caller | Still needed? |
|--------|---------------|
| `CardDetailPresenter.checkEditStatus()` | YES — reads `field_edits` to check if a card was edited |
| `EditPatientPresenter.mount()` | YES — reads edit history (edited_by, original_value) for any fieldKey |
| `EditPatientPresenter.onSave()` | YES — writes card corrections via `updateField(patientId, card.type, newValue)` |
| `PatientDetailsPresenter.loadPatientFields()` | REMOVED — only fed PatientInfoSection |
| `PatientDetailsPresenter.onFieldPress()` | REMOVED — only called from PatientInfoSection |

`FIELD_COLUMN_MAP` columns (name, bed, mrn, date_of_birth, diagnosis, allergies, medications, notes) remain in the `patients` table. They are no longer editable from the UI. The `buildCards` fallback paths (`patient?.allergies`, `patient?.notes`) continue to work from the patient object passed as a nav param.

**No migration. No DB schema change.**

---

## Bug 1 — Remove PatientInfoSection

**Files touched**: `BedDetailScreen.js`, `PatientDetailsPresenter.js`

### BedDetailScreen.js

Remove:
- `patientFields` state (`useState([])`)
- The focus listener that calls `loadPatientFields()` (lines 287–291)
- `PatientInfoSection` component definition (lines 222–254)
- `PatientInfoSection` usage inside `ListHeaderComponent`
- The `sectionLabel` divider (`{patientFields.length > 0 && cards.length > 0 && ...}`)
- `setPatientFields` from the view interface object passed to presenter
- `patientSection`, `patientSectionTitle`, `patientFieldRow`, `patientFieldContent`, `patientFieldLabel`, `patientFieldValue`, `patientFieldValueEdited`, `patientFieldRight`, `editedDot`, `sectionLabel` styles

Keep:
- `SessionActiveCard` in `ListHeaderComponent` (still useful — shows shift start time and expiry)
- `FlatList` itself
- All other state, presenter wiring, and the bottom bar

### PatientDetailsPresenter.js

Remove:
- `loadPatientFields()` method
- `onFieldPress()` method
- The `loadPatientFields()` call inside `mount()`

Keep:
- Everything else — `_loadCards()`, `_loadSessionCard()`, `onCardPress()`, mic logic, demo logic

---

## Bug 2 — Pre-populate edit form with AI-captured data

**File**: `src/presenters/CardDetailPresenter.js`, `onEditPress()` (line 97–104)

**Current behaviour**: passes `this._card?.transcript ?? ''` as `currentValue`. Transcript is only populated on `recent_activity` cards. For all other card types the nurse sees a blank text box.

**Fix**: replace `currentValue` with `this._buildCopyText()`.

`_buildCopyText()` already produces the correct text for every card type:

| Card type | Output |
|-----------|--------|
| `recent_activity` | Full conversation (all segments joined) |
| `vital_signs` | `Blood Pressure: 120/80 mmHg\nHeart Rate: 72 bpm\n…` |
| `medications` | `Paracetamol — 500mg — qid\n…` |
| `allergies` | `Penicillin — severe\n…` |
| `next_reminder` | Actions joined with `\n` |
| `safety_info` | Safety flags (falls through to transcript) |

**Change** (1 line):
```js
// Before
currentValue: this._card?.transcript ?? '',

// After
currentValue: this._buildCopyText(),
```

No other changes. The `EditPatientPresenter.mount()` already shows `original_value` (AI value) as a read-only audit trail when `isEdited` is true, so re-editing later still shows the original AI capture correctly.

---

## Bug 3 — BedDetailScreen cards not scrollable

**File**: `src/screens/BedDetailScreen.js`, `FlatList` element (line 330)

**Root cause**: `FlatList` has no `style` prop. In a flex-column `SafeAreaView` (`flex: 1`), an unstyled `FlatList` takes its natural height (unconstrained), overflows past the bottom bar, and never scrolls.

**Fix**: add `style={{ flex: 1 }}` to the `FlatList`.

```jsx
// Before
<FlatList
    data={cards}
    keyExtractor={(item) => item.type}
    contentContainerStyle={styles.cardList}
    ...
/>

// After
<FlatList
    style={{ flex: 1 }}
    data={cards}
    keyExtractor={(item) => item.type}
    contentContainerStyle={styles.cardList}
    ...
/>
```

`contentContainerStyle` stays as-is (padding, gap). Only the outer FlatList container gains `flex: 1`.

---

## Execution Order

| Step | File | Change | Status |
|------|------|--------|--------|
| T1 | `BedDetailScreen.js` | Remove PatientInfoSection + patientFields state + focus listener + styles | Done |
| T2 | `PatientDetailsPresenter.js` | Remove `loadPatientFields()` and `onFieldPress()` | Done |
| T3 | `CardDetailPresenter.js` | `onEditPress()` — replace `card.transcript` with `_buildCopyText()` | Done |
| T4 | `BedDetailScreen.js` | Add `style={{ flex: 1 }}` to FlatList | Done |
| T5 | Tests | Fixed 3 pre-existing failures (locale AM/PM, demo-mode Alice); added vital_signs pre-population test | Done |

---

## Out of Scope

- Editing directly inside `CardDetailScreen` (inline editing) — too large a change, EditPatient flow is sufficient
- Deleting individual card entries (e.g. remove one medication) — separate story
- Syncing nurse corrections back to the backend — backend not yet set up for that
- Editing demo cards (Alice) — demo data is ephemeral, no patient record in DB

# Documentation Audit — Full Project Markdown Diagnosis

## Scope

All project-authored `.md` files excluding third-party artifacts (`.venv/`, `node_modules/`, model card downloads in `models/phi3-mini-pytorch/`).

| File | Category | Result |
|------|----------|--------|
| `CLAUDE.md` | Root config | Fixed ✓ |
| `plan.md` | Living spec | Up to date |
| `Sof-IA_FrontEnd/README.md` | Frontend intro | Fixed ✓ |
| `Sof-IA_FrontEnd/HOW_TO_USE.md` | Storage guide | Fixed ✓ |
| `Sof-IA_FrontEnd/HOW_TO_USE_CAPABILITIES.md` | Capabilities | Fixed (previous session) ✓ |
| `Sof-IA_FrontEnd/src/__tests__/README.md` | Test suite | Fixed (previous session) ✓ |
| `Sof-IA_FrontEnd/src/repositories/USAGE.md` | Repo usage | Fixed (previous session) ✓ |
| `Sof-IA_FrontEnd/src/repositories/adapters/STORAGE_FACTORY.md` | Factory guide | No issues ✓ |
| `Sof-IA_Backend/README.md` | Backend entry | Fixed (previous session) ✓ |
| `Sof-IA_Backend/TECHNICAL_BACKGROUND.md` | Theory | Fixed (previous session) ✓ |
| `Sof-IA_Backend/PROJECT_PRESENTATION.md` | Presentation | D8 open — pending team discussion |
| `Sof-IA_Backend/OPENVINO_PRESENTATION.md` | OpenVINO theory | No issues ✓ |
| `Sof-IA_Backend/BENCHMARK_HOWTO.md` | Benchmark guide | No issues ✓ |
| `Sof-IA_Backend/CLAUDE.md` | Backend config | Does not exist — G1 fixed (reference updated to README.md) |
| `Sof-IA_Backend/models/phi3-mini-pytorch/*.md` | Model cards | Third-party HuggingFace artifacts — not audited |

---

## CLAUDE.md (root)

| Task | Issue | Status |
|------|-------|--------|
| G1 | **Dangling reference to `Sof-IA_Backend/CLAUDE.md`** — Updated reference to point to `Sof-IA_Backend/README.md`. | Done |

---

## Sof-IA_FrontEnd/README.md

| Task | Issue | Status |
|------|-------|--------|
| R1 | **Project structure tree shows non-existent service directories** — Replaced with actual structure (correct service subdirs, `SessionService.ts`, `EndShiftService.ts`). | Done |
| R2 | **Navigation flow references `PatientDetailScreen`** — Updated to show actual screens: BedDetailScreen, CardDetailScreen, EditPatientScreen, SettingsScreen. | Done |
| R3 | **Screens table is pre-implementation** — Updated to list all 7 implemented screens, all marked Done. | Done |
| R4 | **Adapter class names wrong in architecture diagram** — Fixed: `IStorageRepository` → `IRepository`, `SQLiteRepository` → `SqliteAdapter`, `IndexedDBRepository` → `DexieAdapter`. Applied in both the layered diagram and the Proposed Folder Structure. | Done |
| R5 | **"Known gaps" section says "No Repository layer implemented"** — Removed item 2; renumbered remaining items. | Done |
| R6 | **"Local Storage" section promotes AsyncStorage as the storage mechanism** — Section now describes IRepository as the primary storage layer; AsyncStorage noted only for nurse name preference. | Done |
| R7 | **`SessionService.js` referenced throughout** — Updated all occurrences to `SessionService.ts`; also corrected the API migration table to show IRepository calls instead of AsyncStorage for session methods. | Done |
| R8 | **Architecture section framed as "proposition"** — Removed "Architecture Proposition" heading and disclaimer; section now titled "Architecture". | Done |
| R9 | **Azure DevOps URL points to wrong view** — Changed to canonical org/project URL `https://dev.azure.com/Sof-IA/Front-End-React/`. | Done |
| R10 | **Recording state machine shown twice** — Removed the simpler first occurrence; kept the detailed second version. | Done |

---

## Sof-IA_FrontEnd/HOW_TO_USE.md

| Task | Issue | Status |
|------|-------|--------|
| H1 | **`storage.findById()` does not exist** — Replaced with `storage.read()` throughout. | Done |
| H2 | **`storage.findAll()` does not exist** — Replaced with `storage.queryBySession()` and `storage.findByField()` examples. | Done |
| H3 | **`storage.count()` does not exist** — Replaced with `storage.findByField()` in troubleshooting section. | Done |
| H4 | **`storage.exists()` does not exist** — Removed. | Done |
| H5 | **`storage.batchCreate()` does not exist** — Replaced with `Promise.all(items.map(...))` pattern. | Done |
| H6 | **`storage.batchDelete()` uses wrong name** — Replaced with `storage.bulkDelete(store, whereClause)` throughout. | Done |
| H7 | **`storage.transaction()` does not exist** — Cascading delete pattern rewritten without transaction wrapper. | Done |
| H8 | **`storage.healthCheck()` does not exist** — Replaced with `StorageFactory.getHealth()` (correct static API). | Done |
| H9 | **TTL stated as "12 hours for all records"** — Replaced with the correct per-entity table (Sessions 30d, Audio 7d, Transcriptions 14h, Patients purged at session end). | Done |
| H10 | **Expected test output is stale** — Removed hardcoded test suite count. | Done |
| H11 | **Test checklist says "22+ tests pass"** — Changed to "all tests pass". | Done |
| H12 | **"Status: Prototyping Ready" footer** — Removed. | Done |
| H13 | **Large overlap with USAGE.md** — Added reference banner at top of file pointing to USAGE.md. Final decision (keep vs. delete) pending team discussion. | Open |

---

## Sof-IA_Backend/PROJECT_PRESENTATION.md

| Task | Issue | Status |
|------|-------|--------|
| D8 | **Sections 6, 7, 8 are empty** — Pending team discussion. | Open |

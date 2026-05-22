# Documentation Audit & Solution Plan

Audit (2026-05-22) of all project-authored `.md` files, **verified against the actual code**. The prior `plan.md` marked everything "Fixed ✓"; verification showed several docs still described APIs, files, and DB names that did not match the code. Those have now been corrected.

Excludes third-party artifacts (`node_modules/`, `.expo/`, `.venv/`, `models/phi3-mini-pytorch/*` HuggingFace cards).

## Decisions taken

- **C1 (Repository guide location): keep merged.** The Repository Layer guide stays inside `HOW_TO_USE_CAPABILITIES.md`; inbound links repointed and the dangling `USAGE.md` link removed.
- **B1 (model registry): reframed for dynamic models.** The model list is not fixed — users download and convert models at runtime via the dashboard catalogue. The README now presents the table as the *default declared set*, not an exhaustive registry, and all model mentions reflect runtime download/convert.

## Ground truth (verified this audit)

- `IRepository` (`src/repositories/interfaces/IRepository.ts`) defines exactly: `create, read, update, delete, queryBySession, queryBySessionAndBed, bulkDelete, findByField, purgeExpired`. No `findById`, `count`, `exists`, `transaction`, `batchCreate`, `batchDelete`, `findAll`.
- Both `getStorage` (StorageFactory) and `getRepository` (RepositoryFactory) are real exports (`adapters/index.ts`). App code (`SessionService.ts`) uses **`getStorage`** → adopted as canonical in docs.
- Dexie DB name = `sofia_db` (`DexieAdapter.ts:41`). SQLite DB = `sofia.db` via `expo-sqlite` (`SqliteAdapter.ts:23`), stored under `…/SQLite/`, not `…/databases/`.
- Android package = `com.juliocortes.sofia` (`app.json:18`), not `com.sofia.app`.
- `models.yaml` enables 9 models incl. 3 Qwen via `generic_pytorch.py` / `generic_openvino.py`; both extend `StreamingSLMBase`. Backend README had documented only 6.
- US21/US22/US23 confirmed in code (active-patient selection / per-bed card stores / shift+recording auto-resume).

---

## Applied fixes

### `src/__tests__/README.md`
| # | Issue | Status |
|---|-------|--------|
| T1 | `storage.findById()` → `storage.read()` in examples | Done |
| T2 | Coverage claimed Count / Existence / Pagination — replaced with real ops (`findByField`, `queryBySession`, `queryBySessionAndBed`, `bulkDelete`) | Done |
| T3 | Coverage claimed Transaction support + batch create — removed (only `bulkDelete` exists) | Done |
| T4 | Listed a `screens/` test folder of 4 files that do not exist — removed | Done |
| T5 | Emojis removed to match the no-emoji convention | Done |

### `Sof-IA_FrontEnd/HOW_TO_USE.md`
| # | Issue | Status |
|---|-------|--------|
| U1 | Dangling link to deleted `USAGE.md` → repointed to the Repository Layer section in `HOW_TO_USE_CAPABILITIES.md` | Done |
| U2 | "Use transactions" performance tip removed; list rewritten to real ops | Done |
| U3 | Web DB `sofia` → `sofia_db` (two spots) | Done |
| U4 | `expires_at` "30 days" footnote → per-entity TTL | Done |
| U5 | SQLite path corrected (expo-sqlite `SQLite/` subfolder, not `databases/`) | Done |

### `Sof-IA_FrontEnd/HOW_TO_USE_CAPABILITIES.md`
| # | Issue | Status |
|---|-------|--------|
| C1 | Kept merged (per decision) | Done |
| C2 | `adb pull …/com.sofia.app/databases/…` → `adb exec-out run-as com.juliocortes.sofia cat files/SQLite/sofia.db` | Done |
| C3 | SQLite path → `<documentDir>/SQLite/sofia.db` | Done |
| C4/X1 | Repository examples standardized on `getStorage`/`storage`; `getRepository` noted once as the light alias; test reset uses `StorageFactory.reset()` | Done |

### `Sof-IA_Backend/README.md`
| # | Issue | Status |
|---|-------|--------|
| B1 | Model registry reframed as dynamic; Qwen rows added; runtime download/convert documented | Done |
| B2 | Structure tree updated: `src/pipeline/`, `src/model_manager/`, `generic_*` SLM files, `logging_config.py`, `asr/base.py`, benchmark `resources.py`/`report.py` | Done |
| B3 | OOP hierarchy adds `GenericSLMPyTorch` / `GenericSLMOpenVINO` | Done |
| B4 | Structure tree root `OpenVino/` → `Sof-IA_Backend/` | Done |

### `Sof-IA_FrontEnd/README.md`
| # | Issue | Status |
|---|-------|--------|
| F1 | "Rhode Mini Wireless" → "Rode Wireless Mini" | Done |

### `CLAUDE.md` (root)
| # | Issue | Status |
|---|-------|--------|
| K1 | Backend summary now lists Apertus + Qwen (generic loaders) and runtime catalogue download | Done |
| K2 | US21/US22/US23 added to completed stories; card stores + `queryBySessionAndBed` added to repository section; `IRepository<T>` corrected to `IRepository` | Done |

### `STORAGE_FACTORY.md`
Accurate against code — no changes needed. (Documents both factories correctly.)

---

## Still open

| # | Item | Why not fixed |
|---|------|---------------|
| D8 | `Sof-IA_Backend/PROJECT_PRESENTATION.md` sections 6, 7, 8 are empty | Needs team-authored content, not an audit fix |

> Status: **all mechanical doc fixes applied.** Only D8 remains, pending team content. No code was modified — documentation only.

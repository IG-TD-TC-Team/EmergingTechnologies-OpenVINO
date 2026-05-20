# Documentation Audit — Frontend Markdown

## Context

Audit of all frontend `.md` files (`CLAUDE.md` frontend section, `src/__tests__/README.md`, `src/repositories/USAGE.md`, `src/repositories/adapters/STORAGE_FACTORY.md`, `HOW_TO_USE_CAPABILITIES.md`) against the actual codebase state. Issues include phantom files, missing files, stale directory trees, outdated test structure, and broken doc examples.

---

## Link Audit

| Link | Location | Result |
|------|----------|--------|
| `https://www.figma.com/design/xatJv9J3dQWl258H1l4eWM/Sof-IA-HealthCare-assistant` | CLAUDE.md | 403 — auth required. URL format valid, not broken. |
| `https://dev.azure.com/Sof-IA/Front-End-React/_sprints/taskboard/...` | CLAUDE.md | 302 → Microsoft login. URL format valid, not broken. |
| `[IRepository Interface](../repositories/interfaces/IRepository.ts)` | `__tests__/README.md` | File exists ✓ |
| `[StorageFactory](../repositories/adapters/StorageFactory.ts)` | `__tests__/README.md` | File exists ✓ |
| `[SqliteAdapter](../repositories/adapters/sqlite/SqliteAdapter.ts)` | `__tests__/README.md` | File exists ✓ |
| `[DexieAdapter](../repositories/adapters/dexie/DexieAdapter.ts)` | `__tests__/README.md` | File exists ✓ |

No dead links. Both external links are auth-gated, not missing.

---

## CLAUDE.md — Frontend Section

| Task | Issue | Status |
|------|-------|--------|
| F1 | **BedDetailPresenter.js listed but doesn't exist** — Removed from presenters list. | Done |
| F2 | **RecordingModeScreen is a phantom** — Removed from navigation flow. | Done |
| F3 | **SettingsScreen completely undocumented** — Added to screens directory tree and navigation flow. | Done |
| F4 | **Screen component files missing from directory tree** — Added `AudioSourceBadge.js`, `MicButton.js`, `MicPermissionBanner.js`, `RecordingIndicator.js`. | Done |
| F5 | **Audio services directory severely incomplete** — Added 7 missing files: `ChunkUploadService.js`, `DeviceMicStrategy.js`, `OfflineQueueDb.js`, `OfflineQueueService.js`, `ServiceWorkerManager.js`, `ShiftCleanupService.js`, `WebRecorderService.js`. | Done |
| F6 | **Queue service directory incomplete** — Added `DexieQueueRepository.ts`, `IOfflineQueueRepository.ts`, `SQLiteQueueRepository.ts`, `index.ts`. | Done |
| F7 | **Top-level services missing from tree** — Added `ApiConfigService.js`, `ChunkUploadService.js`, `PermissionsService.js`. | Done |
| F8 | **Undocumented directories: tasks/ and types/** — Added both directories with their files. | Done |
| F9 | **hooks/ shows only one file** — Added `useQueueNotificationsImpl.tsx`. | Done |
| F10 | **PatientRepository.js undocumented** — Added to repositories tree. | Done |

---

## src/__tests__/README.md

| Task | Issue | Status |
|------|-------|--------|
| F11 | **Test structure tree is severely outdated** — Rewrote to reflect all 6 subdirectories and 30+ test files. | Done |
| F12 | **"Last Updated: 2026-03-30" is stale** — Removed footer block (Last Updated / Version / Maintainer). | Done |
| F13 | **Coverage table has TBD in every cell** — Removed the "Current" column entirely. | Done |

---

## src/repositories/USAGE.md

| Task | Issue | Status |
|------|-------|--------|
| F14 | **IRepository mock is incomplete** — Added `queryBySessionAndBed` and `findByField` to the mock object. | Done |

---

## src/repositories/interfaces/IRepository.ts (code issue)

| Task | Issue | Status |
|------|-------|--------|
| F15 | **findByField declared twice in IRepository** — Removed the shorter duplicate declaration; kept the fully documented one after `bulkDelete`. | Done |

---

## HOW_TO_USE_CAPABILITIES.md

| Task | Issue | Status |
|------|-------|--------|
| F16 | **Capability table omits iOS** — Merged Android/iOS into one column for boolean flags; added iOS column to string-value table. | Done |
| F17 | **window.__capabilities console check doesn't work** — Replaced with a correct import-based debug pattern. | Done |

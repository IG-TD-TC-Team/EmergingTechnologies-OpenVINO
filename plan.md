# Documentation Audit — Backend Markdown

## Context

Audit of all backend `.md` files (`README.md`, `TECHNICAL_BACKGROUND.md`, `PROJECT_PRESENTATION.md`, `OPENVINO_PRESENTATION.md`, `BENCHMARK_HOWTO.md`) against the actual codebase state revealed stale references, missing entries, raw developer notes, and empty sections. Tasks below are grouped by file.

---

## README.md

| Task | Issue | Status |
|------|-------|--------|
| D1 | **API Endpoints table incomplete** — missing 8 endpoints added since the table was written: `POST /api/chat`, `DELETE /api/chat`, `GET /api/chat/history`, `POST /api/transcription/file`, `POST /api/transcription/sample`, `GET /api/catalogue`, `POST /api/catalogue/download`, `POST /api/voice/transcribe-and-structure` | Done |
| D2 | **Composables list incomplete** — `web/static/composables/` section shows only 5 files; missing `logs.js`, `chat.js`, `catalogue.js`, `transcription.js` | Done |
| D3 | **`web/` structure missing `sessions.py`** — file exists (`web/sessions.py` — in-memory session store for Chat) but is not listed in the repository tree | Done |
| D4 | **OpenVINO version wrong** — "Technologies Used" says `OpenVINO 2024.x`; installed packages are `2026.1.0.0` | Done |
| D5 | **Repository root label wrong** — tree header shows `OpenVino/` but the actual directory is `Sof-IA_Backend/` | Won't fix — intentional |

---

## TECHNICAL_BACKGROUND.md

| Task | Issue | Status |
|------|-------|--------|
| D6 | **"Exploring the Side Quests" section framing is backwards** — the section declares Whisper and Phi-3 are "side quests not part of the core benchmark suite", but they are the core benchmarks. Apertus 8B was the experimental work. The section needs to be restructured to reflect what was actually the main project vs the experiment. | Done |
| D7 | **Raw developer notes left in document** — lines 239–241 contain unfinalised inline notes (`ADD Apertus openvino coversion --> ...` and `TODO:`) that were never removed or turned into proper content. Apertus OpenVINO export is now complete and benchmarked — these notes are stale and should be rewritten as a brief retrospective on the export challenge. | Done |

---

## PROJECT_PRESENTATION.md

| Task | Issue | Status |
|------|-------|--------|
| D8 | **Sections 6, 7, and 8 are empty** — "End-to-End Pipeline Implementation", "Demonstration Results", and "Conclusion" exist as headings with no body content. Either fill them or remove the headings. | Deferred — to discuss with team |
| D9 | **RTF missing from metrics list** — Section 3 "Metrics collected" lists latency, memory, WER but omits Real-Time Factor (RTF), which appears as a key result metric in Section 4 and throughout BENCHMARK_HOWTO.md. | Done |

---

## OPENVINO_PRESENTATION.md

No functional incoherences found. The document is self-contained theory and references, not coupled to the codebase state.

---

## BENCHMARK_HOWTO.md

No issues — updated 2026-05-18 to reflect the full web interface.

---

## Execution Order

Suggested order (D1–D5 are quick; D6–D9 require writing):

1. D5 — fix repo root label (one word)
2. D4 — fix OpenVINO version number
3. D3 — add `sessions.py` to web/ tree
4. D2 — add 4 missing composables to web/static/composables/ tree
5. D1 — add 8 missing API endpoints to table
6. D9 — add RTF to metrics list in PROJECT_PRESENTATION.md §3
7. D7 — remove/rewrite raw TODO notes in TECHNICAL_BACKGROUND.md
8. D6 — restructure "Side Quests" section framing
9. D8 — fill or remove empty sections 6/7/8 in PROJECT_PRESENTATION.md
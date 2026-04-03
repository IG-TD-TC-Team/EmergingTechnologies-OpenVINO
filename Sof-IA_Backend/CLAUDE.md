# CLAUDE.md — Project Context for Claude Code

## Project

**OpenVino** — Local AI inference pipeline benchmarking tool.
Stack: Python, Intel OpenVINO, PyTorch, FastAPI, Uvicorn.
Use case: compare model performance (latency, memory, accuracy) on CPU hardware
without cloud dependency.

## Repository Layout

```
config/
  models.yaml       ← model registry (class, env_var, model_path, type, max_new_tokens)

src/
  benchmark/
    protocols.py    ← ProgressChannel, ModelProvider, ResultStore, MemoryProvider protocols
    channels.py     ← PrintProgressChannel, QueueProgressChannel, NullProgressChannel
    base.py         ← BaseModel, SLMBase, ASRBase, StreamingSLMBase, StreamingASRBase ABCs
    factory.py      ← ModelFactory — reads class/env_var from YAML, lazy import
    runner.py       ← run_benchmark_sync/async + run_live_slm_async + run_live_asr_async
    metrics.py      ← latency/WER/memory helpers + streaming metrics (TTFT, ITL, chunk)
    repository.py   ← ResultRepository (save/list/get)
    report.py       ← markdown summary from result JSON

  slm/
    phi3_pytorch.py    ← Phi3PyTorch(StreamingSLMBase) — PyTorch CPU + run_streaming()
    phi3_openvino.py   ← Phi3OpenVINO(StreamingSLMBase) — OpenVINO INT8 + run_streaming()

  asr/
    base.py            ← ASRModel ABC + TranscriptionResult / TranscriptionSegment (scripting layer)
    whisper_pytorch.py ← WhisperPyTorch(ASRBase) — PyTorch CPU baseline
    whisper_openvino.py← WhisperOpenVINO(StreamingASRBase) — OpenVINO INT8 + transcribe_stream()
    languages.py       ← Whisper supported language codes

  pipeline/   ← End-to-end orchestration (not yet implemented)

scripts/
  run_benchmark.py      ← CLI: batch / live-slm / live-asr subcommands
  run_all_benchmarks.py ← CLI: all enabled models, standardized inputs, comparison table
  convert_whisper.py    ← Export Whisper → OpenVINO IR (INT8)
  convert_phi3.py       ← Export Phi-3 Mini → OpenVINO IR (INT8)
  setup_benchmark_data.py
  download_benchmark_audio.py

web/
  server.py         ← FastAPI controller — all endpoints, SSE, lifespan caches config+repo
  jobs.py           ← In-memory job store (PENDING → RUNNING → DONE/FAILED)
  middleware.py     ← RequestLoggingMiddleware + audit_event + hash_prompt
  static/
    index.html      ← HTML skeleton — mounts Vue app
    app.css         ← All styles
    api.js          ← Service layer (fetch / EventSource)
    app.js          ← Root assembly — wires composable stores
    composables/    ← models.js, benchmark.js, history.js, compare.js, chart.js

data/
  benchmark/        ← standardized prompt + audio + reference files
  prompts/          ← clinical_note_prompt.txt (SOAP format)

results/            ← benchmark JSON output (git-ignored content)
models/             ← converted OpenVINO models (git-ignored, large files)
logs/               ← app.json structured log output (git-ignored)
```

## Key Conventions

- Python 3.12 (required — Python 3.13+ breaks `optimum` model export)
- Use `optimum.intel.OVModelForCausalLM` for OpenVINO SLM inference
- Model paths configurable via `config/models.yaml` or env var override — nothing hardcoded
- Benchmark results go in `results/benchmark_<timestamp>.json`
- Web server: FastAPI app in `web/server.py`, served by Uvicorn (single-worker)
- Frontend: Vue 3 CDN (no npm, no build step)
- Long-running benchmark jobs: FastAPI BackgroundTasks + in-memory job store (`web/jobs.py`)
- Progress events: `ProgressChannel` protocol — `QueueProgressChannel` for SSE, `PrintProgressChannel` for CLI
- Adding a new model = add a YAML entry with `class:` field — zero Python changes in `factory.py`
- Do not auto-push or auto-commit without explicit user instruction
- `plan.md` is git-ignored (local planning doc)

## Models

| Model | Backend | Class | Streaming |
|-------|---------|-------|-----------|
| Phi-3 Mini 4k | PyTorch CPU | `Phi3PyTorch(StreamingSLMBase)` | `run_streaming()` via TextIteratorStreamer |
| Phi-3 Mini 4k | OpenVINO INT8 | `Phi3OpenVINO(StreamingSLMBase)` | `run_streaming()` via TextIteratorStreamer |
| Whisper Medium | PyTorch CPU | `WhisperPyTorch(ASRBase)` | batch only |
| Whisper Medium | OpenVINO INT8 | `WhisperOpenVINO(StreamingASRBase)` | `transcribe_stream()` 500ms windows |

## SOLID Architecture (SOLIDRefactor branch)

- **OCP**: `factory.py` reads `class` field from `models.yaml` — new models need zero Python changes
- **SRP**: `_run_benchmark()` template method lives on `SLMBase`/`ASRBase` — runner has no `isinstance` dispatch
- **LSP**: ASR constructors do not accept `max_new_tokens`; factory skips it when `type == "asr"`
- **ISP**: `ProgressChannel` protocol — runner only uses `send_progress/done/error`; streaming adds `send_token/chunk`
- **DIP**: runner accepts `model_provider`, `result_store`, `memory_provider` — defaults to concrete impls

## User Preferences

- Concise responses, no filler
- No auto-commit
- No emojis
- Confirm before risky or irreversible actions
- `plan.md` is the living task list for the current branch — update it as tasks progress
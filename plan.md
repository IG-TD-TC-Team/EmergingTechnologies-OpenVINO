# Model Manager — Web UI for downloading & converting models

**Story**: As a colleague, I want to add new AI models to the benchmark via the web interface so that I don't need to run Python scripts in the terminal.

**Sprint**: Post-sprint improvement
**Context**: Benchmark dashboard currently requires manual terminal work to add models. This adds a **Models** tab where colleagues see a curated catalogue, check what's already on disk, and one-click download + convert to OpenVINO with live progress.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Curated catalogue (not open HF search) | Colleagues only see known-good models; no risk of trying unsupported architectures |
| Reuse existing SSE job system | `jobs.py` + `QueueProgressChannel` already handle background tasks + SSE streaming |
| `main_export` for SLM INT8 | Same approach as `convert_phi3_int8.py`; stable and tested |
| `OVWeightQuantizationConfig(bits=4)` for INT4 | Pattern from `apertus_openvino.py`; required for >5B models |
| `GenericSLMOpenVINO` class for LLaMA/Qwen | No existing class for these architectures; one generic wrapper covers all standard causal LMs |
| Yaml key = `id.replace("-", "_")` | Consistent with existing naming (`phi3_openvino`, `whisper_openvino`) |

---

## Execution Order

| Step | File(s) | Change | Status |
|------|---------|--------|--------|
| T1 | `plan.md` | Reset to plan template | Done |
| T2a | `src/model_manager/__init__.py` | Empty package init | Done |
| T2b | `src/model_manager/catalogue.py` | 13-model curated list | Done |
| T2c | `src/model_manager/disk.py` | `get_model_status()` — checks disk for OV/PyTorch files | Done |
| T3a | `src/slm/generic_openvino.py` | `GenericSLMOpenVINO` — reusable causal LM class for LLaMA/Qwen | Done |
| T3b | `src/model_manager/downloader.py` | `download_and_convert()` — main_export (SLM) / OVModelForSpeechSeq2Seq (ASR) | Done |
| T3c | `src/model_manager/registry.py` | `add_model_to_yaml()` — inserts new entry in models.yaml | Done |
| T4 | `web/server.py` | `GET /api/catalogue` + `POST /api/catalogue/download` | Done |
| T5 | `web/static/api.js` | `fetchCatalogue()` + `startModelDownload()` | Done |
| T6 | `web/static/composables/catalogue.js` | `CatalogueStore` — fetch, startDownload, SSE stream handler | Done |
| T7 | `web/static/app.css` | `.model-card`, `.model-card.available`, `.model-card.downloading` pulse | Done |
| T8a | `web/static/index.html` | Models mode HTML: nav button + two-column catalogue layout | Done |
| T8b | `web/static/app.js` | Instantiate `CatalogueStore`, expose to template, mount init | Done |

---

## Catalogue — 13 models

| id | hub_id | type | size | compression options |
|----|--------|------|------|---------------------|
| whisper-tiny-ov | openai/whisper-tiny | asr | 0.15 GB | int8 |
| whisper-base-ov | openai/whisper-base | asr | 0.30 GB | int8 |
| whisper-small-ov | openai/whisper-small | asr | 0.60 GB | int8 |
| whisper-medium-ov *(on disk)* | openai/whisper-medium | asr | 1.50 GB | int8 |
| whisper-large-ov | openai/whisper-large-v2 | asr | 3.10 GB | int8 |
| phi3-mini-4k-int8 *(on disk)* | microsoft/Phi-3-mini-4k-instruct | slm | 2.1 GB | int8 |
| phi3-small-8k-int8 | microsoft/Phi-3-small-8k-instruct | slm | 4.1 GB | int8 |
| apertus-8b-int4 *(on disk)* | swiss-ai/Apertus-8B-Instruct-2509 | slm | 4.9 GB | int4 |
| llama-3.2-1b-int8 | meta-llama/Llama-3.2-1B-Instruct | slm | 0.7 GB | int8 |
| llama-3.2-3b-int8 | meta-llama/Llama-3.2-3B-Instruct | slm | 2.0 GB | int8 |
| qwen2.5-1.5b-int8 | Qwen/Qwen2.5-1.5B-Instruct | slm | 1.0 GB | int8 |
| qwen2.5-3b-int8 | Qwen/Qwen2.5-3B-Instruct | slm | 2.1 GB | int8 |
| qwen2.5-7b-int4 | Qwen/Qwen2.5-7B-Instruct | slm | 4.5 GB | int4, int8 |

---

## Key technical details

### Status detection (disk.py)
- `downloaded_ov` — `models/<id>/openvino_model.xml` exists
- `downloaded_pytorch` — `models/<id>/config.json` + at least one `*.safetensors` exists
- `available` — nothing on disk

### Conversion approach (downloader.py)
- **SLM INT8**: `main_export(hub_id, output=target_dir, task="text-generation-with-past")`
- **SLM INT4**: `OVModelForCausalLM.from_pretrained(hub_id, export=True, quantization_config=OVWeightQuantizationConfig(bits=4, sym=True, ratio=1.0, group_size=-1))`
- **ASR**: `OVModelForSpeechSeq2Seq.from_pretrained(hub_id, export=True)` + save `AutoProcessor`
- Progress reported via `channel.send_progress(msg)` at each step

### Registry (registry.py)
- Reads `config/models.yaml`, appends new entry, writes back
- Yaml key = `catalogue_id.replace("-", "_")`
- Entry mirrors existing schema (type, class, label, model_path, hub_id, enabled, max_new_tokens, chat_format)

### SSE reuse
- `POST /api/catalogue/download` returns `{job_id}`
- Frontend subscribes to existing `GET /api/benchmark/{job_id}/stream`
- No new SSE endpoint needed

### New model class (generic_openvino.py)
- Mirrors `Phi3OpenVINO` exactly but with no hardcoded hub_id default
- Used for: llama-3.2-1b, llama-3.2-3b, qwen2.5-*
- `chat_format` from yaml config passed at runtime (not in class — handled by server.py formatter)

---

## Verification

1. `uvicorn web.server:app --reload --port 8000`
2. Open `http://localhost:8000` → click **Models** tab
3. Whisper medium, Phi-3, Apertus show white (active); others grey (available)
4. Click "Download & Convert" on `whisper-tiny-ov` → live log appears in left panel
5. On completion: card turns white, model appears in Benchmark dropdown
6. `GET /api/catalogue` → all 13 entries with correct `status` field

---

## Out of Scope

- Open HuggingFace search (free-text query)
- Model deletion from UI
- Editing existing models.yaml entries via UI
- Special-case architectures (Apertus, Voxtral) — those already have their own scripts
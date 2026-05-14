"""Curated list of known-good models available for download and OpenVINO conversion.

Each entry is a plain dict consumed by the /api/catalogue endpoint and by
the downloader.  Add new entries here when a model has been tested and verified
to convert correctly.

Fields
------
id                  Stable key — becomes the local folder name under models/.
label               Human-readable display name shown in the web UI.
hub_id              HuggingFace Hub repository ID.
type                "asr" or "slm".
model_class         Dotted class path used in models.yaml after registration.
size_gb             Approximate total size on disk after conversion (GB).
default_compression Default quantization format: "int8" or "int4".
compression_options List of supported options the user can choose from.
max_new_tokens      Maximum generation tokens (None for ASR).
chat_format         Chat template key ("phi3", "llama3", or None for ASR).
notes               One-line description shown in the UI card.
"""

CATALOGUE: list[dict] = [
    # ------------------------------------------------------------------
    # ASR — Whisper family (OpenAI)
    # ------------------------------------------------------------------
    {
        "id": "whisper-tiny-ov",
        "label": "Whisper Tiny — OpenVINO INT8",
        "hub_id": "openai/whisper-tiny",
        "type": "asr",
        "model_class": "src.asr.whisper_openvino.WhisperOpenVINO",
        "size_gb": 0.15,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": None,
        "chat_format": None,
        "notes": "Fastest Whisper variant — lowest accuracy",
    },
    {
        "id": "whisper-base-ov",
        "label": "Whisper Base — OpenVINO INT8",
        "hub_id": "openai/whisper-base",
        "type": "asr",
        "model_class": "src.asr.whisper_openvino.WhisperOpenVINO",
        "size_gb": 0.30,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": None,
        "chat_format": None,
        "notes": "Good balance of speed and accuracy for short audio",
    },
    {
        "id": "whisper-small-ov",
        "label": "Whisper Small — OpenVINO INT8",
        "hub_id": "openai/whisper-small",
        "type": "asr",
        "model_class": "src.asr.whisper_openvino.WhisperOpenVINO",
        "size_gb": 0.60,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": None,
        "chat_format": None,
        "notes": "Recommended for French clinical audio",
    },
    {
        "id": "whisper-medium-ov",
        "label": "Whisper Medium — OpenVINO INT8",
        "hub_id": "openai/whisper-medium",
        "type": "asr",
        "model_class": "src.asr.whisper_openvino.WhisperOpenVINO",
        "size_gb": 1.50,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": None,
        "chat_format": None,
        "notes": "Current production model — already on disk",
    },
    {
        "id": "whisper-large-ov",
        "label": "Whisper Large v2 — OpenVINO INT8",
        "hub_id": "openai/whisper-large-v2",
        "type": "asr",
        "model_class": "src.asr.whisper_openvino.WhisperOpenVINO",
        "size_gb": 3.10,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": None,
        "chat_format": None,
        "notes": "Highest accuracy — requires ~6 GB RAM",
    },
    # ------------------------------------------------------------------
    # SLM — Phi-3 family (Microsoft)
    # ------------------------------------------------------------------
    {
        "id": "phi3-mini-4k-int8",
        "label": "Phi-3 Mini 4k — OpenVINO INT8",
        "hub_id": "microsoft/Phi-3-mini-4k-instruct",
        "type": "slm",
        "model_class": "src.slm.phi3_openvino.Phi3OpenVINO",
        "size_gb": 2.1,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 256,
        "chat_format": "phi3",
        "notes": "Fast 3.8B model — already on disk",
    },
    {
        "id": "phi3-small-8k-int8",
        "label": "Phi-3 Small 8k — OpenVINO INT8",
        "hub_id": "microsoft/Phi-3-small-8k-instruct",
        "type": "slm",
        "model_class": "src.slm.phi3_openvino.Phi3OpenVINO",
        "size_gb": 4.1,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 256,
        "chat_format": "phi3",
        "notes": "7B model with 8k context",
    },
    # ------------------------------------------------------------------
    # SLM — Apertus (Swiss AI)
    # ------------------------------------------------------------------
    {
        "id": "apertus-8b-int4",
        "label": "Apertus 8B — OpenVINO INT4",
        "hub_id": "swiss-ai/Apertus-8B-Instruct-2509",
        "type": "slm",
        "model_class": "src.slm.apertus_openvino.ApertusOpenVINO",
        "size_gb": 4.9,
        "default_compression": "int4",
        "compression_options": ["int4"],
        "max_new_tokens": 512,
        "chat_format": "llama3",
        "notes": "French-optimised 8B model — already on disk",
    },
    # ------------------------------------------------------------------
    # SLM — LLaMA 3.2 (Meta)
    # ------------------------------------------------------------------
    {
        "id": "llama-3.2-1b-int8",
        "label": "LLaMA 3.2 1B — OpenVINO INT8",
        "hub_id": "meta-llama/Llama-3.2-1B-Instruct",
        "type": "slm",
        "model_class": "src.slm.generic_openvino.GenericSLMOpenVINO",
        "size_gb": 0.7,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 512,
        "chat_format": "llama3",
        "notes": "Lightest LLaMA — good for low-RAM machines",
    },
    {
        "id": "llama-3.2-3b-int8",
        "label": "LLaMA 3.2 3B — OpenVINO INT8",
        "hub_id": "meta-llama/Llama-3.2-3B-Instruct",
        "type": "slm",
        "model_class": "src.slm.generic_openvino.GenericSLMOpenVINO",
        "size_gb": 2.0,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 512,
        "chat_format": "llama3",
        "notes": "Balanced LLaMA variant",
    },
    # ------------------------------------------------------------------
    # SLM — Qwen 2.5 (Alibaba)
    # ------------------------------------------------------------------
    {
        "id": "qwen2.5-1.5b-int8",
        "label": "Qwen 2.5 1.5B — OpenVINO INT8",
        "hub_id": "Qwen/Qwen2.5-1.5B-Instruct",
        "type": "slm",
        "model_class": "src.slm.generic_openvino.GenericSLMOpenVINO",
        "size_gb": 1.0,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 512,
        "chat_format": "llama3",
        "notes": "Very small and fast multilingual model",
    },
    {
        "id": "qwen2.5-3b-int8",
        "label": "Qwen 2.5 3B — OpenVINO INT8",
        "hub_id": "Qwen/Qwen2.5-3B-Instruct",
        "type": "slm",
        "model_class": "src.slm.generic_openvino.GenericSLMOpenVINO",
        "size_gb": 2.1,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 512,
        "chat_format": "llama3",
        "notes": "Multilingual 3B — strong French capability",
    },
    {
        "id": "qwen2.5-7b-int4",
        "label": "Qwen 2.5 7B — OpenVINO INT4",
        "hub_id": "Qwen/Qwen2.5-7B-Instruct",
        "type": "slm",
        "model_class": "src.slm.generic_openvino.GenericSLMOpenVINO",
        "size_gb": 4.5,
        "default_compression": "int4",
        "compression_options": ["int4", "int8"],
        "max_new_tokens": 512,
        "chat_format": "llama3",
        "notes": "Multilingual 7B — best quality in this family",
    },
    # ------------------------------------------------------------------
    # SLM — MedGemma (Google)
    # ------------------------------------------------------------------
    {
        "id": "medgemma-4b-it",
        "label": "MedGemma 1.5 4B — OpenVINO INT8",
        "hub_id": "google/medgemma-1.5-4b-it",
        "type": "slm",
        "model_class": "src.slm.generic_openvino.GenericSLMOpenVINO",
        "size_gb": 2.3,
        "default_compression": "int8",
        "compression_options": ["int8"],
        "max_new_tokens": 512,
        "chat_format": "gemma",
        "notes": "Google medical AI (Gemma 3 4B). Gated — paste HF token above. INT4 unsupported by current OpenVINO build.",
    },
]

# Quick lookup by id
CATALOGUE_BY_ID: dict[str, dict] = {entry["id"]: entry for entry in CATALOGUE}
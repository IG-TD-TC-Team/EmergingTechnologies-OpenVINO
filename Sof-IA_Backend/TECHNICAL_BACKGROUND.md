# Technical Background

This document covers the theoretical foundations behind the project — useful for understanding why each design decision was made. Familiarity with these concepts is not required to run the benchmarks, but it helps interpret the results.

---

## Transformer Architecture

A **transformer** is a neural network architecture based entirely on attention mechanisms (no recurrence, no convolution). It was introduced in "Attention Is All You Need" (Vaswani et al., 2017) and has become the dominant architecture for language, speech, and vision tasks.

The models in this project are **decoder-only transformers** (GPT-style). They consist of a stack of identical layers, each containing:

1. **Multi-Head Self-Attention (MHSA)** — every token attends to every previous token
2. **Feed-Forward Network (FFN / MLP)** — a position-wise two-layer network applied to each token independently
3. **Layer Normalization + Residual connections** — stabilise training and allow deep stacks

```
Input tokens
    └─> Embedding layer  (token IDs → dense vectors)
            └─> Layer 1
            │       ├─> Self-Attention
            │       └─> FFN
            └─> Layer 2 ... Layer N
                    └─> LM Head  (hidden states → vocabulary logits)
                            └─> Softmax → next-token probability
```

The **LM head** is a linear projection to the vocabulary size (e.g. 32 000 tokens). The token with the highest logit (or a sample from the distribution) becomes the next generated token.

---

## Attention Mechanism (Q, K, V)

The attention operation transforms each token into three vectors:

- **Query (Q)** — "what am I looking for?"
- **Key (K)** — "what do I contain?"
- **Value (V)** — "what do I output if selected?"

The output for each query position is a weighted sum of all value vectors, where the weights come from the dot-product similarity between that query and all keys:

```
Attention(Q, K, V) = softmax(Q·Kᵀ / √d_k) · V
```

**Causal masking** ensures each token can only attend to tokens at or before its own position, preventing the model from "seeing the future" during generation.

**Multi-Head Attention (MHA)** runs this operation in parallel across `n_heads` heads, each learning different relationship patterns, then concatenates the results.

**Grouped Query Attention (GQA)** — used by Mistral and Apertus — reduces the number of Key/Value heads (`n_kv_heads`) while keeping more Query heads. This cuts KV memory and computation without degrading quality. Apertus 8B uses 32 query heads and 8 KV heads (4:1 ratio).

---

## Autoregressive Generation (Prefill and Decode)

Language model inference has two distinct phases:

**Prefill** — process the entire input prompt in a single forward pass. All tokens are processed in parallel. The output is the logit distribution for the next token.

**Decode** — generate one new token per step. Each step feeds the new token back into the model, extending the sequence by one. This is inherently sequential.

```
Prefill:  [T1 T2 T3 ... Tn]  →  one forward pass  →  logits for T(n+1)
Decode:   [T1 ... Tn T(n+1)] →  one forward pass  →  logits for T(n+2)
          [T1 ... Tn T(n+1) T(n+2)] →  ...
```

The **total inference cost** without optimisation is O(n²) in sequence length — each decode step reprocesses all previous tokens.

---

## KV Cache

The Key and Value matrices for all previous tokens do not change between decode steps. **KV cache** stores them after the prefill step so subsequent decode steps only compute Q, K, V for the one new token and read the rest from cache.

| | Without KV cache | With KV cache |
|---|---|---|
| Tokens processed at step N | all N tokens (growing) | 1 new token only |
| Total compute | O(seq²) — quadratic | O(seq) — linear |
| 512 tokens on 195-tok prompt | ~4 h on CPU 8B | ~5 min on CPU 8B |

KV cache is a **stateful** operation — the cache persists across the decode loop as a side-channel. This means the exported model IR must include explicit `past_key_values` input and output tensors so the runtime can pass the cache between decode steps.

When exporting via `ov.convert_model` on a plain `nn.Module`, these extra I/O slots are absent. `OVModelForCausalLM` then falls back to `use_cache=False`, which is correct but roughly 350× slower for long outputs.

---

## Model Compression

**Quantisation** represents weights and activations in lower-precision formats to reduce memory footprint and speed up inference on integer-optimised hardware.

| Format | Bits | Memory vs FP32 | Notes |
|--------|------|-----------------|-------|
| FP32 | 32 | 1× (baseline) | Training default |
| BF16 | 16 | 0.5× | HF default for inference; preserves FP32 exponent range |
| INT8 | 8 | 0.25× | Good quality/speed tradeoff on CPU |
| INT4 | 4 | 0.125× | 8B model fits in ~12 GB RAM; minor quality loss |

**Weight-only quantisation** (used here) quantises only the model weights, keeping activations in FP32/BF16 at runtime. No calibration dataset needed — quantisation is deterministic from the weights alone.

**Per-channel quantisation** assigns one scale factor per output channel of a weight matrix, more accurate than per-tensor (one scale for the entire matrix).

**Symmetric (sym)** quantisation centres the range at zero: `[-127, 127]` for INT8, `[-7, 7]` for INT4.

**NNCF (Neural Network Compression Framework)** — Intel's open-source library for quantisation, pruning, and sparsity. Used here via `nncf.compress_weights(INT4_SYM)` on an already-converted OV model.

---

## Whisper & Automatic Speech Recognition (ASR)

**Whisper** is an encoder-decoder transformer architecture developed by OpenAI for automatic speech recognition (ASR) and speech translation. Unlike decoder-only language models, Whisper uses a full sequence-to-sequence architecture designed specifically for audio input.

### Architecture Overview

```
Audio waveform
    └─> Log-Mel spectrogram  (80 frequency bins × time steps)
            └─> Encoder  (transformer blocks with self-attention)
            │       └─> Encoded audio representation
            └─> Decoder  (transformer blocks with cross-attention)
                    └─> Text tokens (autoregressive generation)
```

**Key components:**

1. **Encoder** — processes the entire audio input in parallel, converting log-mel spectrograms into dense representations
2. **Decoder** — autoregressive transformer that attends to encoder outputs via cross-attention while generating text tokens
3. **Multi-task training** — trained on transcription, translation, language detection, and timestamp prediction simultaneously

### Model Variants

| Model | Parameters | Memory (INT8) | Use Case |
|-------|-----------|---------------|----------|
| tiny | ~39M | ~150 MB | Fast testing, real-time on low-end CPU |
| base | ~74M | ~300 MB | Good speed/accuracy balance |
| small | ~244M | ~1 GB | Acceptable for most languages |
| medium | ~769M | ~3 GB | **Recommended** — best balance |
| large-v3 | ~1.5B | ~6 GB | Highest accuracy, research use |

### OpenVINO Implementation

The project uses **`optimum-intel`** to export Whisper models from HuggingFace to OpenVINO IR format with INT8 quantization:

```python
# Conversion via OVModelForSpeechSeq2Seq
model = OVModelForSpeechSeq2Seq.from_pretrained(
    "openai/whisper-medium",
    export=True,      # Convert to OV IR
    compile=False     # Defer compilation to runtime
)
```

**Why OpenVINO for ASR:**
- INT8 quantization reduces memory by 4× with minimal WER degradation (<1%)
- 2-3× faster inference on CPU vs PyTorch FP32
- Encoder can be cached between decoder steps (similar to KV cache)

### Language Support

Whisper supports **99 languages** with automatic language detection. The model was trained on 680,000 hours of multilingual web audio, making it robust to accents, background noise, and technical vocabulary.

### ASR Metrics

| Metric | Definition | Target |
|--------|-----------|--------|
| **WER (%)** | Word Error Rate = `(subs + dels + ins) / ref_words` | Lower is better; <5% is excellent |
| **RTF** | Real-Time Factor = `transcription_time / audio_duration` | <1.0 = faster than real-time |

**Example:** Transcribing a 30-second audio clip in 15 seconds → RTF = 0.5 (2× faster than real-time).

---

## Phi-3 & Small Language Models (SLM)

**Phi-3 Mini** is a **Small Language Model (SLM)** — a 3.8B-parameter decoder-only transformer designed to deliver strong reasoning and language understanding in a compact, CPU-friendly form factor.

### What Makes an SLM "Small"?

Unlike large language models (7B-70B+ parameters), SLMs prioritize:

1. **Efficiency** — fit in consumer RAM (4-8 GB vs 28-140 GB)
2. **Speed** — usable latency on CPU without GPU acceleration
3. **Quality training data** — smaller models require higher data quality; Phi-3 was trained on "textbook-quality" synthetic and curated data

**Phi-3 Mini 4k Instruct** refers to:
- **Mini** — 3.8B parameters
- **4k** — 4096 token context window
- **Instruct** — fine-tuned for instruction-following and chat

### Architecture

Phi-3 uses the same decoder-only transformer architecture as GPT/Mistral/Apertus:

- **32 layers** (vs 28 for Mistral 7B, 32 for Apertus 8B)
- **32 attention heads** with Grouped Query Attention (GQA)
- **3072 hidden dimensions**
- **Rotary Position Embeddings (RoPE)** — same positional encoding as Apertus

The model architecture is nearly identical to larger models — the "small" designation comes from parameter count, not architectural simplifications.

### OpenVINO Implementation

Phi-3 is converted using the same `optimum-intel` pipeline as other causal language models:

```python
# Export via OVModelForCausalLM
model = OVModelForCausalLM.from_pretrained(
    "microsoft/Phi-3-mini-4k-instruct",
    export=True,          # Convert to OV IR
    ov_config={...}       # Thread and memory config
)
```

**Quantization impact:**

| Format | Memory (Peak Load) | Speedup vs PyTorch FP32 | Quality |
|--------|-------------------|------------------------|---------|
| **PyTorch FP32** | ~15 GB | 1× (baseline) | Reference |
| **OpenVINO INT8** | ~4 GB | 3-4× faster | Negligible loss |

The INT8 quantization makes Phi-3 practical for CPU-only inference on machines with 8-16 GB RAM.

### Why Phi-3 in This Project?

Including Phi-3 alongside 7-8B models serves two purposes:

1. **Benchmark diversity** — validate that the OpenVINO pipeline works across model sizes (3.8B to 8B)
2. **Practical use case** — demonstrate a CPU-viable chat model for local-first applications without requiring high-end hardware

**Performance expectations:**
- Prefill (TTFT): 50-200ms for short prompts on modern CPU
- Decode (ITL): 100-300ms/token on 4-8 core CPU
- Typical use: Short Q&A, code snippets, summarization (not long-form generation)

---

## Exploring the Side Quests

**ADD Apertus openvino coversion** --> no known transformation guide for Apertus 8B yet, but the torch.export + KV wrapper approach should work in theory. This is a future experiment to validate the generality of the export pipeline on an unknown architecture.
TODO: 
While the main focus of this project is benchmarking and implementing a clinical voice-to-text pipeline on CPU, the Whisper and Phi-3 implementations serve as **side quests** — additional experiments demonstrating the versatility of the OpenVINO pipeline across different model architectures.

These are **not part of the core benchmark suite** but are fully functional implementations you can explore independently.

### Quick Start: Whisper ASR

**1. Convert a Whisper model to OpenVINO:**

```bash
# Recommended: medium model (good accuracy/speed balance)
python scripts/convert_whisper.py --model medium --output models/whisper-medium-ov

# Or for faster testing: tiny model
python scripts/convert_whisper.py --model tiny --output models/whisper-tiny-ov
```

**2. Transcribe a local audio file:**

```bash
python scripts/transcribe_local.py \
    --audio test.wav \
    --backend openvino \
    --model models/whisper-medium-ov
```

**3. Try live transcription from microphone:**

```bash
python scripts/transcribe_live.py \
    --backend openvino \
    --model models/whisper-medium-ov
```

**4. Compare PyTorch vs OpenVINO performance:**

```bash
python scripts/compare_models.py \
    --models "openvino:models/whisper-tiny-ov" "pytorch:tiny" \
    --source local \
    --audio test.wav
```

### Quick Start: Phi-3 SLM

**1. Convert Phi-3 to OpenVINO INT8:**

```bash
python scripts/convert_phi3_int8.py
```

This downloads `microsoft/Phi-3-mini-4k-instruct`, exports to OpenVINO IR, and saves to `models/phi3-mini-ov`.

**2. Run inference with Phi-3:**

```bash
python scripts/run_phi3.py
```

---

## OpenVINO Export Pipeline

OpenVINO uses its own **Intermediate Representation (IR)** format — an XML graph description + a binary weight file (`.xml` + `.bin`). The conversion pipeline has several paths:

```
PyTorch nn.Module
    │
    ├── Path A: optimum-intel  (recommended — Phi-3, Whisper)
    │       └─> OVModelForCausalLM.from_pretrained(export=True)
    │               └─> ONNX exporter → OV IR with KV-cache I/O + INT8 via NNCF
    │
    ├── Path B: torch.export (FX) + KV-cache wrapper  (Apertus 8B — unknown architecture)
    │       └─> _KVWrapper(model) — accepts tuple-of-tuples KV, returns updated tuple-of-tuples
    │               └─> torch.export.export (strict=False, Dim.AUTO)
    │                       └─> FX graph normalisation (negative cat dims → positive)
    │                               └─> ov.convert_model() → OV IR (64 KV inputs/outputs)
    │                                       └─> OV reshape (static n_kv_heads/head_dim)
    │                                               └─> nncf.compress_weights() → INT4
    │
    └── Path C: torch.jit.trace  (legacy fallback — fails on torch.vmap)
            └─> TorchScript graph → ov.convert_model() → OV IR
```

Key concepts:

- **FX graph** — PyTorch's functional graph representation. `torch.export.export` produces a complete, flat graph without Python control flow, which OV can convert reliably.
- **Dynamic shapes** — without them, every tensor dimension is baked as a literal constant. Inference on any other shape fails. `torch.export.Dim.AUTO` lets the exporter infer valid dynamic ranges from the model code.
- **0-D scalar tensors** — OV's FX decoder indexes numpy arrays with `[0]` to read scalar values; this fails on `ndim=0` arrays. Affected parameters and buffers must be reshaped to `(1,)` before export.

---

## Benchmark Metrics Glossary

| Metric | Definition | Notes |
|--------|-----------|-------|
| **Latency (ms)** | Wall-clock time for one complete inference | Mean over N timed runs after warm-up |
| **ms/token** | Latency ÷ tokens generated | Normalised throughput for SLM comparison |
| **TTFT (ms)** | Time to first token | Prefill latency — user-perceived responsiveness |
| **ITL (ms)** | Inter-token latency | Decode latency per step — perceived "speed" during generation |
| **Load memory (MB)** | RSS delta during `model.load()` | Weight buffer allocation; OpenVINO pre-allocates at load time |
| **Inference memory (MB)** | RSS delta during `model.run()` | Near zero for OpenVINO (weights already loaded) |
| **WER (%)** | Word Error Rate = `(substitutions + deletions + insertions) / reference_words` | ASR accuracy; lower is better |
| **RTF** | Real-Time Factor = transcription latency / audio duration | < 1.0 means faster than real-time |

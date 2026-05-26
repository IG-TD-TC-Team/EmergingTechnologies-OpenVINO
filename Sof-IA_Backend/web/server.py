"""
FastAPI controller — all API endpoints and SSE stream.

Start with:
    uvicorn web.server:app --reload --port 8000
"""

import builtins as _builtins
import sys as _sys

# Windows default text encoding is cp1252/latin-1; HuggingFace model files use
# UTF-8 (tokenizer configs often contain characters like em-dash —).
# Override open() to default to UTF-8 for all text-mode I/O so that optimum /
# transformers save_pretrained() calls don't crash on non-ASCII content.
if _sys.platform == 'win32':
    _real_open = _builtins.open

    def _open_utf8(file, mode='r', buffering=-1, encoding=None, errors=None,
                   newline=None, closefd=True, opener=None):
        if 'b' not in str(mode) and encoding is None:
            encoding = 'utf-8'
        return _real_open(file, mode, buffering, encoding=encoding,
                          errors=errors, newline=newline,
                          closefd=closefd, opener=opener)

    _builtins.open = _open_utf8

import asyncio
import json
import logging
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel as PydanticModel

import web.jobs as jobs
import web.sessions as sessions
from src.benchmark.channels import NullProgressChannel, QueueProgressChannel
from src.benchmark.factory import ModelFactory
from src.benchmark.repository import ResultRepository
from src.benchmark.runner import run_benchmark_async, run_live_slm_async, run_live_asr_async
from src.logging_config import setup_logging
from src.model_manager.catalogue import CATALOGUE, CATALOGUE_BY_ID
from src.model_manager.disk import get_model_status, get_pytorch_status
from src.model_manager.downloader import download_and_convert, download_pytorch
from src.model_manager.registry import add_model_to_yaml, add_pytorch_to_yaml
from src.pipeline.transcribe_and_structure import run_transcribe_and_structure
from web.middleware import RequestLoggingMiddleware, audit_event, hash_prompt

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
_LOGS_DIR    = Path(__file__).resolve().parents[1] / "logs"

logger = logging.getLogger(__name__)


def _load_yaml_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    cfg = _load_yaml_config()
    app.state.config = cfg
    app.state.repo = ResultRepository()

    # Pre-load voice pipeline models so the endpoint has zero cold-start latency
    vp = cfg.get("voice_pipeline", {})
    asr = ModelFactory.create(vp.get("asr_model", "whisper_openvino"))
    slm = ModelFactory.create(vp.get("slm_model", "phi3_openvino"))
    logger.info("server_startup loading voice ASR model=%s", asr.model_id)
    asr.load()
    logger.info("server_startup loading voice SLM model=%s", slm.model_id)
    slm.load()
    app.state.voice_asr = asr
    app.state.voice_slm = slm

    # ASR model cache for the transcription tab — models stay loaded between requests.
    # Seed the cache with the already-loaded voice ASR so the first transcription
    # request against that model_id pays zero load cost.
    asr_model_id = vp.get("asr_model", "whisper_openvino")
    app.state.asr_cache = {asr_model_id: asr}

    prompt_rel = vp.get("extraction_prompt_file", "data/prompts/structured_extraction_prompt.txt")
    prompt_path = _CONFIG_PATH.parents[1] / prompt_rel
    app.state.voice_extraction_prompt = prompt_path.read_text(encoding="utf-8")
    logger.info("server_startup complete")

    yield
    logger.info("server_shutdown")


app = FastAPI(title="OpenVino Benchmark Dashboard", lifespan=lifespan)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

_STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------

class BenchmarkRequest(PydanticModel):
    model_id: str
    input_data: str          # prompt text or audio path
    warmup_runs: int = 3
    timed_runs: int = 10
    reference_transcript: str = ""


class LiveSLMRequest(PydanticModel):
    model_id: str
    prompt: str
    save: bool = True


class LiveASRRequest(PydanticModel):
    model_id: str
    audio_path: str
    chunk_ms: int = 500
    save: bool = True


class TranscriptionSampleRequest(PydanticModel):
    model_id: str
    audio_path: str


class ChatRequest(PydanticModel):
    model_id: str
    message: str
    system_prompt: str = "You are a helpful clinical AI assistant."


# ---------------------------------------------------------------------------
# Routes — frontend
# ---------------------------------------------------------------------------

@app.get("/", response_class=FileResponse)
def serve_index():
    return FileResponse(str(_STATIC_DIR / "index.html"))


# ---------------------------------------------------------------------------
# Routes — config
# ---------------------------------------------------------------------------

def _is_model_ready(model_cfg: dict, repo_root: Path) -> bool:
    """Return True if the model's required files are present on disk.

    Models whose ``model_path`` is a HuggingFace Hub ID (not a local
    ``models/…`` path) are always considered ready — they download on demand.

    Local paths are checked for their type-specific marker file:
    - OpenVINO SLM     → ``openvino_model.xml``
    - OpenVINO ASR     → ``openvino_encoder_model.xml``
    - PyTorch (local)  → ``config.json``
    """
    model_path_str = model_cfg.get("model_path", "")
    # Hub IDs look like "openai/whisper-medium" — no leading "models/" segment
    if not model_path_str.startswith("models/"):
        return True  # downloads on-demand from Hub

    model_path = repo_root / model_path_str
    if not model_path.exists():
        return False

    model_class = model_cfg.get("class", "")
    model_type  = model_cfg.get("type", "")

    if model_type == "asr" and "openvino" in model_class.lower():
        return (model_path / "openvino_encoder_model.xml").exists()
    if "openvino" in model_class.lower():
        return (model_path / "openvino_model.xml").exists()
    # PyTorch local paths — presence of config.json is sufficient
    return (model_path / "config.json").exists()


@app.get("/api/models")
def list_models():
    """Return all models from config with their type, label, enabled and ready state.

    ``ready`` is ``true`` only when the model's files are actually present on
    disk (or the model_path is a HuggingFace Hub ID that downloads on demand).
    Reads fresh from disk so newly downloaded models appear without a restart.
    """
    cfg = _load_yaml_config()
    repo_root = _CONFIG_PATH.parent.parent
    models = [
        {
            "id": mid,
            "label": mcfg.get("label", mid),
            "type": mcfg.get("type", "unknown"),
            "enabled": mcfg.get("enabled", True),
            "ready": _is_model_ready(mcfg, repo_root),
        }
        for mid, mcfg in cfg.get("models", {}).items()
    ]
    return JSONResponse(models)


@app.get("/api/benchmark/inputs")
def get_standard_inputs(request: Request):
    """Return standard benchmark inputs so the frontend can auto-fill them."""
    cfg = request.app.state.config
    bench = cfg.get("benchmark", {})
    root = _CONFIG_PATH.parents[0].parent  # repo root

    prompt_file = root / bench.get("slm_prompt_file", "")
    ref_file    = root / bench.get("asr_reference_file", "")
    audio_path  = bench.get("asr_audio_file", "")

    slm_prompt    = prompt_file.read_text(encoding="utf-8").strip() if prompt_file.exists() else ""
    asr_reference = ref_file.read_text(encoding="utf-8").strip() if ref_file.exists() else ""

    return JSONResponse({
        "slm_prompt": slm_prompt,
        "asr_audio_path": str(audio_path),
        "asr_reference": asr_reference,
    })


@app.get("/api/audio/samples")
def list_audio_samples():
    """Return all samples from every manifest.json under data/benchmark/."""
    root = _CONFIG_PATH.parents[0].parent
    bench_dir = root / "data" / "benchmark"
    all_samples = []
    for manifest in sorted(bench_dir.glob("*/manifest.json")):
        try:
            samples = json.loads(manifest.read_text(encoding="utf-8"))
            all_samples.extend(samples)
        except Exception:
            logger.warning("Failed to read manifest %s", manifest, exc_info=True)
    return JSONResponse(all_samples)


@app.get("/api/audio")
def serve_audio(path: str):
    """Serve an audio file from within the project directory."""
    root = _CONFIG_PATH.parents[0].parent
    audio_path = (root / path).resolve()
    # Prevent path traversal outside the project
    if not str(audio_path).startswith(str(root.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(str(audio_path), media_type="audio/wav")


# ---------------------------------------------------------------------------
# Routes — results
# ---------------------------------------------------------------------------

@app.get("/api/results")
def list_results(request: Request):
    return JSONResponse(request.app.state.repo.list())


@app.get("/api/results/{result_id}")
def get_result(result_id: str, request: Request):
    client_ip = request.client.host if request.client else "-"
    try:
        data = request.app.state.repo.get(result_id)
        audit_event("result_accessed", client_ip, result_id=result_id)
        return JSONResponse(data)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Result '{result_id}' not found")


# ---------------------------------------------------------------------------
# Routes — benchmark jobs
# ---------------------------------------------------------------------------

@app.post("/api/benchmark/start")
async def start_benchmark(req: BenchmarkRequest, background_tasks: BackgroundTasks, request: Request):
    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)

    cfg = request.app.state.config
    model_type = cfg.get("models", {}).get(req.model_id, {}).get("type", "")
    prompt_hash = hash_prompt(req.input_data) if model_type == "slm" else None
    audit_event(
        "benchmark_started",
        client_ip,
        job_id=job_id,
        model_id=req.model_id,
        prompt_hash=prompt_hash,
    )

    loop = asyncio.get_running_loop()

    async def _run():
        jobs.set_running(job_id)
        channel = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            result = await run_benchmark_async(
                model_id=req.model_id,
                input_data=req.input_data,
                warmup_runs=req.warmup_runs,
                timed_runs=req.timed_runs,
                reference_transcript=req.reference_transcript or None,
                channel=channel,
                save=True,
                job_id=job_id,
            )
            jobs.set_done(job_id, result)
        except Exception as exc:
            logger.exception("benchmark_failed model_id=%s", req.model_id,
                             extra={"job_id": job_id})
            jobs.set_failed(job_id, str(exc))
            audit_event("benchmark_failed", client_ip, job_id=job_id,
                        model_id=req.model_id, error=str(exc))
            channel.send_error(str(exc))

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


@app.get("/api/benchmark/{job_id}")
def poll_job(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return JSONResponse({
        "id": job["id"],
        "status": job["status"],
        "result": job["result"],
        "error": job["error"],
    })


@app.get("/api/benchmark/{job_id}/stream")
async def stream_job(job_id: str):
    """SSE endpoint — streams progress events from the job's asyncio.Queue."""
    queue = jobs.get_queue(job_id)
    if queue is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    async def _event_generator():
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                yield "event: heartbeat\ndata: {}\n\n"
                continue

            data = json.dumps(event)
            yield f"data: {data}\n\n"

            if event.get("type") in ("done", "error"):
                break

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Routes — live / streaming jobs
# ---------------------------------------------------------------------------

@app.post("/api/live/slm")
async def start_live_slm(req: LiveSLMRequest, background_tasks: BackgroundTasks, request: Request):
    """Start a streaming SLM job.  Returns ``{job_id}``; stream via
    ``GET /api/benchmark/{job_id}/stream``."""
    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)

    audit_event(
        "live_slm_started", client_ip,
        job_id=job_id, model_id=req.model_id,
        prompt_hash=hash_prompt(req.prompt),
    )

    loop = asyncio.get_running_loop()

    async def _run():
        jobs.set_running(job_id)
        channel = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            result = await run_live_slm_async(
                model_id=req.model_id,
                prompt=req.prompt,
                channel=channel,
                job_id=job_id,
                save=req.save,
            )
            jobs.set_done(job_id, result)
        except Exception as exc:
            logger.exception("live_slm_failed model_id=%s", req.model_id,
                             extra={"job_id": job_id})
            jobs.set_failed(job_id, str(exc))
            audit_event("live_slm_failed", client_ip, job_id=job_id,
                        model_id=req.model_id, error=str(exc))
            channel.send_error(str(exc))

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


@app.post("/api/live/asr")
async def start_live_asr(req: LiveASRRequest, background_tasks: BackgroundTasks, request: Request):
    """Start a streaming ASR job.  Returns ``{job_id}``; stream via
    ``GET /api/benchmark/{job_id}/stream``."""
    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)

    audit_event(
        "live_asr_started", client_ip,
        job_id=job_id, model_id=req.model_id,
        audio_path=req.audio_path,
    )

    loop = asyncio.get_running_loop()

    async def _run():
        jobs.set_running(job_id)
        channel = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            result = await run_live_asr_async(
                model_id=req.model_id,
                audio_path=req.audio_path,
                channel=channel,
                job_id=job_id,
                chunk_ms=req.chunk_ms,
                save=req.save,
            )
            jobs.set_done(job_id, result)
        except Exception as exc:
            logger.exception("live_asr_failed model_id=%s", req.model_id,
                             extra={"job_id": job_id})
            jobs.set_failed(job_id, str(exc))
            audit_event("live_asr_failed", client_ip, job_id=job_id,
                        model_id=req.model_id, error=str(exc))
            channel.send_error(str(exc))

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


@app.post("/api/transcription/file")
async def transcription_file_upload(
    background_tasks: BackgroundTasks,
    request: Request,
    audio: UploadFile = File(...),
    model_id: str = Form(...),
):
    """Transcribe an uploaded audio file with a selected ASR model.

    Accepts a multipart POST with:
      - audio    — WAV, MP3, M4A, OGG, WebM, or FLAC
      - model_id — registry key of an ASR model

    Returns ``{job_id}``; stream progress and result via
    ``GET /api/benchmark/{job_id}/stream``.
    """
    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)

    audio_bytes = await audio.read()
    original_name = audio.filename or "upload.bin"
    suffix = Path(original_name).suffix or ".wav"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(audio_bytes)
    tmp.close()
    tmp_path = tmp.name

    audit_event(
        "transcription_file_started", client_ip,
        job_id=job_id, model_id=model_id, audio_filename=original_name,
    )

    loop = asyncio.get_running_loop()

    async def _run():
        import os
        import time
        import soundfile as sf

        jobs.set_running(job_id)
        sse = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            info = sf.info(tmp_path)
            audio_duration_s = info.duration

            sse.send_progress(f"loading {model_id}")

            t_start = time.perf_counter()
            result = await run_live_asr_async(
                model_id=model_id,
                audio_path=tmp_path,
                channel=NullProgressChannel(),
                job_id=job_id,
                save=False,
            )
            processing_ms = (time.perf_counter() - t_start) * 1000

            m = result.setdefault("metrics", {})
            transcript = m.get("full_transcript", "")
            word_count = len(transcript.split()) if transcript.strip() else 0
            rtf = processing_ms / (audio_duration_s * 1000) if audio_duration_s > 0 else None
            wpm = (word_count / audio_duration_s * 60) if audio_duration_s > 0 else None

            m["audio_duration_s"] = round(audio_duration_s, 2)
            m["processing_ms"] = round(processing_ms)
            m["rtf"] = round(rtf, 3) if rtf is not None else None
            m["word_count"] = word_count
            m["words_per_min"] = round(wpm, 1) if wpm is not None else None
            result["filename"] = original_name

            jobs.set_done(job_id, result)
            sse.send_done(result)

        except Exception as exc:
            logger.exception(
                "transcription_file_failed model_id=%s", model_id,
                extra={"job_id": job_id},
            )
            jobs.set_failed(job_id, str(exc))
            sse.send_error(str(exc))
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


@app.post("/api/transcription/sample")
async def transcription_sample(
    req: TranscriptionSampleRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """Transcribe one of the curated benchmark audio samples.

    Accepts ``{model_id, audio_path}`` where ``audio_path`` is a relative path
    from ``/api/audio/samples`` (e.g. ``data/benchmark/librispeech/sample_00.wav``).

    The ASR model is kept loaded between requests in ``app.state.asr_cache`` so
    subsequent calls against the same model pay zero load cost.

    Returns ``{job_id}``; stream result via ``GET /api/benchmark/{job_id}/stream``.
    """
    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)

    audit_event(
        "transcription_sample_started", client_ip,
        job_id=job_id, model_id=req.model_id, audio_path=req.audio_path,
    )

    # Capture before entering the background task closure.
    asr_cache = request.app.state.asr_cache
    loop = asyncio.get_running_loop()

    async def _run():
        import time
        import soundfile as sf

        jobs.set_running(job_id)
        sse = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            # Read audio once — used for duration and transcription.
            audio, sample_rate = sf.read(req.audio_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            audio_duration_s = len(audio) / sample_rate

            # Get or load model — keep it in the cache for subsequent requests.
            if req.model_id not in asr_cache:
                sse.send_progress(f"loading {req.model_id}")
                model = ModelFactory.create(req.model_id)
                await loop.run_in_executor(None, model.load)
                asr_cache[req.model_id] = model
                logger.info(
                    "transcription_cache_miss model_id=%s", req.model_id,
                    extra={"job_id": job_id},
                )
            else:
                model = asr_cache[req.model_id]
                logger.info(
                    "transcription_cache_hit model_id=%s", req.model_id,
                    extra={"job_id": job_id},
                )

            sse.send_progress("transcribing")

            def _transcribe():
                result = model.transcribe(
                    audio, sample_rate,
                    source_name=req.audio_path,
                )
                return result.full_text

            t_start = time.perf_counter()
            transcript = await loop.run_in_executor(None, _transcribe)
            processing_ms = (time.perf_counter() - t_start) * 1000

            word_count = len(transcript.split()) if transcript.strip() else 0
            rtf = processing_ms / (audio_duration_s * 1000) if audio_duration_s > 0 else None
            wpm = (word_count / audio_duration_s * 60) if audio_duration_s > 0 else None

            result = {
                "mode": "transcription",
                "model_id": req.model_id,
                "metrics": {
                    "full_transcript":  transcript,
                    "audio_duration_s": round(audio_duration_s, 2),
                    "processing_ms":    round(processing_ms),
                    "rtf":              round(rtf, 3) if rtf is not None else None,
                    "word_count":       word_count,
                    "words_per_min":    round(wpm, 1) if wpm is not None else None,
                },
            }

            jobs.set_done(job_id, result)
            sse.send_done(result)

        except Exception as exc:
            logger.exception(
                "transcription_sample_failed model_id=%s", req.model_id,
                extra={"job_id": job_id},
            )
            jobs.set_failed(job_id, str(exc))
            sse.send_error(str(exc))

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


# ---------------------------------------------------------------------------
# Routes — chat
# ---------------------------------------------------------------------------

def _format_phi3_chat(system_prompt: str, messages: list[dict]) -> str:
    """Format a conversation using the Phi-3 Instruct chat template.

    Template: <|system|>\\n{system}<|end|>\\n<|user|>\\n{user}<|end|>\\n<|assistant|>\\n
    """
    parts = [f"<|system|>\n{system_prompt}<|end|>\n"]
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "user":
            parts.append(f"<|user|>\n{content}<|end|>\n")
        elif role == "assistant":
            parts.append(f"<|assistant|>\n{content}<|end|>\n")
    parts.append("<|assistant|>\n")
    return "".join(parts)


def _format_llama3_chat(system_prompt: str, messages: list[dict]) -> str:
    """Format a conversation using the Llama-3 Instruct chat template.

    Used for Apertus 8B and any other Llama-3-based instruction model.
    Template uses BOS + header/EOT tokens defined by Meta Llama 3.
    """
    parts = [
        "<|begin_of_text|>",
        f"<|start_header_id|>system<|end_header_id|>\n\n{system_prompt}<|eot_id|>",
    ]
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role in ("user", "assistant"):
            parts.append(
                f"<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>"
            )
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "".join(parts)


def _format_gemma_chat(system_prompt: str, messages: list[dict]) -> str:
    """Format a conversation using the Gemma 3 Instruct chat template.

    Gemma 3 has no native system role — the system prompt is prepended to the
    first user message.  Template tokens: <start_of_turn> / <end_of_turn>.
    """
    parts = []
    for i, msg in enumerate(messages):
        role = msg["role"]
        content = msg["content"]
        if role == "user":
            if i == 0 and system_prompt:
                content = f"{system_prompt}\n\n{content}"
            parts.append(f"<start_of_turn>user\n{content}<end_of_turn>\n")
        elif role == "assistant":
            parts.append(f"<start_of_turn>model\n{content}<end_of_turn>\n")
    parts.append("<start_of_turn>model\n")
    return "".join(parts)


def _format_qwen_chat(system_prompt: str, messages: list[dict]) -> str:
    """Format a conversation using the ChatML template (Qwen 2.5 Instruct).

    Qwen 2.5 Instruct and most ChatML-based models use these control tokens:
        <|im_start|>system\\n{system}<|im_end|>\\n
        <|im_start|>user\\n{content}<|im_end|>\\n
        <|im_start|>assistant\\n

    This is NOT the same as Llama-3 format.  Using Llama-3 tokens
    (<|start_header_id|> etc.) for Qwen produces out-of-vocabulary sequences
    that the model never saw during training.
    """
    parts = [f"<|im_start|>system\n{system_prompt}<|im_end|>\n"]
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "user":
            parts.append(f"<|im_start|>user\n{content}<|im_end|>\n")
        elif role == "assistant":
            parts.append(f"<|im_start|>assistant\n{content}<|im_end|>\n")
    parts.append("<|im_start|>assistant\n")
    return "".join(parts)


def _format_apertus_chat(system_prompt: str, messages: list[dict]) -> str:
    """Format a conversation using the Apertus Instruct chat template.

    Apertus (swiss-ai/Apertus-8B-Instruct-*) defines its own special tokens
    (confirmed from tokenizer_config.json added_tokens_decoder):
        <|system_start|>  / <|system_end|>
        <|user_start|>    / <|user_end|>
        <|assistant_start|> / <|assistant_end|>   ← also the EOS token (ID 68)

    These are NOT Llama-3 tokens. Using Llama-3 format (<|start_header_id|>
    etc.) produces tokens that Apertus never saw during training, so the model
    ignores all instruction structure and hallucinates free-form text.
    """
    parts = ["<s>"]
    if system_prompt:
        parts.append(f"<|system_start|>{system_prompt}<|system_end|>")
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "user":
            parts.append(f"<|user_start|>{content}<|user_end|>")
        elif role == "assistant":
            parts.append(f"<|assistant_start|>{content}<|assistant_end|>")
    parts.append("<|assistant_start|>")
    return "".join(parts)


def _format_chat(model_id: str, system_prompt: str, messages: list[dict], cfg: dict) -> str:
    """Dispatch to the correct chat template based on ``chat_format`` in models.yaml.

    Falls back to the Phi-3 template if ``chat_format`` is absent or unknown,
    preserving backward compatibility with existing model entries.
    """
    chat_format = cfg.get("models", {}).get(model_id, {}).get("chat_format", "phi3")
    if chat_format == "apertus":
        return _format_apertus_chat(system_prompt, messages)
    if chat_format == "qwen":
        return _format_qwen_chat(system_prompt, messages)
    if chat_format == "llama3":
        return _format_llama3_chat(system_prompt, messages)
    if chat_format == "gemma":
        return _format_gemma_chat(system_prompt, messages)
    return _format_phi3_chat(system_prompt, messages)


@app.post("/api/chat")
async def chat(req: ChatRequest, background_tasks: BackgroundTasks, request: Request):
    """Add the user message and start a streaming SLM generation.

    The response is streamed via ``GET /api/benchmark/{job_id}/stream``.
    Returns ``{job_id}`` so the frontend can subscribe.
    """
    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)

    audit_event(
        "chat_started", client_ip,
        job_id=job_id, model_id=req.model_id,
        prompt_hash=hash_prompt(req.message),
    )

    sessions.add_message("user", req.message)
    prompt = _format_chat(req.model_id, req.system_prompt, sessions.get_messages(), request.app.state.config)

    loop = asyncio.get_running_loop()

    async def _run():
        jobs.set_running(job_id)
        channel = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            result = await run_live_slm_async(
                model_id=req.model_id,
                prompt=prompt,
                channel=channel,
                job_id=job_id,
                save=False,
            )
            assistant_text = result.get("output", "")
            sessions.add_message("assistant", assistant_text)
            jobs.set_done(job_id, result)
        except Exception as exc:
            logger.exception("chat_failed model_id=%s", req.model_id,
                             extra={"job_id": job_id})
            jobs.set_failed(job_id, str(exc))
            audit_event("chat_failed", client_ip, job_id=job_id,
                        model_id=req.model_id, error=str(exc))
            channel.send_error(str(exc))

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


@app.delete("/api/chat")
def clear_chat():
    """Clear the in-memory chat session."""
    sessions.clear()
    return JSONResponse({"status": "cleared"})


@app.get("/api/chat/history")
def get_chat_history():
    """Return the current in-memory conversation."""
    return JSONResponse(sessions.get_messages())


# ---------------------------------------------------------------------------
# Routes — voice transcription
# ---------------------------------------------------------------------------

@app.post("/api/voice/transcribe-and-structure")
async def transcribe_and_structure(
    request: Request,
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    timestamp_start: int = Form(...),
    nurse_id: str = Form(...),
):
    """Transcribe an audio chunk and extract structured clinical data.

    Accepts a multipart/form-data POST with:
      - audio           — WebM/Opus (Chrome) or M4A/AAC (Android)
      - session_id      — nurse session identifier
      - timestamp_start — recording start time in ms
      - nurse_id        — nurse identifier

    Returns the transcript, structured fields, language, confidence, and timestamps.
    """
    audio_bytes = await audio.read()
    result = await run_transcribe_and_structure(
        audio_bytes=audio_bytes,
        mime_type=audio.content_type or "audio/webm",
        session_id=session_id,
        timestamp_start=timestamp_start,
        nurse_id=nurse_id,
        asr_model=request.app.state.voice_asr,
        slm_model=request.app.state.voice_slm,
        extraction_prompt_template=request.app.state.voice_extraction_prompt,
    )
    audit_event(
        "voice_transcribed",
        request.client.host if request.client else "-",
        session_id=session_id,
        nurse_id=nurse_id,
    )
    return JSONResponse(result)


# ---------------------------------------------------------------------------
# Routes — model catalogue
# ---------------------------------------------------------------------------

class DownloadRequest(PydanticModel):
    catalogue_id: str
    compression: str = "int8"
    hf_token: str = ""
    variant: str = "openvino"   # "openvino" | "pytorch"


@app.get("/api/catalogue")
def get_catalogue():
    """Return the curated model catalogue merged with local disk status."""
    entries = []
    for item in CATALOGUE:
        entries.append({
            **item,
            "status": get_model_status(item),
            "pytorch_status": get_pytorch_status(item) if item.get("type") == "slm" else None,
        })
    return JSONResponse(entries)


@app.post("/api/catalogue/download")
async def download_model(req: DownloadRequest, background_tasks: BackgroundTasks, request: Request):
    """Start a background download+conversion job for a catalogue model.

    Returns ``{job_id}``; stream progress via ``GET /api/benchmark/{job_id}/stream``.
    """
    entry = CATALOGUE_BY_ID.get(req.catalogue_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Catalogue entry '{req.catalogue_id}' not found")

    if req.compression not in entry.get("compression_options", ["int8"]):
        raise HTTPException(
            status_code=400,
            detail=f"Compression '{req.compression}' not supported for '{req.catalogue_id}'",
        )

    job_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "-"
    jobs.create_job(job_id)
    audit_event("model_download_started", client_ip, job_id=job_id,
                catalogue_id=req.catalogue_id, compression=req.compression)

    loop = asyncio.get_running_loop()

    async def _run():
        jobs.set_running(job_id)
        channel = QueueProgressChannel(jobs.get_queue(job_id), loop, job_id)
        try:
            if req.variant == "pytorch":
                result = await loop.run_in_executor(
                    None, download_pytorch, entry, channel, req.hf_token or None
                )
                add_pytorch_to_yaml(entry)
            else:
                result = await loop.run_in_executor(
                    None, download_and_convert, entry, req.compression, channel, req.hf_token or None
                )
                add_model_to_yaml(entry, req.compression)
            channel.send_progress("Model registered in config/models.yaml")
            # Reload in-memory config so /api/chat uses the correct chat_format
            # for models that were added while the server was already running.
            try:
                request.app.state.config = _load_yaml_config()
            except Exception:
                logger.warning("Failed to reload config after download", exc_info=True)
            jobs.set_done(job_id, result)
            channel.send_done(result)
        except Exception as exc:
            logger.exception("model_download_failed catalogue_id=%s", req.catalogue_id,
                             extra={"job_id": job_id})
            jobs.set_failed(job_id, str(exc))
            audit_event("model_download_failed", client_ip, job_id=job_id,
                        catalogue_id=req.catalogue_id, error=str(exc))
            channel.send_error(str(exc))

    background_tasks.add_task(_run)
    return JSONResponse({"job_id": job_id})


# ---------------------------------------------------------------------------
# Routes — logs
# ---------------------------------------------------------------------------

@app.get("/api/logs")
def get_logs(n: int = 200, level: str = ""):
    """Return the last N log entries from logs/app.json, newest first.

    Args:
        n:     Maximum number of entries to return.
        level: If provided, filter to entries with this exact level (case-insensitive).
    """
    log_file = _LOGS_DIR / "app.json"
    if not log_file.exists():
        return JSONResponse([])

    entries: list[dict] = []
    try:
        lines = log_file.read_text(encoding="utf-8").splitlines()
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if level and entry.get("level", "").upper() != level.upper():
                continue
            entries.append(entry)
            if len(entries) >= n:
                break
    except Exception:
        logger.warning("Failed to read log file", exc_info=True)

    return JSONResponse(entries)
"""
FastAPI controller — all API endpoints and SSE stream.

Start with:
    uvicorn web.server:app --reload --port 8000
"""

import asyncio
import json
import logging
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
from src.benchmark.channels import QueueProgressChannel
from src.benchmark.factory import ModelFactory
from src.benchmark.repository import ResultRepository
from src.benchmark.runner import run_benchmark_async, run_live_slm_async, run_live_asr_async
from src.logging_config import setup_logging
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

@app.get("/api/models")
def list_models(request: Request):
    """Return all models from config with their type, label, and enabled state."""
    cfg = request.app.state.config
    models = [
        {
            "id": mid,
            "label": mcfg.get("label", mid),
            "type": mcfg.get("type", "unknown"),
            "enabled": mcfg.get("enabled", True),
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


def _format_chat(model_id: str, system_prompt: str, messages: list[dict], cfg: dict) -> str:
    """Dispatch to the correct chat template based on ``chat_format`` in models.yaml.

    Falls back to the Phi-3 template if ``chat_format`` is absent or unknown,
    preserving backward compatibility with existing model entries.
    """
    chat_format = cfg.get("models", {}).get(model_id, {}).get("chat_format", "phi3")
    if chat_format == "llama3":
        return _format_llama3_chat(system_prompt, messages)
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
"""
ASR → SLM pipeline for POST /api/voice/transcribe-and-structure.

Entry point: run_transcribe_and_structure() — async, offloads blocking
inference to a thread-pool executor so the FastAPI event loop is never blocked.

Audio decoding requires ffmpeg on PATH (used by pydub).
"""

import asyncio
import io
import json
import logging
import re
import time

import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Audio decoding
# ---------------------------------------------------------------------------

def _decode_audio(audio_bytes: bytes, mime_type: str) -> tuple[np.ndarray, int]:
    """Decode WebM/Opus or M4A/AAC bytes to a float32 mono numpy array.

    Args:
        audio_bytes: Raw bytes from the multipart upload.
        mime_type:   Content-Type reported by the client
                     (e.g. "audio/webm", "audio/mp4").

    Returns:
        ``(samples, sample_rate)`` where ``samples`` is float32 in [-1.0, 1.0].
    """
    from pydub import AudioSegment

    fmt = "webm" if "webm" in mime_type else "mp4"
    logger.info("decode_audio_start bytes=%d mime=%s fmt=%s", len(audio_bytes), mime_type, fmt)

    seg = AudioSegment.from_file(io.BytesIO(audio_bytes), format=fmt)
    logger.info("decode_audio_raw channels=%d frame_rate=%d duration_ms=%d sample_width=%d",
                seg.channels, seg.frame_rate, len(seg), seg.sample_width)

    if seg.channels > 1:
        seg = seg.set_channels(1)
        logger.info("decode_audio_downmixed_to_mono")

    # Whisper requires 16 kHz; resample here so the ASR model never sees 48 kHz input
    if seg.frame_rate != 16000:
        logger.info("decode_audio_resampling %d -> 16000 Hz", seg.frame_rate)
        seg = seg.set_frame_rate(16000)

    sample_rate = seg.frame_rate
    samples = np.array(seg.get_array_of_samples(), dtype=np.float32)
    samples /= float(2 ** (seg.sample_width * 8 - 1))

    duration_s = len(samples) / sample_rate
    logger.info("decode_audio_done samples=%d sample_rate=%d duration_s=%.2f rms=%.4f",
                len(samples), sample_rate, duration_s, float(np.sqrt(np.mean(samples ** 2))))

    if duration_s < 0.5:
        logger.warning("decode_audio VERY SHORT clip (%.2fs) — likely silence or bad capture", duration_s)
    if float(np.sqrt(np.mean(samples ** 2))) < 0.001:
        logger.warning("decode_audio NEAR-SILENT audio (rms=%.6f) — mic may not be capturing", float(np.sqrt(np.mean(samples ** 2))))

    return samples, sample_rate


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------

def _build_phi3_prompt(system: str, user: str) -> str:
    return f"<|system|>\n{system}<|end|>\n<|user|>\n{user}<|end|>\n<|assistant|>\n"


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

_STRUCTURED_KEYS = ("patient_name", "room", "vitals", "medications", "actions", "activity_type")

_EMPTY_STRUCTURED = {k: None for k in _STRUCTURED_KEYS}


def _parse_structured(raw: str) -> dict:
    """Extract the first JSON object from the SLM output.

    Falls back to all-null structured dict if the output cannot be parsed.
    """
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    logger.warning("SLM output could not be parsed as JSON — returning null structured: %s", raw[:200])
    return dict(_EMPTY_STRUCTURED)


# ---------------------------------------------------------------------------
# Synchronous pipeline (runs in thread executor)
# ---------------------------------------------------------------------------

def _run_pipeline(
    audio_bytes: bytes,
    mime_type: str,
    timestamp_start: int,
    asr_model,
    slm_model,
    extraction_prompt_template: str,
) -> dict:
    t0 = time.perf_counter()

    # 1. Decode audio bytes → float32 mono array
    audio, sample_rate = _decode_audio(audio_bytes, mime_type)

    # 2. Transcribe with Whisper
    logger.info("asr_start audio_shape=%s sample_rate=%d", audio.shape, sample_rate)
    asr_result = asr_model.transcribe(audio, sample_rate)
    transcript = asr_result.full_text.strip()
    language = asr_result.language
    confidence = asr_result.segments[0].confidence if asr_result.segments else 1.0
    timestamp_end = timestamp_start + int(asr_result.duration * 1000)

    logger.info("asr_done transcript=%r language=%s confidence=%.3f segments=%d duration_s=%.2f",
                transcript, language, confidence, len(asr_result.segments), asr_result.duration)

    # 3. Extract structured data with SLM — skip if transcript is too short to be meaningful
    if len(transcript.split()) < 4:
        logger.info("pipeline_skip_slm transcript too short (%d words)", len(transcript.split()))
        structured = dict(_EMPTY_STRUCTURED)
    else:
        user_message = extraction_prompt_template.replace("{transcript}", transcript)
        prompt = _build_phi3_prompt(
            system="You are a clinical data extraction assistant. Output only valid JSON.",
            user=user_message,
        )
        slm_text, _ = slm_model.run(prompt)
        structured = _parse_structured(slm_text)

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "pipeline_complete transcript_len=%d language=%s elapsed_ms=%d",
        len(transcript), language, elapsed_ms,
    )

    return {
        "transcript": transcript,
        "structured": {k: structured.get(k) for k in _STRUCTURED_KEYS},
        "language": language,
        "confidence": confidence,
        "timestamp_start": timestamp_start,
        "timestamp_end": timestamp_end,
    }


# ---------------------------------------------------------------------------
# Async entry point
# ---------------------------------------------------------------------------

async def run_transcribe_and_structure(
    audio_bytes: bytes,
    mime_type: str,
    session_id: str,
    timestamp_start: int,
    nurse_id: str,
    asr_model,
    slm_model,
    extraction_prompt_template: str,
) -> dict:
    """Run the ASR → SLM pipeline without blocking the FastAPI event loop.

    Args:
        audio_bytes:                Raw multipart audio bytes (WebM or M4A).
        mime_type:                  Content-Type of the audio (e.g. "audio/webm").
        session_id:                 Nurse session identifier (logged, not used in inference).
        timestamp_start:            Recording start time in ms (echoed in response).
        nurse_id:                   Nurse identifier (logged, not used in inference).
        asr_model:                  Pre-loaded ASR model from app.state.voice_asr.
        slm_model:                  Pre-loaded SLM model from app.state.voice_slm.
        extraction_prompt_template: Prompt string with ``{transcript}`` placeholder,
                                    pre-loaded from data/prompts/structured_extraction_prompt.txt.

    Returns:
        Dict matching the /api/voice/transcribe-and-structure response contract.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        _run_pipeline,
        audio_bytes,
        mime_type,
        timestamp_start,
        asr_model,
        slm_model,
        extraction_prompt_template,
    )
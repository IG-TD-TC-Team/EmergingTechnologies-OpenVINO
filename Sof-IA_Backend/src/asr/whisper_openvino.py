"""
WhisperOpenVINO - Whisper ASR using OpenVINO for CPU optimization.

Extends ASRBase (benchmark hierarchy) so the runner can use it via
ModelFactory. Also preserves the transcribe() API used by existing scripts.
"""

import shutil
import xml.etree.ElementTree as ET
from typing import Generator, Iterator, List
import logging
from pathlib import Path

import numpy as np
from optimum.intel.openvino import OVModelForSpeechSeq2Seq
from transformers import AutoProcessor

from src.benchmark.base import StreamingASRBase
from .base import TranscriptionResult, TranscriptionSegment
from .languages import WHISPER_LANGUAGES


def _seq2seq_export_is_stateful(model_path: Path) -> bool:
    """Return True if any decoder XML in the seq2seq OV export has Assign nodes.

    OV 2026.x has two incompatible Whisper export modes:

    **Stateful** (Assign nodes present — the default):
        Normal generation works.  The only problem is ``detect_language()``,
        which passes ``use_cache=False`` and triggers an attention-mask shape
        mismatch in ``ScaledDotProductAttentionWithKVCache``.  Fix: bypass
        ``detect_language`` by always passing ``language=`` to ``generate()``.

    **Stateless** (no Assign nodes — ``stateful=False``):
        Structurally broken for Whisper in OV 2026.x.  The forced-token prefill
        step (``[sot, lang, task, notimestamps]`` = 4 tokens at once) feeds 4
        elements into a Reshape node compiled for 16
        (4 decoder layers × 2 KV types × 2 attention kinds), causing::

            Reshape: shape of input data (4) conflicts with pattern (16.1)

        Not fixable at runtime — the graph itself is wrong.

    Strategy: keep stateful exports; delete stateless exports so they are
    re-exported as stateful below.
    """
    decoder_xmls = [
        "openvino_decoder_with_past_model.xml",
        "openvino_decoder_model_merged.xml",
        "openvino_decoder_model.xml",
    ]
    for fname in decoder_xmls:
        xml_path = model_path / fname
        if not xml_path.exists():
            continue
        try:
            root = ET.parse(xml_path).getroot()
            if any(layer.get("type") == "Assign" for layer in root.iter("layer")):
                return True
        except Exception:
            pass
    return False

logger = logging.getLogger(__name__)


class WhisperOpenVINO(StreamingASRBase):
    """Whisper ASR using Intel OpenVINO INT8 quantized inference on CPU.

    If ``model_path`` does not exist on disk the model is downloaded from
    ``hub_id`` and exported to OpenVINO format via
    ``optimum-intel`` on first use.  Subsequent :meth:`load` calls read
    directly from the saved IR files.

    This is the **optimized** ASR backend benchmarked against
    :class:`~src.asr.whisper_pytorch.WhisperPyTorch`.
    """

    SUPPORTED_LANGUAGES: list[str] = sorted(WHISPER_LANGUAGES)
    """All language codes supported by Whisper, sorted alphabetically."""

    def __init__(
        self,
        model_id: str,
        model_path: str,
        hub_id: str = "openai/whisper-medium",
        channel=None,
    ):
        """Initialize WhisperOpenVINO.

        Args:
            model_id: Registry key from ``config/models.yaml``
                (e.g. ``"whisper_openvino"``).
            model_path: Local directory that contains (or will receive) the
                exported OpenVINO IR model and processor files.
            hub_id: HuggingFace Hub repository ID used as the source for the
                first-time export (e.g. ``"openai/whisper-medium"``).
            channel: Progress channel injected at construction.

        Note:
            ``transcribe()``, ``name``, ``is_available()``, and
            ``get_supported_languages()`` are scripting API helpers.  They are
            not part of the benchmark runner contract (which only calls
            ``load()``, ``run()``, ``unload()``).
        """
        super().__init__(model_id, model_path, channel)
        self._ov_path = Path(model_path)
        self.hub_id = hub_id
        self.device = "CPU"
        self._model = None
        self._processor = None
        logger.info("Initializing WhisperOpenVINO model_path=%s", model_path)

    # ------------------------------------------------------------------
    # ASRBase / BaseModel interface (used by the benchmark runner)
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Load the Whisper processor and OpenVINO IR model into CPU memory.

        If the model is already loaded this is a no-op.  If ``model_path``
        does not exist, the model is exported from ``hub_id`` first.

        OV 2026.x export strategy
        ~~~~~~~~~~~~~~~~~~~~~~~~~
        OV 2026.x has two incompatible Whisper export modes (see
        :func:`_seq2seq_export_is_stateful`).  We always use stateful exports
        (the default) and bypass ``detect_language()`` in :meth:`transcribe`
        so the ``use_cache=False`` attn-mask bug is never triggered.

        Stateless exports (``stateful=False``) are structurally broken — a
        Reshape node compiled for single-token inference fails on the 4-token
        forced-prefix prefill step.  Any stateless export found on disk is
        deleted and re-exported as stateful.
        """
        if self._model is not None:
            return

        # ── OV 2026.x: delete broken stateless exports ───────────────────────
        if self._ov_path.exists():
            has_ov_files = any(self._ov_path.glob("openvino_*.xml"))
            if has_ov_files and not _seq2seq_export_is_stateful(self._ov_path):
                self._report(
                    "Stateless Whisper OpenVINO export detected — stateless "
                    "seq2seq exports are broken in OV 2026.x (Reshape shape "
                    "mismatch on multi-token forced-prefix prefill). "
                    "Deleting and re-exporting as stateful (Assign KV cache)."
                )
                shutil.rmtree(self._ov_path)

        if not self._ov_path.exists():
            self._report(
                f"model not found locally — downloading & exporting '{self.hub_id}' "
                "to OpenVINO (this may take several minutes)"
            )
            self._ov_path.mkdir(parents=True, exist_ok=True)
            # Export as stateful (optimum-intel default).  Do NOT pass
            # stateful=False — that produces a broken graph for OV 2026.x.
            model = OVModelForSpeechSeq2Seq.from_pretrained(
                self.hub_id, export=True, compile=False
            )
            model.save_pretrained(str(self._ov_path))
            processor = AutoProcessor.from_pretrained(self.hub_id)
            processor.save_pretrained(str(self._ov_path))
            self._report(f"export complete — model saved to '{self._ov_path}'")

        self._report(f"loading OpenVINO model from {self._ov_path}")
        self._model = OVModelForSpeechSeq2Seq.from_pretrained(
            str(self._ov_path), device=self.device, compile=True
        )
        self._processor = AutoProcessor.from_pretrained(str(self._ov_path))
        logger.info("WhisperOpenVINO loaded")

    def run(self, audio_path: str) -> str:
        """Transcribe an audio file — satisfies :meth:`~src.benchmark.base.ASRBase.run`.

        Reads the audio file with ``soundfile``, converts stereo to mono if
        necessary, then delegates to :meth:`transcribe`.

        Args:
            audio_path: Path to a ``.wav`` or ``.mp3`` audio file.

        Returns:
            Full transcription text (all segments joined by spaces).
        """
        import soundfile as sf
        audio, sample_rate = sf.read(audio_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)  # stereo -> mono
        result = self.transcribe(audio, sample_rate, source_name=audio_path)
        return result.full_text

    def unload(self) -> None:
        """Delete the model and processor and free CPU memory.

        Safe to call even if :meth:`load` has not been called.
        """
        if self._model is not None:
            del self._model
            del self._processor
            self._model = None
            self._processor = None
            logger.info("WhisperOpenVINO unloaded")

    # ------------------------------------------------------------------
    # Transcription API (used by existing scripts)
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        """Unique string identifier for this model instance.

        Returns:
            A string of the form ``"whisper-openvino-<dir_name>"``
            derived from ``model_path`` (e.g.
            ``"whisper-openvino-whisper-medium-ov"``).
        """
        return f"whisper-openvino-{self._ov_path.name}"

    def _reset_decoder_state(self) -> None:
        """Reset the stateful KV-cache in the OV decoder infer-request.

        Must be called after any manual decoder forward that is NOT part of
        ``generate()`` (e.g. language detection), so the subsequent
        ``generate()`` call starts from a clean state.

        Safe to call on non-stateful models — the ``query_state()`` list is
        simply empty in that case.
        """
        for attr in ("decoder", "decoder_with_past"):
            dec = getattr(self._model, attr, None)
            if dec is None:
                continue
            req = getattr(dec, "request", None)
            if req is None:
                continue
            try:
                for state in req.query_state():
                    state.reset()
            except Exception:
                pass  # non-stateful model or OV API difference — harmless

    def _detect_language_ov(self, proc_inputs: dict) -> str:
        """OV-compatible language detection for transformers >= 4.50.

        ``transformers >= 4.50`` ``detect_language()`` calls
        ``model.forward(use_cache=False)``, which in OV 2026.x triggers an
        attention-mask shape mismatch on stateful exports, or a Reshape
        dimension mismatch on stateless exports.

        This method calls the model forward WITHOUT ``use_cache=False`` (the
        normal first-decode-step path), reads the language token logits, then
        resets the stateful decoder KV-cache so the subsequent ``generate()``
        starts clean.

        Returns:
            ISO 639-1 language code (e.g. ``"en"``) or ``"en"`` on any failure.
        """
        import torch
        try:
            tokenizer = self._processor.tokenizer
            lang_code_to_id: dict = getattr(tokenizer, "lang_code_to_id", {})
            if not lang_code_to_id:
                return "en"  # English-only model — no detection needed

            sot_id = tokenizer.convert_tokens_to_ids("<|startoftranscript|>")
            if sot_id is None:
                return "en"

            decoder_input_ids = torch.tensor([[sot_id]])
            # Normal first-decode step — use_cache defaults to True.
            # Does NOT trigger the use_cache=False OV 2026.x bug.
            with torch.no_grad():
                out = self._model(**proc_inputs, decoder_input_ids=decoder_input_ids)

            # Reset stateful KV cache so generate() starts from a clean state.
            self._reset_decoder_state()

            language_ids = list(lang_code_to_id.values())
            lang_logits = out.logits[0, -1, language_ids]
            best_id = language_ids[int(lang_logits.argmax())]
            id_to_lang = {v: k for k, v in lang_code_to_id.items()}
            detected = id_to_lang.get(best_id, "en")
            logger.debug("WhisperOpenVINO detected language=%s", detected)
            return detected
        except Exception as exc:
            logger.warning(
                "OV language detection failed (%s) — defaulting to 'en'", exc
            )
            self._reset_decoder_state()  # ensure clean state even on failure
            return "en"

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int,
        language: str | None = None,
        source_name: str = "Unknown",
        **kwargs,
    ) -> TranscriptionResult:
        """Transcribe a numpy audio array to text using the OpenVINO runtime.

        Automatically calls :meth:`load` if the model is not yet loaded.
        Input audio is normalized to ``float32`` if needed.

        Args:
            audio: Audio samples as a 1-D numpy array (``float32`` or
                ``int16``).
            sample_rate: Sample rate of ``audio`` in Hz (e.g. ``16000``).
            language: ISO 639-1 language code to force
                (e.g. ``"en"``, ``"fr"``).  ``None`` enables automatic
                language detection via :meth:`_detect_language_ov`.
            source_name: Label attached to the returned
                :class:`~src.asr.base.TranscriptionResult` for traceability.
            **kwargs: Ignored; accepted for interface compatibility.

        Returns:
            A :class:`~src.asr.base.TranscriptionResult` containing a single
            segment that spans the full audio duration.
        """
        if self._model is None:
            self.load()

        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        inputs = self._processor(audio, sampling_rate=sample_rate, return_tensors="pt")

        gen_kwargs = {"task": "transcribe"}
        if language is not None:
            gen_kwargs["language"] = language
            detected_language = language
        else:
            # Run our own language detection before calling generate().
            # This bypasses transformers >= 4.50 detect_language(), which
            # passes use_cache=False to the OV decoder — incompatible with
            # OV 2026.x stateless seq2seq exports (Reshape shape mismatch).
            detected_language = self._detect_language_ov(inputs)
            gen_kwargs["language"] = detected_language

        predicted_ids = self._model.generate(**inputs, **gen_kwargs)
        text = self._processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        duration = len(audio) / sample_rate
        return TranscriptionResult(
            segments=[TranscriptionSegment(text=text, start=0.0, end=duration,
                                           language=detected_language, confidence=1.0)],
            source_name=source_name,
            language=detected_language,
            duration=duration,
        )

    def transcribe_stream(
        self,
        audio_chunks: Iterator[tuple[bytes, int]],
    ) -> Generator[str, None, str]:
        """Yield cumulative partial transcripts chunk by chunk.

        Each chunk is transcribed independently and appended to the running
        transcript.  Whisper works best with full context, so each chunk
        produces a best-effort partial result.

        Args:
            audio_chunks: Iterator of ``(pcm_bytes, sample_rate)`` tuples.
                ``pcm_bytes`` is a raw ``float32`` PCM byte string.

        Yields:
            Cumulative partial transcript after each chunk.

        Returns:
            Final full transcript via ``StopIteration.value``.
        """
        accumulated: list[str] = []
        for pcm_bytes, sample_rate in audio_chunks:
            audio = np.frombuffer(pcm_bytes, dtype=np.float32)
            result = self.transcribe(audio, sample_rate)
            text = result.full_text.strip()
            if text:
                accumulated.append(text)
            yield " ".join(accumulated)
        return " ".join(accumulated)

    def is_available(self) -> bool:
        """Return ``True`` if the model is currently loaded in memory.

        Returns:
            ``True`` after a successful :meth:`load`, ``False`` otherwise or
            after :meth:`unload`.
        """
        return self._model is not None

    def get_supported_languages(self) -> List[str]:
        """Return a copy of the supported language code list.

        Returns:
            Sorted list of ISO 639-1 language codes supported by Whisper
            (e.g. ``["af", "ar", ..., "zh"]``).
        """
        return self.SUPPORTED_LANGUAGES.copy()
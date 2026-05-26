"""System resource utilities shared by all model backends.

Centralizes two concerns that affect every model's ``load()`` method:

1. **CPU thread limiting** — caps PyTorch / OpenVINO inference threads to
   ``cpu_count - RESERVED_CORES`` so the OS display driver keeps enough
   CPU time on Windows and a TDR (Timeout Detection and Recovery) crash is
   avoided under full CPU load.

2. **RAM pre-flight check** — warns before loading a model if available
   physical RAM is below the model-specific threshold.  The check is
   advisory (it logs a warning rather than raising) because the OS may
   reclaim pages between the check and the actual allocation, but it gives
   the user an early, readable warning instead of a silent OOM or TDR.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager

import psutil

logger = logging.getLogger(__name__)

# Number of CPU cores reserved for the OS, display driver, and background
# threads.  Keeping at least 2 cores free prevents TDR crashes on Windows
# when the inference workload would otherwise saturate all cores.
RESERVED_CORES: int = 2


def safe_thread_count(reserved: int = RESERVED_CORES) -> int:
    """Return the number of threads to use for inference.

    Computes ``cpu_count - reserved``, clamped to a minimum of 1.

    Args:
        reserved: Number of cores to leave free for the OS.

    Returns:
        Thread count to pass to PyTorch or OpenVINO.
    """
    return max(1, (os.cpu_count() or 4) - reserved)


def apply_pytorch_thread_limit(reserved: int = RESERVED_CORES) -> int:
    """Set ``torch.set_num_threads`` and return the count used.

    Import of ``torch`` is deferred so models that do not use PyTorch are
    not forced to have it installed.

    Args:
        reserved: Number of cores to leave free for the OS.

    Returns:
        The thread count that was applied.
    """
    import torch
    n = safe_thread_count(reserved)
    torch.set_num_threads(n)
    return n


def ov_thread_config(reserved: int = RESERVED_CORES) -> dict[str, str]:
    """Return an ``ov_config`` dict that caps OpenVINO inference threads.

    Pass the returned dict as the ``ov_config`` kwarg to
    ``OVModelForCausalLM.from_pretrained`` (and similar optimum-intel calls).

    Args:
        reserved: Number of cores to leave free for the OS.

    Returns:
        ``{"INFERENCE_NUM_THREADS": "<n>"}``
    """
    return {"INFERENCE_NUM_THREADS": str(safe_thread_count(reserved))}


def check_ram(required_bytes: int, label: str) -> None:
    """Warn if available physical RAM is below *required_bytes*.

    Advisory — logs a WARNING but does not raise.  Use for load steps where
    the OS may reclaim pages between the check and the actual allocation.

    Args:
        required_bytes: Minimum free RAM (bytes) needed before loading.
        label: Human-readable model name used in the warning message.
    """
    available = psutil.virtual_memory().available
    if available < required_bytes:
        logger.warning(
            "RAM check: only %.1f GB available but %s requires ~%.1f GB. "
            "Proceeding anyway — risk of TDR / OOM crash is high.",
            available / 1024 ** 3,
            label,
            required_bytes / 1024 ** 3,
        )


def patch_nncf_compat() -> None:
    """Patch ``warning_once`` to accept format-string arguments in older NNCF builds.

    NNCF replaces transformers module loggers with ``NNCFLogger`` instances (or
    instances of dynamically generated ``NNCFLogger`` subclasses).  Older NNCF
    versions define ``warning_once(self, msg)`` with no variadic support.  When
    newer ``optimum-intel`` / transformers code calls
    ``logger.warning_once(fmt, arg)`` this raises::

        TypeError: NNCFLogger.warning_once() takes 2 positional arguments but 3 were given

    Strategy
    --------
    1. **NNCFLogger class patch** — replaces the method on the base class so
       any instance whose class does NOT override it will use the fixed version.
    2. **Direct instance attribute patch on transformers.activations.logger** —
       uses ``getattr`` (not ``__dict__``) so the effective method is found
       regardless of whether it lives on the instance, the direct class, or a
       dynamically generated subclass.  The wrapper is then forced onto the
       instance's ``__dict__``, which always wins in Python's attribute lookup.
    """
    import inspect

    def _needs_patch(method) -> bool:
        try:
            return not any(
                p.kind == inspect.Parameter.VAR_POSITIONAL
                for p in inspect.signature(method).parameters.values()
            )
        except Exception:
            return True  # can't inspect → patch defensively

    def _make_wrapper(fn):
        """Wrap fn so it accepts and applies optional format-string args."""
        def _w(msg, *args):
            try:
                fn(msg % args if args else msg)
            except Exception:
                pass
        return _w

    # --- Patch 1: NNCFLogger class ---
    # Note: the public re-export is nncf.common.logging.logger.NNCFLogger;
    # nncf.common.logging does NOT re-export NNCFLogger directly.
    try:
        from nncf.common.logging.logger import NNCFLogger
        if _needs_patch(NNCFLogger.warning_once):
            _orig_cls = NNCFLogger.warning_once

            def _cls_warning_once(self, msg, *args):
                try:
                    _orig_cls(self, msg % args if args else msg)
                except Exception:
                    pass

            NNCFLogger.warning_once = _cls_warning_once
    except Exception:
        pass

    # --- Patch 2: transformers.activations logger — force instance attribute ---
    # Use getattr (not __dict__) so we find warning_once wherever it lives:
    # instance dict, direct class, or any dynamically generated subclass.
    # Then force-set our wrapper as an instance attribute so it always wins.
    try:
        import transformers.activations as _act
        _log = getattr(_act, 'logger', None)
        if _log is not None:
            _wonce = getattr(_log, 'warning_once', None)
            if _wonce is not None and _needs_patch(_wonce):
                _log.warning_once = _make_wrapper(_wonce)
    except Exception:
        pass


@contextmanager
def sdpa_no_vmap():
    """Context manager: replace ``sdpa_mask_recent_torch`` with a vmap-free version.

    ``transformers >= 4.50`` calls ``torch.vmap`` inside
    ``sdpa_mask_recent_torch`` (via ``_vmap_for_bhqkv``).  The optimum-intel
    ONNX exporter uses ``torch.jit.trace`` to capture the model graph;
    ``torch.vmap`` higher-order functions cannot be traced, causing::

        RuntimeError: vmap: calling torch.vmap inside torch.jit.trace is not
        supported.

    This context manager patches the live function reference with a
    broadcasting-only replacement that is TorchScript-compatible, then
    restores the original on exit.

    Use this around every ``main_export`` / ``OVModelForCausalLM.from_pretrained
    (export=True)`` call so models using the new masking API
    (Qwen 2.5, LLaMA 3.2, Apertus …) convert cleanly.
    """
    try:
        import torch
        import transformers.masking_utils as _mu
    except ImportError:
        yield
        return

    def _no_vmap(
        batch_size: int,
        cache_position: "torch.Tensor",
        kv_length: int,
        kv_offset: int = 0,
        mask_function=None,
        attention_mask=None,
        local_size=None,
        allow_is_causal_skip: bool = True,
        **kwargs,
    ):
        if mask_function is None:
            mask_function = _mu.causal_mask_function

        q_length = cache_position.shape[0]
        padding_mask = _mu.prepare_padding_mask(
            attention_mask, kv_length, kv_offset, _slice=False
        )

        if allow_is_causal_skip and _mu._ignore_causal_mask_sdpa(
            padding_mask, q_length, kv_length, kv_offset, local_size
        ):
            return None

        kv_arange = torch.arange(kv_length, device=cache_position.device) + kv_offset

        if padding_mask is not None:
            mask_function = _mu.and_masks(
                mask_function, _mu.padding_mask_function(padding_mask)
            )

        # Vectorise over (q, kv) via broadcasting — equivalent to
        # _vmap_for_bhqkv but without torch.vmap (which jit.trace cannot capture).
        q_idx = cache_position.view(-1, 1)  # [q_len, 1]
        k_idx = kv_arange.view(1, -1)       # [1, kv_len]
        masks = []
        for b in range(batch_size):
            mask_2d = mask_function(b, 0, q_idx, k_idx)  # [q_len, kv_len]
            masks.append(mask_2d)
        return torch.stack(masks, dim=0).unsqueeze(1)  # [batch, 1, q_len, kv_len]

    _orig_dispatch = _mu.ALL_MASK_ATTENTION_FUNCTIONS.get("sdpa")
    _orig_sdpa_mask = getattr(_mu, "sdpa_mask", None)
    _mu.ALL_MASK_ATTENTION_FUNCTIONS["sdpa"] = _no_vmap
    if _orig_sdpa_mask is not None:
        _mu.sdpa_mask = _no_vmap

    try:
        yield
    finally:
        if _orig_dispatch is not None:
            _mu.ALL_MASK_ATTENTION_FUNCTIONS["sdpa"] = _orig_dispatch
        if _orig_sdpa_mask is not None:
            _mu.sdpa_mask = _orig_sdpa_mask


def require_ram(required_bytes: int, label: str) -> None:
    """Raise ``MemoryError`` if available physical RAM is below *required_bytes*.

    Use this for operations where insufficient RAM will *certainly* crash
    (e.g. the OpenVINO INT4 quantization export pass which peaks at ~32 GB).
    Unlike :func:`check_ram` this is a hard block — the operation is aborted
    before any work begins.

    Args:
        required_bytes: Minimum free RAM (bytes) needed before proceeding.
        label: Human-readable operation name used in the error message.

    Raises:
        MemoryError: If available RAM is below *required_bytes*.
    """
    available = psutil.virtual_memory().available
    if available < required_bytes:
        raise MemoryError(
            f"{label} requires ~{required_bytes / 1024 ** 3:.1f} GB free RAM "
            f"but only {available / 1024 ** 3:.1f} GB is available. "
            "Free memory or run the export on a machine with more RAM, "
            "then copy the exported model files here."
        )
"""Model factory — instantiates the correct BaseModel subclass from config.

Usage::

    model = ModelFactory.create("phi3_openvino")
    model = ModelFactory.create("whisper_pytorch")

The factory reads ``config/models.yaml``, resolves ``model_path`` (env var
override takes priority over the config value), then returns a fully
constructed but **not-yet-loaded** instance.  Callers must call
``model.load()`` before running inference.

Adding a new model requires only a new entry in ``models.yaml`` — no Python
changes are needed in this file (OCP fix).
"""

import importlib
import logging
import os
import yaml
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.benchmark.base import BaseModel
    from src.benchmark.protocols import ProgressChannel

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "models.yaml"


def _load_config() -> dict:
    """Load and parse ``config/models.yaml``.

    Returns:
        Parsed YAML content as a dict.

    Raises:
        FileNotFoundError: If ``config/models.yaml`` does not exist.
    """
    with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class ModelFactory:
    """Factory that reads ``models.yaml`` and returns a concrete BaseModel instance.

    Callers never import model classes directly — they go through
    :meth:`create`.  Concrete classes are imported lazily so that loading
    one backend (e.g. PyTorch) does not pull in another (e.g. OpenVINO).

    Adding a new model requires only a ``models.yaml`` entry with a ``class``
    field — no changes to this file are needed.
    """

    @staticmethod
    def create(
        model_id: str,
        channel: "ProgressChannel | None" = None,
    ) -> "BaseModel":
        """Instantiate a model by its registry key.

        Resolves the model class from ``model_cfg["class"]`` via
        ``importlib``, resolves ``model_path`` from config or env var
        override, then constructs and returns the instance.

        Args:
            model_id: Key from ``models.yaml``, e.g. ``"phi3_pytorch"`` or
                ``"whisper_openvino"``.
            channel: Progress channel injected into the model at construction.
                ``None`` means no progress reporting.

        Returns:
            A concrete :class:`~src.benchmark.base.BaseModel` instance that
            has **not** yet been loaded.  Call ``.load()`` before inference.

        Raises:
            KeyError: If ``model_id`` is not found in ``models.yaml``.
            ValueError: If the model is disabled in config
                (``enabled: false``).
            ImportError: If the ``class`` field is missing or the module
                cannot be imported.
        """
        config = _load_config()
        models_cfg = config.get("models", {})

        if model_id not in models_cfg:
            raise KeyError(
                f"Model '{model_id}' not found in config. "
                f"Available: {list(models_cfg.keys())}"
            )

        model_cfg = models_cfg[model_id]

        if not model_cfg.get("enabled", True):
            raise ValueError(
                f"Model '{model_id}' is disabled in config/models.yaml. "
                "Set enabled: true to use it."
            )

        # Resolve class from YAML — no hard-coded registry needed
        class_dotted = model_cfg.get("class")
        if not class_dotted:
            raise ImportError(
                f"Model '{model_id}' has no 'class' field in models.yaml. "
                "Add e.g. 'class: src.slm.phi3_pytorch.Phi3PyTorch'."
            )
        module_path, class_name = class_dotted.rsplit(".", 1)
        module = importlib.import_module(module_path)
        cls = getattr(module, class_name)
        logger.debug(
            "creating model_id=%s class=%s",
            model_id, class_dotted,
            extra={"job_id": "-"},
        )

        # Resolve model path — env var takes priority over config file
        env_var = model_cfg.get("env_var")
        if env_var and os.environ.get(env_var):
            model_path = os.environ[env_var]
            logger.debug(
                "model_path resolved from env_var=%s",
                env_var,
                extra={"job_id": "-"},
            )
        else:
            model_path = model_cfg["model_path"]

        # Build constructor kwargs — common to all models
        kwargs: dict = {
            "model_id": model_id,
            "model_path": model_path,
            "channel": channel,
        }

        # SLM-only kwargs
        model_type = model_cfg.get("type", "")
        if model_type == "slm":
            if model_cfg.get("max_new_tokens"):
                kwargs["max_new_tokens"] = model_cfg["max_new_tokens"]
            if model_cfg.get("hub_id"):
                kwargs["hub_id"] = model_cfg["hub_id"]
            if model_cfg.get("compression"):
                kwargs["compression"] = model_cfg["compression"]
        elif model_type == "asr":
            # ASR constructors do not accept max_new_tokens (LSP fix)
            if model_cfg.get("hub_id"):
                kwargs["hub_id"] = model_cfg["hub_id"]

        instance = cls(**kwargs)
        instance._job_id = "-"  # factory sets default; runner/server override if needed
        return instance

    @staticmethod
    def available() -> list[str]:
        """Return the list of enabled model IDs from ``config/models.yaml``.

        Returns:
            Model IDs where ``enabled`` is ``true`` (or absent, which
            defaults to ``true``).
        """
        config = _load_config()
        return [
            mid for mid, cfg in config.get("models", {}).items()
            if cfg.get("enabled", True)
        ]
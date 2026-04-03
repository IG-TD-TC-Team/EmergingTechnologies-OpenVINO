"""Voxtral Mini 4B — OpenVINO INT4 (two-IR architecture).

Export strategy (first run only):

  IR A — encoder + projector (INT8, ~200 MB):
      ``VoxtralEncoder`` + ``VoxtralMultiModalProjector`` wrapped in a thin
      ``nn.Module`` and exported via ``ov.convert_model``.  The result maps
      mel spectrograms (batch, 128, 3000) directly to projected audio
      embeddings (n_audio_tokens, text_hidden_size).

  IR B — LLaMA/Mistral decoder (INT4, ~2 GB):
      ``model.language_model`` is saved as a standalone HuggingFace
      checkpoint and exported via ``OVModelForCausalLM.from_pretrained(
      export=True)``.  LLaMA / Mistral are natively registered in
      optimum-intel.  If the Voxtral text config uses an unregistered
      ``model_type``, it is temporarily patched to ``"mistral"`` (the
      architecture is Mistral-compatible: GQA, RoPE, grouped attention).

Inference glue:
  1. Process audio with ``VoxtralProcessor`` → mel chunks.
  2. Run IR A to obtain projected audio embeddings.
  3. Tokenize the conversation with audio placeholder tokens (id 24).
  4. Build ``inputs_embeds`` by looking up the saved embedding table and
     injecting audio embeddings at the placeholder positions.
  5. Run ``OVModelForCausalLM.generate(inputs_embeds=…)`` for the full
     prefill + decode loop.  The OV LM decoder is stateful (KV cache).
"""

import gc
import json
import logging
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Generator

import numpy as np
import torch

from src.benchmark.base import AudioSLMBase
from src.benchmark.resources import (
    check_ram,
    ov_thread_config,
    patch_nncf_compat,
    require_ram,
    safe_thread_count,
)

logger = logging.getLogger(__name__)




try:
    from optimum.intel import OVModelForCausalLM, OVWeightQuantizationConfig
    _OV_AVAILABLE = True
except ImportError:
    _OV_AVAILABLE = False

# Export RAM thresholds
_MIN_EXPORT_RAM = 12 * 1024 ** 3   # BF16 4B + headroom
_MIN_LOAD_RAM   =  4 * 1024 ** 3   # INT4 2B + encoder 200 MB

# model_types that optimum-intel registers for OVModelForCausalLM export
_OPTIMUM_CAUSAL_LM_TYPES = {
    "llama", "mistral", "mixtral", "qwen2", "phi", "phi3",
    "gemma", "gemma2", "falcon", "mpt", "gpt_neox", "opt",
    "bloom", "gpt2", "gptj", "codegen", "starcoder2",
}


class VoxtralOpenVINO(AudioSLMBase):
    """Voxtral Mini 4B Instruct — OpenVINO INT4 (encoder IR + LM decoder IR).

    On first use the model is downloaded from ``hub_id`` and exported into
    two OpenVINO IRs saved under ``model_path``.  Subsequent loads skip the
    export and go directly to OV compilation.

    Model layout on disk::

        models/voxtral-mini-4b-int4/
            encoder_projector.xml / .bin   (~200 MB INT8)
            lm/
                openvino_model.xml / .bin  (~2 GB INT4)
                config.json
                tokenizer*.json
                ...
            embed_tokens.npy               (embedding table, float32)
            voxtral_meta.json              (audio_token_id, n_audio_tokens_per_chunk, …)
            tokenizer*.json / processor*   (VoxtralProcessor artefacts)
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "mistralai/Voxtral-Mini-4B-Realtime-2602",
        channel=None,
    ):
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self._processor = None
        self._encoder_compiled = None   # ov.CompiledModel
        self._lm = None                 # OVModelForCausalLM
        self._embed_tokens: np.ndarray | None = None
        self._meta: dict = {}

    # ------------------------------------------------------------------
    # Load / unload
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Load both OV IRs and ancillary artefacts into CPU memory."""
        import openvino as ov
        from transformers import VoxtralRealtimeProcessor as VoxtralProcessor

        n_threads = safe_thread_count()
        self._report(f"OpenVINO inference thread count set to {n_threads} (2 cores reserved for OS)")

        local_path = Path(self.model_path)

        if not (local_path / "encoder_projector.xml").exists():
            check_ram(_MIN_EXPORT_RAM, "VoxtralOpenVINO export")
            self._report(
                f"model not found locally — exporting '{self.hub_id}' "
                "to OpenVINO INT4 (this may take 20-60 minutes, ~12 GB RAM peak)"
            )
            self._export(local_path)

        self._report("loading encoder+projector OV IR")
        core = ov.Core()
        self._encoder_compiled = core.compile_model(
            str(local_path / "encoder_projector.xml"),
            "CPU",
            {"INFERENCE_NUM_THREADS": str(n_threads)},
        )

        self._report("loading LM decoder OV IR")
        check_ram(_MIN_LOAD_RAM, "VoxtralOpenVINO LM")
        self._lm = OVModelForCausalLM.from_pretrained(
            str(local_path / "lm"),
            ov_config=ov_thread_config(),
            compile=True,
        )

        self._embed_tokens = np.load(str(local_path / "embed_tokens.npy"))
        self._meta = json.loads((local_path / "voxtral_meta.json").read_text())

        self._processor = VoxtralProcessor.from_pretrained(str(local_path))

    def unload(self) -> None:
        del self._lm
        del self._encoder_compiled
        del self._embed_tokens
        self._lm = None
        self._encoder_compiled = None
        self._embed_tokens = None
        self._processor = None
        self._meta = {}

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def run(self, audio_path: str, prompt: str = "") -> tuple[str, int]:
        """End-to-end audio→text generation on OpenVINO."""
        fused_embeds, attention_mask, n_input = self._prepare_inputs(audio_path, prompt)

        with torch.no_grad():
            output_ids = self._lm.generate(
                inputs_embeds=fused_embeds,
                attention_mask=attention_mask,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
            )

        # output_ids contains both the prefill tokens and generated tokens;
        # OVModelForCausalLM.generate with inputs_embeds returns only generated IDs.
        # Handle both cases gracefully.
        if output_ids.shape[-1] > self.max_new_tokens:
            new_ids = output_ids[0, n_input:]
        else:
            new_ids = output_ids[0]

        text = self._processor.tokenizer.decode(new_ids, skip_special_tokens=True)
        return text, int(new_ids.shape[0])

    def run_streaming(self, audio_path: str, prompt: str = "") -> Generator[str, None, tuple[str, int]]:
        """Yield tokens one by one via TextIteratorStreamer."""
        from transformers import TextIteratorStreamer

        fused_embeds, attention_mask, _ = self._prepare_inputs(audio_path, prompt)

        streamer = TextIteratorStreamer(
            self._processor.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )
        gen_kwargs = {
            "inputs_embeds": fused_embeds,
            "attention_mask": attention_mask,
            "max_new_tokens": self.max_new_tokens,
            "do_sample": False,
            "streamer": streamer,
        }
        thread = threading.Thread(target=self._lm.generate, kwargs=gen_kwargs)
        thread.start()

        tokens: list[str] = []
        for token in streamer:
            tokens.append(token)
            yield token

        thread.join()
        return "".join(tokens), len(tokens)

    # ------------------------------------------------------------------
    # Input preparation helpers
    # ------------------------------------------------------------------

    def _prepare_inputs(
        self, audio_path: str, prompt: str
    ) -> tuple[torch.Tensor, torch.Tensor, int]:
        """Load audio, run encoder OV IR, build fused embeddings.

        Returns:
            fused_embeds: (1, seq_len, text_hidden_size)
            attention_mask: (1, seq_len)
            n_input: sequence length (for slicing generated tokens)
        """
        import soundfile as sf
        import librosa

        audio, sr = sf.read(audio_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 16000:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

        instruction = prompt or "Please transcribe this audio."
        conversation = [{"role": "user", "content": [
            {"type": "audio"},
            {"type": "text", "text": instruction},
        ]}]
        inputs = self._processor.apply_chat_template(
            conversation,
            audio=[audio],
            sampling_rate=16000,
            return_tensors="pt",
            return_dict=True,
            tokenize=True,
            add_generation_prompt=True,
        )

        input_ids = inputs["input_ids"]           # (1, seq_len)
        attention_mask = inputs["attention_mask"]  # (1, seq_len)
        input_features = inputs.get("input_features")  # (n_chunks, 128, mel_len)

        seq_len = input_ids.shape[1]

        # --- encoder OV IR ---
        if input_features is not None:
            audio_embeds = self._run_encoder(input_features)  # (n_tokens, text_hidden)
        else:
            audio_embeds = None

        # --- build fused embeddings ---
        # Look up text embeddings for all tokens from saved embed_tokens table
        ids_np = input_ids[0].numpy()  # (seq_len,)
        text_embeds = torch.from_numpy(self._embed_tokens[ids_np]).unsqueeze(0)  # (1, seq, hidden)
        text_embeds = text_embeds.float()

        if audio_embeds is not None:
            audio_token_id = self._meta.get("audio_token_id", 24)
            audio_mask = (input_ids[0] == audio_token_id)  # (seq_len,) bool
            n_audio = int(audio_mask.sum().item())
            if n_audio > 0 and n_audio <= audio_embeds.shape[0]:
                fused = text_embeds.clone()
                fused[0, audio_mask] = audio_embeds[:n_audio].float()
            else:
                fused = text_embeds
        else:
            fused = text_embeds

        return fused, attention_mask, seq_len

    def _run_encoder(self, input_features: torch.Tensor) -> torch.Tensor:
        """Run the encoder+projector OV IR and return projected audio embeddings.

        Args:
            input_features: (n_chunks, num_mel_bins, mel_len) float32 tensor.

        Returns:
            audio_embeds: (n_audio_tokens, text_hidden_size) float32 tensor.
        """
        infer_req = self._encoder_compiled.create_infer_request()
        infer_req.infer({"input_features": input_features.float().numpy()})
        result = infer_req.get_output_tensor(0).data
        return torch.from_numpy(result.copy())

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def _export(self, local_path: Path) -> None:
        """Export encoder+projector (IR A) and LM decoder (IR B)."""
        patch_nncf_compat()

        from transformers import (
            VoxtralRealtimeForConditionalGeneration,
            VoxtralRealtimeProcessor,
        )

        local_path.mkdir(parents=True, exist_ok=True)

        self._report("FX+KV export: loading full model in BF16 (~8 GB)")
        model = VoxtralRealtimeForConditionalGeneration.from_pretrained(
            self.hub_id,
            torch_dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
        )
        model.eval()

        audio_cfg = model.config.audio_config
        # Projector input size = hidden_size × downsample_factor (both before and after
        # downsampling, the Linear layer needs this many features per token).
        projector_input_size = audio_cfg.hidden_size * model.config.downsample_factor
        num_mel_bins = audio_cfg.num_mel_bins
        # max_position_embeddings = encoder seq len after the stride-2 embedder conv.
        mel_input_len = audio_cfg.max_position_embeddings * 2  # stride=2 in conv2

        # Compute n_audio_tokens_per_chunk empirically (downsample_factor applied inside
        # get_audio_features; pooler_output shape: (batch, n_tokens, text_hidden)).
        with torch.no_grad():
            dummy_mel = torch.zeros(1, num_mel_bins, mel_input_len, dtype=torch.bfloat16)
            audio_out = model.get_audio_features(input_features=dummy_mel, return_dict=True)
            test_embeds = audio_out.pooler_output  # (1, n_tokens, text_hidden)
        n_audio_tokens_per_chunk = int(test_embeds.shape[1])
        text_hidden_size = int(test_embeds.shape[2])
        self._report(
            f"encoder: {num_mel_bins} mel bins x {mel_input_len} frames "
            f"-> {n_audio_tokens_per_chunk} audio tokens/chunk, "
            f"hidden={text_hidden_size}"
        )

        # --- Save embed_tokens ---
        embed_w = model.get_input_embeddings().weight.detach().float().numpy()
        np.save(str(local_path / "embed_tokens.npy"), embed_w)
        self._report(f"embed_tokens.npy saved  shape={embed_w.shape}")

        # --- Save meta ---
        meta = {
            "audio_token_id": int(getattr(model.config, "audio_token_id", -1)),
            "n_audio_tokens_per_chunk": n_audio_tokens_per_chunk,
            "text_hidden_size": text_hidden_size,
            "projector_input_size": projector_input_size,
            "mel_input_len": mel_input_len,
        }
        (local_path / "voxtral_meta.json").write_text(json.dumps(meta, indent=2))

        # --- Export IR A: encoder + projector ---
        self._export_encoder(local_path, model, projector_input_size, num_mel_bins, mel_input_len)

        # --- Export IR B: LM decoder ---
        self._export_lm(local_path, model)

        # --- Save processor ---
        proc = VoxtralRealtimeProcessor.from_pretrained(self.hub_id)
        proc.save_pretrained(str(local_path))

        # --- Free memory ---
        del model
        gc.collect()
        self._report("export complete — model saved to '{}'".format(self.model_path))

    def _export_encoder(
        self,
        local_path: Path,
        model,
        projector_input_size: int,
        num_mel_bins: int,
        mel_input_len: int,
    ) -> None:
        """Export audio_tower + multi_modal_projector as one OV IR (INT8).

        ``projector_input_size`` = ``audio_config.hidden_size * downsample_factor``.
        The reshape merges ``downsample_factor`` consecutive encoder tokens so the
        projector Linear receives ``(batch * n_out_tokens, projector_input_size)``.
        """
        import openvino as ov
        import nncf

        class _AudioWrapper(torch.nn.Module):
            def __init__(self_, tower, projector, proj_in_sz):
                super().__init__()
                self_.tower = tower
                self_.projector = projector
                self_.proj_in_sz = proj_in_sz

            def forward(self_, input_features):  # (batch, mel_bins, mel_len) float32
                h = self_.tower(input_features).last_hidden_state  # (batch, seq, hidden)
                h = h.reshape(-1, self_.proj_in_sz)  # (batch * n_out_tokens, proj_in_sz)
                return self_.projector(h)             # (batch * n_out_tokens, text_hidden)

        wrapper = _AudioWrapper(
            model.audio_tower, model.multi_modal_projector, projector_input_size
        )
        wrapper.eval()

        example = torch.zeros(1, num_mel_bins, mel_input_len, dtype=torch.bfloat16)
        self._report("encoder export: converting to OV IR")
        ov_enc = ov.convert_model(wrapper, example_input=(example,))

        self._report("encoder export: applying NNCF INT8 compression")
        ov_enc = nncf.compress_weights(ov_enc, mode=nncf.CompressWeightsMode.INT8_SYM)

        ov.save_model(ov_enc, str(local_path / "encoder_projector.xml"))
        self._report("encoder_projector.xml saved")

    def _export_lm(self, local_path: Path, model) -> None:
        """Export language_model submodule as OVModelForCausalLM (INT4)."""
        lm_out = local_path / "lm"
        lm_out.mkdir(parents=True, exist_ok=True)
        tmp_dir = Path(tempfile.mkdtemp(prefix="voxtral_lm_"))

        try:
            self._report("LM export: saving language_model submodule")
            lm = model.language_model
            lm.save_pretrained(str(tmp_dir))

            model_type = lm.config.model_type
            self._report(f"LM export: model_type={model_type}")

            if model_type not in _OPTIMUM_CAUSAL_LM_TYPES:
                self._report(
                    f"LM model_type '{model_type}' not in optimum registry — "
                    "patching to 'mistral' for export (Voxtral LM is Mistral-compatible)"
                )
                cfg_path = tmp_dir / "config.json"
                cfg_data = json.loads(cfg_path.read_text())
                cfg_data["model_type"] = "mistral"
                cfg_path.write_text(json.dumps(cfg_data, indent=2))

            quant_config = OVWeightQuantizationConfig(bits=4, sym=True, ratio=1.0, group_size=-1)
            self._report("LM export: exporting via OVModelForCausalLM (INT4) — this may take 10-30 min")
            ov_lm = OVModelForCausalLM.from_pretrained(
                str(tmp_dir),
                export=True,
                quantization_config=quant_config,
                ov_config=ov_thread_config(),
            )
            ov_lm.save_pretrained(str(lm_out))
            self._report(f"LM decoder saved to '{lm_out}'")

        finally:
            shutil.rmtree(str(tmp_dir), ignore_errors=True)

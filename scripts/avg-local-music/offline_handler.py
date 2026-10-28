"""Use the reviewed upstream handler with explicit local-only loaders.

The official runtime class and configuration are loaded from the pinned code
checkout. Model-side Python files retain their original bytes and are unused.
"""
from pathlib import Path
import os
import sys

from haar_correction import HaarCorrector


def make_handler(source_root, model_root, wavelet_observer):
    source_root, model_root = Path(source_root).resolve(), Path(model_root).resolve()
    loaded = sys.modules.get("acestep")
    if loaded is not None and not Path(loaded.__file__).resolve().is_relative_to(source_root):
        raise ValueError("Another upstream package was already imported")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      ACESTEP_CHECKPOINTS_DIR=str(model_root), TOKENIZERS_PARALLELISM="false")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source_root))
    import torch
    from acestep.handler import AceStepHandler
    from acestep.models.turbo.configuration_acestep_v15 import AceStepConfig
    from acestep.models.turbo import modeling_acestep_v15_turbo as modeling

    class ObservedHaar(HaarCorrector):
        def apply(self, x_next, denoised, t_curr):
            result = super().apply(x_next, denoised, t_curr)
            if self.is_active:
                wavelet_observer()
            return result

    # An explicit adapter backend, recorded in the evaluation receipt. This
    # preserves the selected ordinary Haar math without importing DTCWT code.
    modeling.DCWCorrector = ObservedHaar

    class OfflineHandler(AceStepHandler):
        def _ensure_models_present(self, *, checkpoint_path, config_path, prefer_source, vae_variant=None):
            if Path(checkpoint_path).resolve() != model_root or config_path != "acestep-v15-turbo" or vae_variant != "official":
                raise ValueError("Only the verified local instrumental snapshot is supported")
            return None

        @staticmethod
        def _sync_model_code_if_needed(config_path, checkpoint_path):
            if config_path != "acestep-v15-turbo" or Path(checkpoint_path).resolve() != model_root:
                raise ValueError("Unexpected model code synchronization request")
            # The reviewed runtime class below is intentional and separately
            # identified. Never rewrite the original model snapshot to use it.

        def _load_main_model_from_checkpoint(self, *, model_checkpoint_path, device, use_flash_attention, compile_model, quantization):
            if Path(model_checkpoint_path).resolve() != model_root / "acestep-v15-turbo" or use_flash_attention or compile_model or quantization is not None:
                raise ValueError("Unsupported model loader profile")
            config = AceStepConfig.from_pretrained(model_checkpoint_path, local_files_only=True)
            self.model = modeling.AceStepConditionGenerationModel.from_pretrained(
                model_checkpoint_path, config=config, local_files_only=True,
                dtype=self.dtype, attn_implementation="sdpa").to(device).eval()
            self.config = self.model.config
            self._sync_alignment_config()
            self.silence_latent = torch.load(model_root / "acestep-v15-turbo/silence_latent.pt",
                                            map_location="cpu", weights_only=True).transpose(1, 2).to(device=device, dtype=self.dtype)
            return "sdpa"

        def _load_vae_model(self, *, checkpoint_dir, device, compile_model, vae_variant=None):
            if Path(checkpoint_dir).resolve() != model_root or vae_variant != "official" or compile_model:
                raise ValueError("Only the official verified local VAE is supported")
            from diffusers.models import AutoencoderOobleck
            path = model_root / "vae"
            self.vae = AutoencoderOobleck.from_pretrained(str(path), local_files_only=True,
                                                        torch_dtype=torch.float32).to(device).eval()
            return str(path)

        def _load_text_encoder_and_tokenizer(self, *, checkpoint_dir, device):
            if Path(checkpoint_dir).resolve() != model_root:
                raise ValueError("Unexpected text encoder location")
            from transformers import AutoModel, AutoTokenizer
            path = str(model_root / "Qwen3-Embedding-0.6B")
            self.text_tokenizer = AutoTokenizer.from_pretrained(path, local_files_only=True)
            self.text_encoder = AutoModel.from_pretrained(path, local_files_only=True,
                                                         dtype=self.dtype).to(device).eval()
            return path

        def _initialize_mlx_backends(self, **_):
            self.use_mlx_dit = False
            self.use_mlx_vae = False
            return "Disabled for this explicit evaluation", "Disabled for this explicit evaluation"

    return OfflineHandler()

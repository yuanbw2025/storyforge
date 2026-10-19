"""Ordinary pairwise Haar math for the fixed instrumental evaluation profile.

No DTCWT implementation, filters, data or mixed-license wavelet package is used.
The adapter exposes the upstream MIT sampler's correction interface and records
this backend separately from the unchanged upstream source and model bytes.
"""
import math

BACKEND_ID = "storyforge.haar-dcw-v1"


def haar_pair(value):
    import torch
    if value.ndim != 3 or value.shape[1] < 1 or not value.is_floating_point():
        raise ValueError("Haar expects nonempty floating [batch, time, channels]")
    work = value.to(torch.float32)
    if work.shape[1] % 2:
        work = torch.nn.functional.pad(work, (0, 0, 0, 1))
    even, odd = work[:, 0::2], work[:, 1::2]
    return (even + odd) / math.sqrt(2), (even - odd) / math.sqrt(2)


def inverse_pair(low, high, length):
    import torch
    if low.ndim != 3 or low.shape != high.shape or not 0 < length <= low.shape[1] * 2:
        raise ValueError("Invalid Haar reconstruction dimensions")
    even, odd = (low + high) / math.sqrt(2), (low - high) / math.sqrt(2)
    return torch.stack((even, odd), dim=2).flatten(1, 2)[:, :length].contiguous()


class HaarCorrector:
    def __init__(self, enabled=False, mode="double", scaler=0.05, high_scaler=0.02, wavelet="haar"):
        if type(enabled) is not bool or mode not in ("low", "high", "double", "pix") or wavelet != "haar":
            raise ValueError("Only the declared ordinary Haar correction is supported")
        if any(isinstance(v, bool) or not math.isfinite(v) or not 0 <= v <= 1 for v in (scaler, high_scaler)):
            raise ValueError("Correction strengths must be finite and within [0,1]")
        self.enabled, self.mode = enabled, mode
        self.scaler, self.high_scaler = float(scaler), float(high_scaler)

    @property
    def is_active(self):
        return self.enabled and (self.scaler != 0 or self.mode == "double" and self.high_scaler != 0)

    def apply(self, x_next, denoised, t_curr):
        if not self.is_active:
            return x_next
        if x_next.shape != denoised.shape or x_next.device != denoised.device:
            raise ValueError("Correction requires matching tensors")
        time = float(t_curr)
        if not math.isfinite(time) or not 0 <= time <= 1:
            raise ValueError("Correction time must be within [0,1]")
        if self.mode == "pix":
            return x_next + self.scaler * (x_next - denoised)
        low, high = haar_pair(x_next)
        clean_low, clean_high = haar_pair(denoised)
        if self.mode in ("low", "double"):
            low = low + time * self.scaler * (low - clean_low)
        if self.mode in ("high", "double"):
            strength = (1 - time) * (self.high_scaler if self.mode == "double" else self.scaler)
            high = high + strength * (high - clean_high)
        return inverse_pair(low, high, x_next.shape[1]).to(dtype=x_next.dtype)

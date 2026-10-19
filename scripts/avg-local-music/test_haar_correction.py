"""Independent energy, reconstruction and PyWavelets numerical comparisons."""
import unittest
import numpy as np
import pywt
import torch
from haar_correction import HaarCorrector, haar_pair, inverse_pair


class HaarTests(unittest.TestCase):
    def test_round_trip_and_energy_for_odd_even_and_single_time(self):
        for length in (1, 2, 7, 16, 301):
            with self.subTest(length=length):
                x = torch.linspace(-2, 3, 2 * length * 3).reshape(2, length, 3)
                before = x.clone()
                low, high = haar_pair(x)
                torch.testing.assert_close(inverse_pair(low, high, length), x, rtol=1e-6, atol=1e-6)
                torch.testing.assert_close(low.square().sum() + high.square().sum(), x.square().sum())
                self.assertTrue(torch.equal(x, before))

    def test_correction_matches_independent_pywavelets_haar_and_zero_padding(self):
        generator = torch.Generator().manual_seed(103)
        for length in (1, 5, 20):
            x = torch.randn(2, length, 4, generator=generator)
            y = torch.randn(2, length, 4, generator=generator)
            for mode in ("low", "high", "double"):
                for time in (0, .35, 1):
                    with self.subTest(length=length, mode=mode, time=time):
                        xl, xh = pywt.dwt(x.numpy(), "haar", mode="zero", axis=1)
                        yl, yh = pywt.dwt(y.numpy(), "haar", mode="zero", axis=1)
                        if mode in ("low", "double"):
                            xl = xl + time * .05 * (xl - yl)
                        if mode in ("high", "double"):
                            xh = xh + (1 - time) * (.02 if mode == "double" else .05) * (xh - yh)
                        expected = pywt.idwt(xl, xh, "haar", mode="zero", axis=1)[:, :length]
                        actual = HaarCorrector(enabled=True, mode=mode).apply(x, y, time)
                        np.testing.assert_allclose(actual.numpy(), expected, rtol=2e-6, atol=1e-6)

    def test_disabled_zero_and_pixel_modes_preserve_the_declared_behavior(self):
        x = torch.ones(1, 5, 2)
        y = torch.zeros_like(x)
        self.assertIs(HaarCorrector().apply(x, y, .5), x)
        self.assertIs(HaarCorrector(enabled=True, scaler=0, high_scaler=0).apply(x, y, .5), x)
        torch.testing.assert_close(HaarCorrector(enabled=True, mode="pix", scaler=.2).apply(x, y, .5), x * 1.2)

    def test_half_input_preserves_dtype_and_fails_on_unsupported_arguments(self):
        x = torch.ones(1, 3, 2, dtype=torch.float16)
        self.assertEqual(HaarCorrector(enabled=True).apply(x, x, .5).dtype, x.dtype)
        for arguments in ({"wavelet": "db4"}, {"mode": "unknown"}, {"scaler": float("nan")}, {"enabled": 1}, {"scaler": -1}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                HaarCorrector(**arguments)
        for time in (-.01, 1.01, float("nan")):
            with self.subTest(time=time), self.assertRaises(ValueError):
                HaarCorrector(enabled=True).apply(x, x, time)
        with self.assertRaises(ValueError):
            HaarCorrector(enabled=True).apply(x, x[:, :1], .5)


if __name__ == "__main__":
    unittest.main()

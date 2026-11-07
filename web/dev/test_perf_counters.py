"""Tests for perf_counters.py. Run: python3 -I web/dev/test_perf_counters.py (from the repo root)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perf_counters as pc  # noqa: E402

SAMPLE = """\
227496412,,cycles:u,37886988,100.00,,
632048409,,instructions:u,48729385,100.00,,
<not supported>,,L1-dcache-loads:u,0,0.00,,
39020703,,L1-dcache-load-misses:u,48559244,68.00,,
"""


class ParseTests(unittest.TestCase):
    def test_counts_and_percentages(self):
        got = pc.parse_perf_csv(SAMPLE)
        self.assertEqual(got["cycles"], (227496412, 100.0))
        self.assertEqual(got["L1-dcache-load-misses"], (39020703, 68.0))

    def test_unsupported_event_is_none_not_zero(self):
        self.assertIsNone(pc.parse_perf_csv(SAMPLE)["L1-dcache-loads"][0])

    def test_ignores_noise_lines(self):
        self.assertEqual(pc.parse_perf_csv("# started on Sat\n\nwarning: x\n"), {})


class ArithmeticTests(unittest.TestCase):
    def test_net_subtracts_baseline_and_clamps_at_zero(self):
        net = pc.net_counts({"a": 10, "b": 3, "c": None, "d": 5}, {"a": 4, "b": 9, "c": 1})
        self.assertEqual(net, {"a": 6, "b": 0, "c": None, "d": None})

    def test_derive_rates_and_ipc(self):
        out = pc.derive({"L1-dcache-loads": 100.0, "L1-dcache-load-misses": 25.0,
                         "LLC-loads": None, "LLC-load-misses": None,
                         "dTLB-loads": 0.0, "dTLB-load-misses": 0.0,
                         "cycles": 200.0, "instructions": 300.0})
        self.assertEqual(out["l1d_miss_rate"], 0.25)
        self.assertIsNone(out["llc_miss_rate"])
        self.assertIsNone(out["dtlb_miss_rate"])  # no loads: no rate
        self.assertEqual(out["ipc"], 1.5)

    def test_median_is_none_if_any_sample_is_missing(self):
        self.assertEqual(pc.median_of([1, 5, 3]), 3)
        self.assertIsNone(pc.median_of([1, None, 3]))

    def test_every_group_fits_a_four_counter_pmu_alongside_the_fixed_events(self):
        for group in pc.GROUPS:
            self.assertLessEqual(len(group), 4)


if __name__ == "__main__":
    unittest.main()

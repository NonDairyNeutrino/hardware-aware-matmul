"""Tests for results.py. Run: python3 -I web/dev/test_results.py (from the repo root)."""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import results  # noqa: E402

HASHES = {64: "aaaa", 128: "bbbb"}


def report(kind, threads, **extra):
    runs = []
    for n in (64, 128):
        runs.append({"level": 0, "n": n, "threads": 1, "times_ms": [4.0, 2.0, 3.0], "hash": HASHES[n]})
        for level in range(1, 5):
            for t in threads:
                runs.append({"level": level, "n": n, "threads": t, "times_ms": [2.0, 1.0, 1.5], "hash": HASHES[n]})
    out = {"kind": kind, "ok": True, "cores": 8, "runs": runs,
           "parameters": {"sizes": [64, 128], "repeats": 3, "warmup": 1, "block": [32, 64], "tile": [128, 128, 128]}}
    out.update(extra)
    return out


def reports():
    native = report("native", [1, 2], isa="SSE2", micro_tile=[4, 4])
    lite = report("browser-lite", [1], env={"isa": "none (scalar code)"})
    threads = report("browser-threads", [1, 2], env={"isa": "none (scalar code)"}, pool_threads=8)
    return native, lite, threads


ENV = {"cpu": "test cpu"}


class AssembleTests(unittest.TestCase):
    def build(self, native, lite, threads):
        return results.assemble(native, lite, threads, ENV, "2026-01-01T00:00:00Z")

    def test_assembles_and_summarises(self):
        document = self.build(*reports())
        self.assertEqual(document["schema"], 1)
        self.assertEqual(document["parameters"]["threads"],
                         {"native": [1, 2], "browser-lite": [1], "browser-threads": [1, 2]})
        # native: 2 sizes x (1 + 4 levels x 2 threads); lite: 2 x (1 + 4); threads: like native
        self.assertEqual(len(document["runs"]), 18 + 10 + 18)
        first = document["runs"][0]
        self.assertEqual((first["environment"], first["level"], first["n"]), ("native", 0, 64))
        self.assertEqual(first["median_ms"], 3.0)
        self.assertEqual((first["min_ms"], first["max_ms"]), (2.0, 4.0))
        # 2 * 64^3 flops in 3 ms
        self.assertAlmostEqual(first["gflops"], 2 * 64 ** 3 / 0.003 / 1e9, places=3)

    def test_disagreeing_hashes_are_refused(self):
        native, lite, threads = reports()
        threads["runs"][7]["hash"] = "cccc"
        with self.assertRaisesRegex(results.ResultsError, "disagree"):
            self.build(native, lite, threads)

    def test_a_missing_case_is_refused(self):
        native, lite, threads = reports()
        del lite["runs"][3]
        with self.assertRaisesRegex(results.ResultsError, "browser-lite: wrong set of cases"):
            self.build(native, lite, threads)

    def test_a_duplicate_case_is_refused(self):
        native, lite, threads = reports()
        native["runs"].append(copy.deepcopy(native["runs"][0]))
        with self.assertRaisesRegex(results.ResultsError, "native: wrong set of cases"):
            self.build(native, lite, threads)

    def test_a_wrong_number_of_repeats_is_refused(self):
        native, lite, threads = reports()
        native["runs"][1]["times_ms"] = [1.0, 2.0]
        with self.assertRaisesRegex(results.ResultsError, "repeats"):
            self.build(native, lite, threads)

    def test_runs_with_different_parameters_are_refused(self):
        native, lite, threads = reports()
        lite["parameters"]["repeats"] = 5
        with self.assertRaisesRegex(results.ResultsError, "different repeats"):
            self.build(native, lite, threads)

    def test_a_failed_report_is_refused(self):
        native, lite, threads = reports()
        threads["ok"] = False
        threads["error"] = "boom"
        with self.assertRaisesRegex(results.ResultsError, "boom"):
            self.build(native, lite, threads)

    def test_non_positive_time_is_refused(self):
        native, lite, threads = reports()
        native["runs"][0]["times_ms"] = [0.0, 1.0, 2.0]
        with self.assertRaisesRegex(results.ResultsError, "non-positive"):
            self.build(native, lite, threads)

    def test_check_accepts_what_assemble_writes(self):
        results.check(self.build(*reports()))


if __name__ == "__main__":
    unittest.main()

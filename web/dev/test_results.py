"""Tests for results.py. Run: python3 -I web/dev/test_results.py (from the repo root)."""
import copy
import json
import os
import subprocess
import sys
import tempfile
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
    lite = report("browser-lite", [1], env={"isa": "none (scalar code)"}, isolated=False)
    threads = report("browser-threads", [1, 2], env={"isa": "none (scalar code)"}, pool_threads=8,
                     isolated=True)
    return native, lite, threads


ENV = {
    "cpu": "test cpu",
    "toolchains": {"native": "rustc nightly", "browser-lite": "rustc stable", "browser-threads": "rustc nightly"},
    "firefox": "Mozilla Firefox 1",
    "commit": "abc123",
}


class AssembleTests(unittest.TestCase):
    def build(self, native, lite, threads, environment=ENV, **kwargs):
        return results.assemble(native, lite, threads, environment, "2026-01-01T00:00:00Z", **kwargs)

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

    def test_spread_is_computed(self):
        first = self.build(*reports())["runs"][0]
        # times 4, 2, 3: (4 - 2) / 3
        self.assertEqual(first["spread"], round(2 / 3, 4))

    def test_the_environment_gets_the_browser_facts(self):
        env = self.build(*reports())["environment"]
        self.assertEqual(env["browser_cores"], 8)
        self.assertEqual(env["browser_isolated"], {"browser-lite": False, "browser-threads": True})
        self.assertEqual(env["browser_isa"], "none (scalar code)")

    def test_a_hand_edited_median_is_refused(self):
        document = self.build(*reports())
        document["runs"][0]["median_ms"] = 2.5
        with self.assertRaisesRegex(results.ResultsError, "median_ms"):
            results.check(document)

    def test_an_edited_gflops_is_refused(self):
        document = self.build(*reports())
        document["runs"][0]["gflops"] *= 2
        with self.assertRaisesRegex(results.ResultsError, "gflops"):
            results.check(document)

    def test_an_edited_spread_min_or_max_is_refused(self):
        for key in ("spread", "min_ms", "max_ms"):
            document = self.build(*reports())
            document["runs"][0][key] += 1
            with self.assertRaisesRegex(results.ResultsError, key):
                results.check(document)

    def test_an_unknown_environment_is_refused(self):
        document = self.build(*reports())
        extra = copy.deepcopy(document["runs"][0])
        extra["environment"] = "bogus"
        document["runs"].append(extra)
        with self.assertRaisesRegex(results.ResultsError, "bogus"):
            results.check(document)

    def test_malformed_documents_are_errors_not_tracebacks(self):
        document = self.build(*reports())
        del document["runs"][0]["level"]
        with self.assertRaisesRegex(results.ResultsError, "malformed"):
            results.check(document)
        document = self.build(*reports())
        document["runs"][0]["times_ms"][1] = None
        with self.assertRaisesRegex(results.ResultsError, "malformed"):
            results.check(document)
        document = self.build(*reports())
        del document["parameters"]
        with self.assertRaisesRegex(results.ResultsError, "malformed"):
            results.check(document)

    def test_the_repeats_message_shows_the_real_count(self):
        document = self.build(*reports())
        document["runs"][1]["times_ms"] = [1.0, 2.0]
        with self.assertRaisesRegex(results.ResultsError, "2 repeats, expected 3"):
            results.check(document)

    def test_swapped_slots_are_refused(self):
        native, lite, threads = reports()
        with self.assertRaisesRegex(results.ResultsError, "kind"):
            self.build(native, threads, lite)

    def test_different_browser_isas_are_refused(self):
        native, lite, threads = reports()
        threads["env"]["isa"] = "SSE2"
        with self.assertRaisesRegex(results.ResultsError, "different instruction sets"):
            self.build(native, lite, threads)

    def test_block_and_tile_must_match_native(self):
        for key, value in (("block", [16, 16]), ("tile", [64, 64, 64])):
            native, lite, threads = reports()
            threads["parameters"][key] = value
            with self.assertRaisesRegex(results.ResultsError, key):
                self.build(native, lite, threads)
        native, lite, threads = reports()
        del lite["parameters"]["block"]
        with self.assertRaisesRegex(results.ResultsError, "block"):
            self.build(native, lite, threads)

    def test_unknown_environment_info_is_refused_unless_allowed(self):
        for change in (lambda e: e.update(cpu=None), lambda e: e["toolchains"].update({"native": None}),
                       lambda e: e.update(firefox=None), lambda e: e.update(commit=None)):
            env = copy.deepcopy(ENV)
            change(env)
            with self.assertRaisesRegex(results.ResultsError, "unknown"):
                self.build(*reports(), environment=env)
            self.build(*reports(), environment=env, allow_unknown=True)


PROBE = {"triad_gbs": {"1": 20.5, "2": 30.25}, "peak_gflops": {"1": 14.0, "2": 27.5},
         "params": {"mib_per_array": 64, "repeats": 5, "note": "24 bytes per element"}}
COMMITTED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "src", "data", "results.json")


class ProbeTests(unittest.TestCase):
    def build(self, probe=None, caches=None):
        env = dict(ENV)
        if caches is not None:
            env["caches"] = caches
        return results.assemble(*reports(), env, "2026-01-01T00:00:00Z", probe=probe)

    def test_without_a_probe_there_is_no_hardware_key(self):
        env = self.build()["environment"]
        self.assertNotIn("hardware", env)
        self.assertNotIn("caches", env)

    def test_the_probe_is_recorded_under_environment_hardware(self):
        document = self.build(probe=copy.deepcopy(PROBE))
        self.assertEqual(document["environment"]["hardware"], PROBE)
        results.check(document)

    def test_caches_are_kept_and_checked(self):
        caches = [{"level": 1, "type": "Data", "size_bytes": 32768, "shared_cpu_list": "0,4"}]
        document = self.build(caches=caches)
        self.assertEqual(document["environment"]["caches"], caches)
        document["environment"]["caches"][0]["size_bytes"] = -1
        with self.assertRaisesRegex(results.ResultsError, "caches"):
            results.check(document)

    def test_malformed_probes_are_refused(self):
        def broken(mutate):
            probe = copy.deepcopy(PROBE)
            mutate(probe)
            with self.assertRaisesRegex(results.ResultsError, "hardware"):
                self.build(probe=probe)
        broken(lambda p: p["triad_gbs"].update({"1": -3.0}))
        broken(lambda p: p["triad_gbs"].update({"1": 0}))
        broken(lambda p: p["peak_gflops"].update({"1": "fast"}))
        broken(lambda p: p["peak_gflops"].update({"1": True}))
        broken(lambda p: p["triad_gbs"].update({"two": 1.0}))
        broken(lambda p: p["triad_gbs"].update({"16": 1.0}))  # not a native thread count
        broken(lambda p: p.pop("peak_gflops"))
        broken(lambda p: p.update({"params": []}))

    def test_a_probe_with_nan_is_refused(self):
        probe = copy.deepcopy(PROBE)
        probe["triad_gbs"]["1"] = float("nan")
        with self.assertRaisesRegex(results.ResultsError, "hardware"):
            self.build(probe=probe)

    def test_the_committed_results_still_pass_check(self):
        result = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(results.__file__), "results.py"),
                                 "--check", COMMITTED], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("is valid", result.stdout)

    def test_probe_flag_assembles_with_hardware(self):
        # main() reads the probe file and passes it on
        with tempfile.TemporaryDirectory() as tmp:
            paths = {}
            for name, report_ in zip(("native", "lite", "threads"), reports()):
                paths[name] = os.path.join(tmp, name + ".json")
                json.dump(report_, open(paths[name], "w"))
            paths["probe"] = os.path.join(tmp, "probe.json")
            json.dump(PROBE, open(paths["probe"], "w"))
            out = os.path.join(tmp, "out.json")
            code = results.main(["--native", paths["native"], "--lite", paths["lite"], "--threads", paths["threads"],
                                 "--probe", paths["probe"], "--out", out, "--allow-unknown"])
            self.assertEqual(code, 0)
            self.assertEqual(json.load(open(out))["environment"]["hardware"], PROBE)


class CacheTests(unittest.TestCase):
    def test_sizes_are_parsed_to_bytes(self):
        self.assertEqual(results._parse_size("32K"), 32768)
        self.assertEqual(results._parse_size("256K\n"), 262144)
        self.assertEqual(results._parse_size("8192K"), 8 * 1024 * 1024)
        self.assertEqual(results._parse_size("8M"), 8 * 1024 * 1024)
        self.assertEqual(results._parse_size("1G"), 1024 ** 3)
        self.assertEqual(results._parse_size("512"), 512)
        for bad in ("", "K", "-4K", "0K", "x", "1.5M", None):
            self.assertIsNone(results._parse_size(bad), bad)

    def write_index(self, root, index, **files):
        directory = os.path.join(root, "index%d" % index)
        os.makedirs(directory)
        for name, text in files.items():
            with open(os.path.join(directory, name), "w") as handle:
                handle.write(text)

    def test_caches_from_a_fake_sysfs(self):
        with tempfile.TemporaryDirectory() as root:
            self.write_index(root, 0, level="1\n", type="Data\n", size="32K\n", shared_cpu_list="0,4\n")
            self.write_index(root, 1, level="1\n", type="Instruction\n", size="32K\n", shared_cpu_list="0,4\n")
            self.write_index(root, 2, level="2\n", type="Unified\n", size="256K\n", shared_cpu_list="0,4\n")
            self.write_index(root, 3, level="3\n", type="Unified\n", size="8M\n", shared_cpu_list="0-7\n")
            self.write_index(root, 4, level="x", type="Unified\n", size="8M\n", shared_cpu_list="0\n")  # malformed
            self.write_index(root, 5, level="4\n", type="Unified\n", size="oops\n", shared_cpu_list="0\n")  # malformed
            self.write_index(root, 6, level="4\n")  # missing files
            self.assertEqual(results.collect_caches(root), [
                {"level": 1, "type": "Data", "size_bytes": 32768, "shared_cpu_list": "0,4"},
                {"level": 1, "type": "Instruction", "size_bytes": 32768, "shared_cpu_list": "0,4"},
                {"level": 2, "type": "Unified", "size_bytes": 262144, "shared_cpu_list": "0,4"},
                {"level": 3, "type": "Unified", "size_bytes": 8 * 1024 * 1024, "shared_cpu_list": "0-7"},
            ])

    def test_a_missing_directory_is_none(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(results.collect_caches(os.path.join(root, "nope")))

    def test_an_empty_directory_is_none(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(results.collect_caches(root))

    def test_collect_environment_records_caches_when_present(self):
        with tempfile.TemporaryDirectory() as root:
            self.write_index(root, 0, level="1", type="Data", size="32K", shared_cpu_list="0")
            env = results.collect_environment(reports()[0], cache_dir=root)
            self.assertEqual(env["caches"][0]["size_bytes"], 32768)
            env = results.collect_environment(reports()[0], cache_dir=os.path.join(root, "nope"))
            self.assertNotIn("caches", env)


class EnvironmentTests(unittest.TestCase):
    def test_a_failing_command_is_none(self):
        self.assertIsNone(results._run("definitely-not-a-command-xyz"))
        self.assertIsNone(results._run("false"))
        self.assertEqual(results._run("echo", "hi"), "hi")

    def test_physical_cores_count_distinct_pairs(self):
        text = ("physical id\t: 0\ncore id\t: 0\n\nphysical id\t: 0\ncore id\t: 0\n\n"
                "physical id\t: 0\ncore id\t: 1\n\nphysical id\t: 1\ncore id\t: 0\n")
        self.assertEqual(results._count_physical_cores(text), 3)
        self.assertIsNone(results._count_physical_cores("model name\t: x\n"))

    def test_load_average_start_comes_from_the_environment(self):
        old = os.environ.get("BENCH_LOAD_START")
        try:
            os.environ["BENCH_LOAD_START"] = "0.25"
            self.assertEqual(results._load_average_start(), 0.25)
            os.environ["BENCH_LOAD_START"] = "oops"
            self.assertIsNone(results._load_average_start())
            del os.environ["BENCH_LOAD_START"]
            self.assertIsNone(results._load_average_start())
        finally:
            if old is not None:
                os.environ["BENCH_LOAD_START"] = old

    def test_collect_environment_has_the_documented_fields(self):
        env = results.collect_environment(reports()[0])
        for key in ("cpu", "logical_cores", "physical_cores", "governor", "on_ac_power", "load_average_start",
                    "toolchains", "wasm_bindgen_cli", "wasm_target_features", "rustflags", "firefox", "commit",
                    "native_isa", "native_micro_tile", "os"):
            self.assertIn(key, env)
        self.assertEqual(set(env["toolchains"]), {"native", "browser-lite", "browser-threads"})


if __name__ == "__main__":
    unittest.main()

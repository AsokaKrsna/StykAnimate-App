"""Fingerprint compatibility against the pre-streaming whole-document encoder."""
import copy
import hashlib
import json
import math
import tracemalloc
import unittest

import server


def reference_digest(document, *, canonical=True, runtime_aliases=False):
    # Independent historical oracle: do not call either production hash path.
    def normalize(value):
        if isinstance(value, float) and math.isfinite(value) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [normalize(item) for item in value]
        return value
    value = {key: item for key, item in document.items() if key not in ("_stykSource", "_styk", "_stykWeb")}
    if canonical:
        value = normalize(value)
        if not runtime_aliases:
            for frame in value.get("keyframes", []):
                for obj in frame.get("objects", []):
                    obj.pop("runtime_segments", None)
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True,
        allow_nan=False, separators=(",", ":")).encode("ascii")).hexdigest()


class DocumentDigestTests(unittest.TestCase):
    def test_temporary_fingerprint_memory_does_not_grow_with_timeline_length(self):
        frame = {"objects": [{"angles": [float(i) for i in range(512)], "runtime_segments": [0] * 512}]}
        def peak(document, encode):
            tracemalloc.start()
            try:
                encode(document)
                return tracemalloc.get_traced_memory()[1]
            finally:
                tracemalloc.stop()
        one = {"keyframes": [frame]}
        many = {"keyframes": [copy.deepcopy(frame) for _ in range(128)]}
        # Existing documents are intentionally outside the measured allocation.
        allowance = peak(one, server.document_digest) * 4 + 256 * 1024
        self.assertLess(peak(many, server.document_digest), allowance)
        self.assertGreater(peak(many, reference_digest), allowance,
            "The historical full-graph encoder must expose the memory regression")

    def test_v3_preserves_exact_historical_bytes_without_mutation(self):
        frame = {"objects": [{"angles": [1., -0., .125, 2**65],
            "runtime_segments": ["cache"], "opaque": {"runtime_segments": ["keep"]}}],
            "opaque": "\ud800\u2603\U0001f3ac"}
        document = {"z": {"_styk": {"keep": True}}, "keyframes": [frame, frame],
            "a": [True, False, None, 1.0000000000000002, 1e-200, 1e200, "1.0"],
            "_stykSource": {"ignore": float("nan")}, "_stykWeb": {}, "_styk": {}}
        before = copy.deepcopy(document)
        for value in ({}, {"keyframes": []}, {"keyframes": ()}, document,
                      dict(reversed(list(document.items())))):
            with self.subTest(keys=list(value)):
                expected = reference_digest(value)
                self.assertEqual(server.document_digest(value), expected)
                self.assertEqual(server.source_document_digest(value), expected)
        self.assertEqual(document, before)
        self.assertIs(document["keyframes"][0], document["keyframes"][1])
        self.assertIsInstance(frame["objects"][0]["angles"][0], float)

    def test_only_known_runtime_cache_and_root_metadata_are_excluded(self):
        original = {"keyframes": [{"objects": [{"angles": [1., -0.], "runtime_segments": [7]}]}]}
        changed_cache = copy.deepcopy(original)
        changed_cache["keyframes"][0]["objects"][0]["runtime_segments"] = [99]
        changed_cache.update(_styk={"ui": 1}, _stykSource={"bytes": "ignored"}, _stykWeb={})
        self.assertEqual(server.document_digest(original), server.document_digest(changed_cache))
        for changed in ({**original, "runtime_segments": []},
                        {**original, "unknown": {"_styk": 0}},
                        {"keyframes": [{"objects": [{"angles": [1., .001]}]}]}):
            self.assertNotEqual(server.document_digest(original), server.document_digest(changed))

    def test_old_fingerprint_versions_remain_unchanged(self):
        document = {"keyframes": [{"objects": [{"angles": [1., -0.], "runtime_segments": [7]}]}]}
        hashes = set()
        for options in ({"canonical": False}, {"runtime_aliases": True}, {}):
            actual = server.document_digest(document, **options)
            self.assertEqual(actual, reference_digest(document, **options))
            hashes.add(actual)
        self.assertEqual(len(hashes), 3)

    def test_non_json_root_keys_retain_historical_encoding(self):
        for document in ({3: "integer"}, {False: [1.]}, {None: "null"}, {2.5: -0.}):
            self.assertEqual(server.document_digest(document), reference_digest(document))
        for value in ({"mixed": 1, 2: 2}, {"keyframes": [{"objects": [{"x": float("inf")}]}]},
                      {"opaque": float("nan")}):
            with self.assertRaises((TypeError, ValueError)):
                reference_digest(value)
            with self.assertRaises((TypeError, ValueError)):
                server.document_digest(value)


if __name__ == "__main__":
    unittest.main()

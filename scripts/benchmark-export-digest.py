"""Compare existing whole-document and frame-streamed v3 fingerprints.

Run each mode in a fresh process. Decoding precedes the measured digest; no
production function is patched and no input is written. HTTP integration is
measured separately by benchmark-performance-desktop.mjs.
"""
import argparse
import gc
import hashlib
import json
import math
from pathlib import Path
import platform
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import server
from profile_import import memory_snapshot


def legacy_document_digest(document):
    """Frozen pre-streaming v3 encoder, retained only as a benchmark control."""
    def normalize(value):
        if isinstance(value, float):
            return int(value) if math.isfinite(value) and value.is_integer() else value
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [normalize(item) for item in value]
        return value
    semantic = normalize({k: v for k, v in document.items() if k not in ("_stykSource", "_styk", "_stykWeb")})
    for frame in semantic.get("keyframes", []):
        for obj in frame.get("objects", []):
            obj.pop("runtime_segments", None)
    return hashlib.sha256(json.dumps(semantic, sort_keys=True, ensure_ascii=True,
        allow_nan=False, separators=(",", ":")).encode("ascii")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--mode", choices=["legacy_document_digest", "document_digest", "source_document_digest"], required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.read_bytes()
    source_hash = hashlib.sha256(source).hexdigest()
    source_size = len(source)
    store = server.ProjectStore(server.WORKSPACE)
    store.import_bytes(source, args.source.name, as_json=True, prefer_native=True)
    entry = next(iter(store.sources.values()))
    document = store._decode_canonical(entry)
    del source, entry, store
    gc.collect()
    before = memory_snapshot()
    started, cpu = time.perf_counter(), time.process_time()
    encoder = legacy_document_digest if args.mode == "legacy_document_digest" else getattr(server, args.mode)
    digest = encoder(document)
    cpu_ms, wall_ms = (time.process_time() - cpu) * 1000, (time.perf_counter() - started) * 1000
    report = {"mode": args.mode, "fixtureBytes": source_size, "fixtureSha256": source_hash,
        "digest": digest, "wallMs": wall_ms, "cpuMs": cpu_ms,
        "memoryBefore": before, "memoryAfter": memory_snapshot(),
        "python": platform.python_version(), "platform": platform.platform(),
        "implementationSha256": hashlib.sha256((ROOT / "backend/server.py").read_bytes()).hexdigest(),
        "limitations": ["OS peak counters include prior decoding; current working set is not peak allocation.",
            "Function timing excludes source decoding, HTTP, request parsing and file writes.",
            "A fresh process per mode isolates allocator history; OS caches and other activity remain uncontrolled."]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()

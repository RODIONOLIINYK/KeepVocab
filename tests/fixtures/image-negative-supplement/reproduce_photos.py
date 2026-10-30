"""Fetch the 24 reviewed TRAIN photos and verify source SHA-256 values.

Run from any directory with: python3 tests/fixtures/image-negative-supplement/reproduce_photos.py
Images are written to work/image-negative-supplement/photos (they are not tracked).
"""
import hashlib
import json
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURE = Path(__file__).resolve().parent
OUTPUT = REPO / "work" / "image-negative-supplement" / "photos"
manifest = json.loads((FIXTURE / "manifest.json").read_text())
OUTPUT.mkdir(parents=True, exist_ok=True)
for item in manifest["items"]:
    if item["distractorKind"] != "photo":
        continue
    source = item["source"]
    output = OUTPUT / Path(item["path"]).name
    if not output.exists():
        request = urllib.request.Request(
            source["url"], headers={"User-Agent": "KeepVocab dataset supplement research"}
        )
        output.write_bytes(urllib.request.urlopen(request, timeout=30).read())
    actual = hashlib.sha256(output.read_bytes()).hexdigest()
    expected = source["sha256"]
    if actual != expected:
        raise SystemExit(f"SHA-256 mismatch for {item['id']}: {actual} != {expected}")
    print(f"verified {item['id']} {actual}")

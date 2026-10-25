"""Fetch the pinned photos used by the visually reviewed pretraining fixture.

Usage: python3 scripts/prepare-image-pretraining.py [work/image-pretraining]
Only the curated files are extracted. Raw photographs are not shipped in the app.
"""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = root / 'tests/fixtures/image-pretraining/cases.json'
fixture = json.loads(manifest.read_text())
target = Path(sys.argv[1] if len(sys.argv) > 1 else root / 'work/image-pretraining')
target.mkdir(parents=True, exist_ok=True)
archive = target / 'coco128.zip'
expected = fixture['source']['archiveSha256']
if not archive.exists():
    with urllib.request.urlopen(fixture['source']['subsetArchive'], timeout=60) as response:
        archive.write_bytes(response.read(20_000_001))
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Archive hash mismatch; remove it and retry.')
photos = {photo['file']: photo['sha256'] for case in fixture['cases'] for photo in case['candidates']}
with zipfile.ZipFile(archive) as bundle:
    for file, checksum in photos.items():
        # Construct exact member names; never extract archive-supplied paths.
        name = Path(file).name
        data = bundle.read('coco128/images/train2017/' + name)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise SystemExit('Photo hash mismatch: ' + name)
        destination = target / 'images' / name
        destination.parent.mkdir(exist_ok=True)
        destination.write_bytes(data)
(target / 'cases.json').write_text(manifest.read_text())
print(f'Prepared {len(photos)} verified photos and {len(fixture["cases"])} reviewed choices in {target}')

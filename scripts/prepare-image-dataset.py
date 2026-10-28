"""Fetch a reviewed public-photo dataset by pinned URL and SHA-256.

Usage: python3 scripts/prepare-image-dataset.py manifest.json output-directory
Raw photos are development inputs; they are not copied into the app/release.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
import hashlib,json
from pathlib import Path,PurePosixPath
import time,urllib.request
from urllib.parse import urlsplit

def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest');parser.add_argument('directory');a=parser.parse_args()
    manifest=Path(a.manifest);data=json.loads(manifest.read_text());target=Path(a.directory);target.mkdir(parents=True,exist_ok=True)
    photos={}
    for case in data['cases']:
        for photo in case['candidates']:
            path=PurePosixPath(photo['file']);url=urlsplit(photo['url'])
            if path.is_absolute() or '..' in path.parts or path.parts[0]!='images' or url.scheme!='https' or url.username or url.password:raise ValueError('Unsupported source photo path or URL')
            existing=photos.get(photo['id'])
            if existing and (existing['sha256'],existing['url'])!=(photo['sha256'],photo['url']):raise ValueError('Conflicting source photo metadata')
            photos[photo['id']]=photo
    def fetch(photo):
        file=target/photo['file']
        if file.exists() and hashlib.sha256(file.read_bytes()).hexdigest()==photo['sha256']:return
        for attempt in range(5):
            try:
                with urllib.request.urlopen(photo['url'],timeout=45) as response:raw=response.read(3_000_001)
                if len(raw)>3_000_000 or hashlib.sha256(raw).hexdigest()!=photo['sha256']:raise ValueError('Photo byte/hash mismatch')
                file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw);return
            except Exception:
                if attempt==4:raise
                time.sleep(2**attempt)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures=[executor.submit(fetch,p) for p in photos.values()]
        for i,f in enumerate(as_completed(futures),1):
            f.result()
            if i%100==0 or i==len(futures):print(f'Verified {i}/{len(futures)} source photos',flush=True)
    (target/'cases.json').write_text(manifest.read_text())
if __name__=='__main__':main()

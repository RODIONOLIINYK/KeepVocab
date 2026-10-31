"""Create deterministic, review-pending centered crops from reviewed train photos.

Usage: python3 scripts/prepare-image-crops.py [output-directory]

This only creates local review artifacts. Crops are not training eligible until
their AI visual review is recorded as approved in the separate decisions file.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / 'tests/fixtures/image-pretraining-v2/cases.json'
PHOTOS_ROOT = ROOT / 'work/mlp-fp16-retrain/photos'
DEFAULT_OUTPUT = ROOT / 'work/image-crop-augmentation'
MIN_AREA_FRACTION = 0.80
PAIRS_PER_SHEET = 12
THUMBNAIL = (260, 190)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def centered_crop_box(width: int, height: int,
                      min_area_fraction: float = MIN_AREA_FRACTION) -> tuple[int, int, int, int]:
    """Return a centered, aspect-preserving crop meeting the retained-area floor."""
    if width <= 0 or height <= 0:
        raise ValueError('image dimensions must be positive')
    if not 0 < min_area_fraction <= 1:
        raise ValueError('min_area_fraction must be in (0, 1]')
    # Retain the same linear fraction in both dimensions. ceil ensures the
    # retained area is at least the requested fraction after integer rounding.
    linear_fraction = math.sqrt(min_area_fraction)
    crop_width = min(width, math.ceil(width * linear_fraction))
    crop_height = min(height, math.ceil(height * linear_fraction))
    left = (width - crop_width) // 2
    top = (height - crop_height) // 2
    return (left, top, left + crop_width, top + crop_height)


def validate_split_hashes(cases: list[dict], selected: list[tuple[dict, dict]]) -> None:
    """Guard against selected train parent photos appearing in held-out splits."""
    heldout_hashes = {
        candidate['sha256']
        for case in cases if case.get('split') in ('validation', 'test')
        for candidate in case.get('candidates', [])
    }
    selected_hashes = [candidate['sha256'] for _, candidate in selected]
    if len(set(selected_hashes)) != len(selected_hashes):
        raise ValueError('selected training parent photos are not unique')
    overlap = set(selected_hashes) & heldout_hashes
    if overlap:
        raise ValueError(f'{len(overlap)} selected training photo hash(es) overlap held-out candidates')


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    paths = [
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def fit_thumbnail(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert('RGB')
    image.thumbnail(THUMBNAIL, Image.Resampling.LANCZOS)
    canvas = Image.new('RGB', THUMBNAIL, '#f0f2f5')
    canvas.paste(image, ((THUMBNAIL[0] - image.width) // 2,
                         (THUMBNAIL[1] - image.height) // 2))
    return canvas


def wrapped_lines(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont,
                  max_width: int, max_lines: int = 2) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ''
    for word in words:
        candidate = f'{current} {word}'.strip()
        if current and draw.textbbox((0, 0), candidate, font=fnt)[2] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textbbox((0, 0), last + '…', font=fnt)[2] > max_width:
            last = last[:-1]
        lines[-1] = last.rstrip() + '…'
    return lines


def make_contact_sheet(items: list[dict], sheet_index: int, output_path: Path,
                      output_root: Path) -> None:
    """Render up to 12 original/crop pairs with their meaning labels."""
    page_width = 1360
    margin, gap = 28, 20
    cell_width = (page_width - 2 * margin - gap) // 2
    image_gap = 12
    image_width = (cell_width - image_gap) // 2
    label_height = 78
    row_height = label_height + THUMBNAIL[1] + 30
    rows = math.ceil(len(items) / 2)
    page = Image.new('RGB', (page_width, margin * 2 + rows * row_height), '#ffffff')
    draw = ImageDraw.Draw(page)
    title_font, word_font, body_font = font(23, True), font(19, True), font(14)
    draw.text((margin, 8), f'Train crop review — sheet {sheet_index:02d}',
              fill='#172033', font=title_font)
    for index, item in enumerate(items):
        col, row = index % 2, index // 2
        x = margin + col * (cell_width + gap)
        y = margin + row * row_height
        draw.text((x, y), f"{item['reviewIndex']:03d}. {item['word']}",
                  fill='#172033', font=word_font)
        definition_lines = wrapped_lines(draw, item['definition'], body_font,
                                         cell_width, max_lines=2)
        for line_no, line in enumerate(definition_lines):
            draw.text((x, y + 25 + line_no * 18), line, fill='#445066', font=body_font)
        image_y = y + label_height
        for offset, label, filename in ((0, 'Original', item['parentPath']),
                                         (image_width + image_gap, 'Centered crop (~80% area)', item['cropPath'])):
            source_path = PHOTOS_ROOT / filename if label == 'Original' else output_root / filename
            with Image.open(source_path) as source:
                thumb = fit_thumbnail(source)
            page.paste(thumb, (x + offset, image_y))
            draw.rectangle((x + offset, image_y,
                            x + offset + THUMBNAIL[0] - 1,
                            image_y + THUMBNAIL[1] - 1), outline='#c7ced8', width=1)
            draw.text((x + offset, image_y + THUMBNAIL[1] + 4), label,
                      fill='#445066', font=body_font)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    page.save(output_path, format='PNG', optimize=True)


def build(output: Path) -> dict:
    manifest = json.loads(CASES_PATH.read_text())
    cases = manifest['cases']
    selected: list[tuple[dict, dict]] = []
    for case in cases:
        if case.get('split') != 'train':
            continue
        selected_ids = case.get('feedback', {}).get('selected', [])
        if len(selected_ids) != 1:
            raise ValueError(f"{case.get('id')}: expected exactly one reviewed selected candidate")
        matches = [c for c in case.get('candidates', []) if c.get('id') == selected_ids[0]]
        if len(matches) != 1:
            raise ValueError(f"{case.get('id')}: selected candidate missing or ambiguous")
        selected.append((case, matches[0]))
    validate_split_hashes(cases, selected)
    output.mkdir(parents=True, exist_ok=True)
    crop_dir = output / 'crops'
    crop_dir.mkdir(exist_ok=True)

    entries = []
    for review_index, (case, candidate) in enumerate(selected, start=1):
        rel = Path(candidate['file'])
        if rel.is_absolute() or '..' in rel.parts or rel.parts[0] != 'images':
            raise ValueError(f"unsafe source path in fixture: {candidate['file']}")
        parent_path = PHOTOS_ROOT / rel
        parent_bytes = parent_path.read_bytes()
        parent_hash = sha256_bytes(parent_bytes)
        if parent_hash != candidate['sha256']:
            raise ValueError(f"parent hash mismatch for {case['id']} / {candidate['id']}")
        with Image.open(parent_path) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
            box = centered_crop_box(*image.size)
            crop = image.crop(box)
            retained = (crop.width * crop.height) / (image.width * image.height)
            if retained + 1e-12 < MIN_AREA_FRACTION:
                raise AssertionError('crop retained less than required area')
            crop_name = f'{review_index:03d}-{candidate["id"]}-{parent_hash[:12]}.png'
            crop_path = crop_dir / crop_name
            crop.save(crop_path, format='PNG', optimize=True)
        crop_hash = sha256_bytes(crop_path.read_bytes())
        entry = {
            'reviewIndex': review_index,
            'caseId': case['id'],
            'meaningId': case['meaningId'],
            'word': case['word']['word'],
            'partOfSpeech': case['word'].get('partOfSpeech'),
            'definition': case['word']['definition'],
            'split': 'train',
            'parentCandidateId': candidate['id'],
            'parentPath': rel.as_posix(),
            'parentSha256': parent_hash,
            'cropPath': f'crops/{crop_name}',
            'cropSha256': crop_hash,
            'crop': {
                'method': 'centered rectangular crop',
                'sourceDimensions': list(image.size),
                'boxXYXY': list(box),
                'dimensions': list(crop.size),
                'retainedAreaFraction': round(retained, 8),
                'minimumRetainedAreaFraction': MIN_AREA_FRACTION,
            },
            'reviewStatus': 'pending',
            'trainingEligible': False,
            'reviewDecision': None,
            'reviewer': None,
            'reviewNotes': None,
        }
        entries.append(entry)

    sheets_dir = output / 'contact-sheets'
    sheets_dir.mkdir(exist_ok=True)
    for start in range(0, len(entries), PAIRS_PER_SHEET):
        sheet_entries = entries[start:start + PAIRS_PER_SHEET]
        make_contact_sheet(sheet_entries, start // PAIRS_PER_SHEET + 1,
                           sheets_dir / f'sheet-{start // PAIRS_PER_SHEET + 1:02d}.png',
                           output)

    review_manifest = {
        'schemaVersion': 1,
        'createdBy': 'scripts/prepare-image-crops.py',
        'sourceFixture': 'tests/fixtures/image-pretraining-v2/cases.json',
        'augmentation': {
            'kind': 'single-centered-crop-per-reviewed-train-parent',
            'minimumRetainedAreaFraction': MIN_AREA_FRACTION,
            'deterministic': True,
            'noValidationOrTestAugmentation': True,
        },
        'reviewPolicy': {
            'reviewStatus': 'pending',
            'trainingEligible': False,
            'instruction': 'AI visual review must inspect each original/crop pair. Approve at most one positive crop per parent photo; do not duplicate or create negative crop labels without review.',
        },
        'summary': {
            'trainParents': len(entries),
            'pendingCrops': len(entries),
            'approvedCrops': 0,
            'trainingEligibleCrops': 0,
            'contactSheetCount': math.ceil(len(entries) / PAIRS_PER_SHEET),
            'pairsPerSheet': PAIRS_PER_SHEET,
        },
        'entries': entries,
    }
    (output / 'review-manifest.json').write_text(json.dumps(review_manifest, indent=2) + '\n')
    report = {
        'trainCases': len([c for c in cases if c.get('split') == 'train']),
        'selectedTrainParents': len(entries),
        'uniqueParentHashes': len({e['parentSha256'] for e in entries}),
        'cropFiles': len(entries),
        'pendingNotTrainingEligible': len(entries),
        'validationTestCrops': 0,
        'contactSheets': math.ceil(len(entries) / PAIRS_PER_SHEET),
        'minimumRetainedAreaFraction': min(e['crop']['retainedAreaFraction'] for e in entries),
        'maximumRetainedAreaFraction': max(e['crop']['retainedAreaFraction'] for e in entries),
    }
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    if not output.is_absolute():
        output = ROOT / output
    report = build(output)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

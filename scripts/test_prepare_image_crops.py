"""Small offline invariants for centered crop generation and review gating."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image


SCRIPT = Path(__file__).with_name('prepare-image-crops.py')
SPEC = importlib.util.spec_from_file_location('prepare_image_crops', SCRIPT)
crops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(crops)


class CenteredCropTests(unittest.TestCase):
    def test_crop_is_centered_and_keeps_at_least_eighty_percent(self):
        for width, height in ((640, 480), (573, 640), (1, 1), (2, 3), (101, 99)):
            box = crops.centered_crop_box(width, height)
            left, top, right, bottom = box
            self.assertEqual((left + right, top + bottom),
                             (width - (width - (right - left)) % 2,
                              height - (height - (bottom - top)) % 2))
            self.assertGreaterEqual((right - left) * (bottom - top) /
                                    (width * height), 0.80)

    def test_crop_box_rejects_invalid_inputs(self):
        for args in ((0, 10), (10, -1), (10, 10, 0), (10, 10, 1.1)):
            with self.assertRaises(ValueError):
                crops.centered_crop_box(*args)


class DatasetGuardTests(unittest.TestCase):
    def test_heldout_hash_overlap_is_rejected(self):
        duplicate = {'sha256': 'same'}
        cases = [{'split': 'test', 'candidates': [duplicate]}]
        with self.assertRaisesRegex(ValueError, 'overlap'):
            crops.validate_split_hashes(cases, [({'split': 'train'}, duplicate)])

    def test_build_emits_pending_train_only_crop_with_exact_parent_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            photos = base / 'photos'
            (photos / 'images').mkdir(parents=True)
            source = photos / 'images' / 'train.jpg'
            Image.new('RGB', (100, 80), '#346799').save(source)
            import hashlib
            parent_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            train_candidate = {'id': 'train-photo', 'file': 'images/train.jpg',
                               'sha256': parent_hash}
            fixture = {'cases': [
                {'id': 'train-case', 'meaningId': 'meaning:x', 'familyId': 'x',
                 'split': 'train', 'word': {'word': 'x', 'partOfSpeech': 'noun',
                                            'definition': 'A test meaning.'},
                 'feedback': {'selected': ['train-photo']},
                 'candidates': [train_candidate]},
                {'split': 'test', 'candidates': [{'sha256': 'heldout-other'}]},
            ]}
            crops.CASES_PATH = base / 'cases.json'
            crops.CASES_PATH.write_text(json.dumps(fixture))
            crops.PHOTOS_ROOT = photos
            output = base / 'result'
            report = crops.build(output)
            review = json.loads((output / 'review-manifest.json').read_text())
            entry = review['entries'][0]
            self.assertEqual(report['cropFiles'], 1)
            self.assertEqual(entry['parentSha256'], parent_hash)
            self.assertEqual(entry['split'], 'train')
            self.assertEqual(entry['reviewStatus'], 'pending')
            self.assertFalse(entry['trainingEligible'])
            self.assertGreaterEqual(entry['crop']['retainedAreaFraction'], 0.80)
            self.assertEqual(review['summary']['approvedCrops'], 0)
            self.assertTrue((output / 'contact-sheets/sheet-01.png').is_file())


if __name__ == '__main__':
    unittest.main()

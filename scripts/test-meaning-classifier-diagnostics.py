#!/usr/bin/env python3
"""Regression checks for confidence/precision diagnostics, without test tuning."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('diagnostics', ROOT / 'scripts/diagnose-meaning-classifier.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
np = d.np


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.y = np.tile(np.eye(6, dtype=int), (6, 1))
        self.p = np.where(self.y, .9965, .9955).astype(float)
        self.p[0, 1] = .9975

    def test_exact_threshold_search_does_not_miss_near_one_operating_points(self):
        chosen, _ = d.select_precision_threshold(self.y, self.p)
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen['threshold'], .9965)
        self.assertEqual(chosen['positivePredictions'], 37)
        self.assertEqual(chosen['falsePositives'], 1)
        self.assertAlmostEqual(chosen['microPrecision'], 36 / 37)
        self.assertEqual(chosen['microRecall'], 1)

    def test_zero_predictions_do_not_become_perfect_precision(self):
        point = d.threshold_metrics(self.y, self.p, 1.0)
        self.assertIsNone(point['microPrecision'])
        self.assertEqual(point['positivePredictions'], 0)

    def test_global_calibration_cannot_improve_the_exact_precision_recall_frontier(self):
        calibration = {'method': 'temperature-global-bias', 'temperature': 2.0, 'offsets': [-.2] * 6}
        a, _ = d.select_precision_threshold(self.y, self.p)
        b, _ = d.select_precision_threshold(self.y, d.calibrate(self.p, calibration))
        for field in ['positivePredictions', 'falsePositives', 'microPrecision', 'microRecall']:
            self.assertEqual(a[field], b[field])

    def test_noop_calibration_preserves_float_probabilities_exactly(self):
        unchanged = d.calibrate(self.p, {'method': 'none'})
        np.testing.assert_array_equal(unchanged, self.p)
        self.assertEqual(unchanged.dtype.kind, 'f')

    def test_confident_wrong_membership_includes_both_false_positive_and_false_negative(self):
        rows = [{'id': 'a', 'word': 'example', 'definition': 'A test meaning.',
                 'requiredEvidence': 'Fixture only.', 'rationale': 'Fixture only.'}]
        y = np.asarray([[1, 0, 0, 0, 0, 0]])
        p = np.asarray([[.01, .99, .2, .2, .2, .2]])
        wrong = d.confidence_errors(rows, y, p)
        self.assertEqual(len(wrong), 2)
        self.assertEqual({r['goldMembership'] for r in wrong}, {0, 1})


if __name__ == '__main__':
    unittest.main()

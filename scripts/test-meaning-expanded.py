#!/usr/bin/env python3
"""Regression checks for the cheaper-model comparison rule."""
import importlib.util
from pathlib import Path
import copy
import unittest
spec = importlib.util.spec_from_file_location('expanded', Path(__file__).with_name('train-meaning-expanded.py'))
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)

class PracticalArchitectureComparison(unittest.TestCase):
    def setUp(self):
        self.mlp = {'macroF1': .8, 'exactMatch': .75, 'microPrecision': .85, 'microRecall': .82,
                    'bce': .2, 'brier': .05, 'perClass': {c: {'f1': .8} for c in e.t.CATEGORIES}}

    def test_small_quality_differences_allow_the_cheaper_linear_head(self):
        linear = {**copy.deepcopy(self.mlp), 'macroF1': .795, 'exactMatch': .735,
                  'microPrecision': .84, 'microRecall': .81, 'bce': .207, 'brier': .052}
        self.assertTrue(e.equivalent_linear(linear, self.mlp)['passed'])

    def test_a_weak_category_cannot_be_hidden_by_good_aggregate_metrics(self):
        linear = copy.deepcopy(self.mlp); linear['perClass']['relation']['f1'] = .74
        comparison = e.equivalent_linear(linear, self.mlp)
        self.assertFalse(comparison['passed']); self.assertFalse(comparison['checks']['perClassF1'])

    def test_lower_size_does_not_override_an_accuracy_or_probability_loss(self):
        for key, value in [('exactMatch', .72), ('microPrecision', .82), ('brier', .054), ('bce', .212)]:
            linear = {**copy.deepcopy(self.mlp), key: value}
            self.assertFalse(e.equivalent_linear(linear, self.mlp)['passed'])

if __name__ == '__main__': unittest.main()

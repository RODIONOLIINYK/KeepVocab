#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('regularization', Path(__file__).parent / 'lib/meaning_regularization.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
np = r.np

class ExactL1Tests(unittest.TestCase):
    def test_weight_mask_never_penalizes_biases(self):
        for hidden in [0, 3]:
            mask = r.weight_mask(4, hidden)
            theta = np.arange(len(mask), dtype=float) - 3
            np.testing.assert_array_equal(r.unsplit(r.split(theta, mask), mask), theta)
            self.assertEqual(int((~mask).sum()), hidden + 6 if hidden else 6)

    def test_split_gradient_matches_finite_differences(self):
        rng = np.random.default_rng(19); x = rng.normal(size=(12, 4)); y = (rng.random((12, 6)) > .7).astype(float)
        for hidden in [0, 3]:
            mask = r.weight_mask(4, hidden); theta = r.initial_theta(x, y, hidden)
            z = r.split(theta, mask); z[:2*int(mask.sum())] += .03
            for sample_weight in [None, np.linspace(.25, 1, len(y))]:
                value, gradient = r.split_objective(z, x, y, hidden, .003, .02, .5, mask, sample_weight)
                for i in range(len(z)):
                    delta = np.zeros_like(z); delta[i] = 1e-6
                    estimate = (r.split_objective(z+delta, x, y, hidden, .003, .02, .5, mask, sample_weight)[0] - r.split_objective(z-delta, x, y, hidden, .003, .02, .5, mask, sample_weight)[0]) / 2e-6
                    self.assertAlmostEqual(estimate, gradient[i], places=7)

    def test_no_l1_preserves_the_existing_l2_solver(self):
        rng = np.random.default_rng(42); x = rng.normal(size=(24, 4)); y = (rng.random((24, 6)) > .7).astype(float)
        config = {'hidden': 3, 'preprocess': 'standardize', 'center': True, 'l1': 0, 'l2': .02, 'weightPower': .5}
        a, b = r.fit(x, y, config), r.t.fit(x, y, config)
        np.testing.assert_array_equal(r.t.predict(a, x), r.t.predict(b, x))

    def test_shared_parent_weight_does_not_multiply_a_duplicate_examples_loss(self):
        rng = np.random.default_rng(91); x = rng.normal(size=(12, 4)); y = (rng.random((12, 6)) > .6).astype(float)
        theta = r.initial_theta(x, y, 3)
        value, gradient = r.smooth_objective(theta, x, y, 3, .02, .5, np.ones(12))
        doubled_x = np.r_[x, x[:1]]; doubled_y = np.r_[y, y[:1]]
        weights = np.r_[np.ones(12), .5]; weights[0] = .5
        actual, grad = r.smooth_objective(theta, doubled_x, doubled_y, 3, .02, .5, weights)
        self.assertAlmostEqual(value, actual, places=14)
        np.testing.assert_allclose(gradient, grad, atol=1e-14)

    def test_strong_l1_produces_exact_sparse_weights_without_suppressing_biases(self):
        rng = np.random.default_rng(5); x = rng.normal(size=(40, 4)); y = np.tile([1, 0, 0, 1, 0, 1], (40, 1)).astype(float)
        y[::4] = 1-y[::4]
        config = {'hidden': 0, 'preprocess': 'standardize', 'center': True, 'l1': 1, 'l2': 0, 'weightPower': 0, 'maxIterations': 600}
        model = r.fit(x, y, config)
        self.assertEqual(model['regularization']['zeroWeightFraction'], 1)
        self.assertTrue(np.any(model['layers'][0][1] != 0))
        self.assertLess(model['optimizer']['splitPenaltyGap'], 1e-8)

if __name__ == '__main__': unittest.main()

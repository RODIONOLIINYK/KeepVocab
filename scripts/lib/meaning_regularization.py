"""Exact weight-only L1/elastic-net training via nonnegative variable splitting.

For each weight w=u-v, u,v>=0, min(u+v)=abs(w). L-BFGS-B therefore
optimizes the exact L1 objective through smooth bounded variables, without
pretending a sign gradient is differentiable at zero. Biases stay free.
"""
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('meaning_trainer_l1', ROOT / 'scripts/train-meaning-taxonomy.py')
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
np = t.np


def weight_mask(dimension, hidden, outputs=6):
    sizes = [(dimension, hidden), (hidden, outputs)] if hidden else [(dimension, outputs)]
    return np.concatenate([np.r_[np.ones(a * b, dtype=bool), np.zeros(b, dtype=bool)] for a, b in sizes])


def initial_theta(x, y, hidden, seed=7919, sample_weight=None):
    dimensions = [x.shape[1], hidden, 6] if hidden else [x.shape[1], 6]
    rng = np.random.default_rng(seed); values = []
    prevalence = np.clip(np.average(y, axis=0, weights=sample_weight), 1e-4, 1 - 1e-4)
    for index, (a, b) in enumerate(zip(dimensions[:-1], dimensions[1:])):
        w = rng.normal(0, np.sqrt(2 / (a + b)), (a, b)) if hidden else np.zeros((a, b))
        bias = np.log(prevalence / (1 - prevalence)) if index == len(dimensions) - 2 else np.zeros(b)
        values += [w.ravel(), bias]
    return np.concatenate(values)


def split(theta, mask):
    return np.r_[np.maximum(theta[mask], 0), np.maximum(-theta[mask], 0), theta[~mask]]


def unsplit(z, mask):
    count = int(mask.sum()); theta = np.empty(len(mask))
    theta[mask] = z[:count] - z[count:2 * count]; theta[~mask] = z[2 * count:]
    return theta


def smooth_objective(theta, x, y, hidden, l2, weight_power, sample_weight=None):
    if sample_weight is None:
        return t.objective(theta, x, y, hidden, l2, weight_power)
    layers = t.unpack(theta, x.shape[1], hidden); activations = [x]
    for i, (w, b) in enumerate(layers):
        z = activations[-1] @ w + b
        activations.append(np.tanh(z) if i < len(layers) - 1 else z)
    logits = activations[-1]
    prevalence = np.clip(np.average(y, axis=0, weights=sample_weight), 1e-6, 1-1e-6)
    positive = np.clip(((1-prevalence)/prevalence)**weight_power, .2, 8)
    weights = sample_weight[:, None] * (1 + y*(positive-1))
    normalizer = weights.sum()
    loss = float(np.sum(weights*(np.logaddexp(0, logits)-y*logits))/normalizer)
    delta = (t.sigmoid(logits)-y)*weights/normalizer; gradients = []
    for i in reversed(range(len(layers))):
        w, b = layers[i]; loss += l2*float(np.sum(w*w))/2
        gradients[0:0] = [(activations[i].T@delta+l2*w).ravel(), delta.sum(axis=0)]
        if i: delta = (delta@w.T)*(1-activations[i]**2)
    return loss, np.concatenate(gradients)


def split_objective(z, x, y, hidden, l1, l2, weight_power, mask, sample_weight=None):
    count = int(mask.sum()); theta = unsplit(z, mask)
    loss, gradient = smooth_objective(theta, x, y, hidden, l2, weight_power, sample_weight)
    loss += l1 * float(z[:2 * count].sum())
    return loss, np.r_[gradient[mask] + l1, -gradient[mask] + l1, gradient[~mask]]


def fit(x, y, config, seed=7919, sample_weight=None):
    l1 = float(config.get('l1', 0)); l2 = float(config.get('l2', 0))
    if l1 < 0 or l2 < 0: raise ValueError('Regularization penalties must be nonnegative.')
    if sample_weight is not None:
        sample_weight = np.asarray(sample_weight, dtype=float)
        if sample_weight.shape != (len(y),) or not np.isfinite(sample_weight).all() or np.any(sample_weight <= 0):
            raise ValueError('Expected one finite positive sampling weight per row.')
    if l1 == 0 and sample_weight is None:
        model = t.fit(x, y, config, seed=seed)
        model['optimizer']['regularizationSolver'] = 'L-BFGS-B smooth BCE+L2'
    else:
        mean, scale = t.preprocessing(x, config)
        if sample_weight is not None:
            weighted_mean = np.average(x, axis=0, weights=sample_weight)
            if config['center'] or config['preprocess'] == 'standardize': mean = weighted_mean
            if config['preprocess'] == 'standardize':
                scale = np.maximum(np.sqrt(np.average((x-weighted_mean)**2, axis=0, weights=sample_weight)), .01)
        transformed = np.ascontiguousarray((x - mean) / scale)
        hidden = config['hidden']; theta = initial_theta(x, y, hidden, seed, sample_weight)
        mask = weight_mask(x.shape[1], hidden); count = int(mask.sum()); z = split(theta, mask) if l1 else theta
        bounds = [(0, None)] * (count * 2) + [(None, None)] * int((~mask).sum()) if l1 else None
        limit = config.get('maxIterations', 600)
        function = split_objective if l1 else smooth_objective
        arguments = (transformed, y, hidden, l1, l2, config['weightPower'], mask, sample_weight) if l1 else (transformed, y, hidden, l2, config['weightPower'], sample_weight)
        result = t.minimize(function, z, args=arguments,
                            method='L-BFGS-B', jac=True, bounds=bounds,
                            options={'maxiter': limit, 'maxfun': max(1800, limit * 3), 'gtol': 1e-7, 'ftol': 1e-11, 'maxls': 30})
        theta = unsplit(result.x, mask) if l1 else result.x
        if not np.isfinite(theta).all() or not np.isfinite(result.fun): raise ValueError('Non-finite fit.')
        model = {'mean': mean, 'scale': scale, 'layers': t.unpack(theta, x.shape[1], hidden),
                 'optimizer': {'success': bool(result.success), 'message': str(result.message), 'iterations': int(result.nit),
                               'evaluations': int(result.nfev), 'loss': float(result.fun),
                               'regularizationSolver': 'L-BFGS-B exact nonnegative L1 variable splitting; biases free' if l1 else 'L-BFGS-B weighted BCE+L2; biases free',
                               'splitPenaltyGap': float(result.x[:count*2].sum() - np.abs(theta[mask]).sum()) if l1 else 0,
                               'trueL1Objective': float(smooth_objective(theta, transformed, y, hidden, l2, config['weightPower'], sample_weight)[0] + l1 * np.abs(theta[mask]).sum())}}
    weights = np.concatenate([w.ravel() for w, _ in model['layers']])
    model['regularization'] = {'l1': l1, 'l2': l2, 'biasesPenalized': False,
                               'weightCount': len(weights), 'exactZeroWeights': int(np.count_nonzero(weights == 0)),
                               'zeroWeightFraction': float(np.mean(weights == 0))}
    return model

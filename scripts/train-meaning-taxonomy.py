#!/usr/bin/env python3
"""Offline grouped tuning. Test targets are not supplied to model selection."""
import os
for _thread_variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ[_thread_variable] = '1'

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import multiprocessing
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work/meaning-taxonomy-training/python-libs'))
import numpy as np
import scipy
from scipy.optimize import minimize

FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy'
CATEGORIES = ['entity', 'place', 'action', 'state', 'relation', 'abstract']
SEED = 20261031


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sigmoid(z):
    small = np.exp(-np.abs(z))
    return np.where(z >= 0, 1 / (1 + small), small / (1 + small))


def metrics(y, p, threshold=0.5):
    p = np.asarray(p)
    prediction = p >= threshold
    truth = y.astype(bool)
    tp = (prediction & truth).sum(axis=0)
    fp = (prediction & ~truth).sum(axis=0)
    fn = (~prediction & truth).sum(axis=0)
    precision = np.divide(tp, tp + fp, out=np.zeros(len(CATEGORIES)), where=tp + fp > 0)
    recall = np.divide(tp, tp + fn, out=np.zeros(len(CATEGORIES)), where=tp + fn > 0)
    f1 = np.divide(2 * tp, 2 * tp + fp + fn, out=np.zeros(len(CATEGORIES)), where=2 * tp + fp + fn > 0)
    clipped = np.clip(p, 1e-12, 1 - 1e-12)
    aps = []
    for c in range(y.shape[1]):
        order = np.argsort(-p[:, c], kind='stable')
        target = y[order, c]
        # Evaluate all tied scores at their common end rank (no row-order gain).
        ends = np.r_[np.flatnonzero(np.diff(p[order, c])), len(order) - 1]
        cumulative = np.cumsum(target)
        increments = np.diff(np.r_[0, cumulative[ends]])
        aps.append(float(np.sum(increments * cumulative[ends] / (ends + 1)) / max(1, target.sum())))
    per_class = {c: {'positiveSupport': int(y[:, k].sum()), 'predictedPositive': int(prediction[:, k].sum()),
                     'tp': int(tp[k]), 'fp': int(fp[k]), 'fn': int(fn[k]),
                     'precision': float(precision[k]), 'recall': float(recall[k]), 'f1': float(f1[k]),
                     'averagePrecision': aps[k]} for k, c in enumerate(CATEGORIES)}
    return {'count': len(y), 'macroF1': float(f1.mean()),
            'microF1': float(2 * tp.sum() / max(1, 2 * tp.sum() + fp.sum() + fn.sum())),
            'exactMatch': float(np.all(prediction == truth, axis=1).mean()),
            'bce': float(-(y * np.log(clipped) + (1 - y) * np.log1p(-clipped)).mean()),
            'brier': float(np.mean((p - y) ** 2)), 'macroAveragePrecision': float(np.mean(aps)),
            'threshold': float(threshold), 'perClass': per_class}


def group_folds(y, groups, seed, count=4):
    """Greedy multilabel group stratification; no group is divided."""
    rng = np.random.default_rng(seed)
    unique = list(dict.fromkeys(groups))
    entries = []
    global_counts = np.maximum(y.sum(axis=0), 1)
    for group in unique:
        ix = np.flatnonzero(groups == group)
        labels = y[ix].sum(axis=0)
        priority = float(np.sum(labels / global_counts))
        entries.append((group, ix, labels, priority, rng.random()))
    entries.sort(key=lambda entry: (-len(entry[1]), -entry[3], entry[4]))
    sizes = np.zeros(count)
    positives = np.zeros((count, y.shape[1]))
    assignments = {}
    for group, ix, labels, _, _ in entries:
        costs = []
        for fold in range(count):
            trial_p, trial_n = positives.copy(), sizes.copy()
            trial_p[fold] += labels
            trial_n[fold] += len(ix)
            costs.append(np.mean(np.std(trial_p / global_counts, axis=0)) + np.std(trial_n / len(y)))
        minimum = min(costs)
        options = [f for f, cost in enumerate(costs) if abs(cost - minimum) < 1e-12]
        fold = int(rng.choice(options))
        sizes[fold] += len(ix)
        positives[fold] += labels
        assignments[group] = fold
    folds = []
    for f in range(count):
        validation = np.asarray([i for i, g in enumerate(groups) if assignments[g] == f])
        training = np.asarray([i for i, g in enumerate(groups) if assignments[g] != f])
        assert not set(groups[training]) & set(groups[validation])
        assert np.all(y[training].sum(axis=0) > 0) and np.all(y[validation].sum(axis=0) > 0)
        assert np.all(y[training].sum(axis=0) < len(training))
        folds.append((training, validation))
    return folds


def preprocessing(x, config):
    mean = x.mean(axis=0) if config['center'] or config['preprocess'] == 'standardize' else np.zeros(x.shape[1])
    if config['preprocess'] == 'standardize':
        scale = np.maximum(x.std(axis=0), 0.01)
    elif config['preprocess'] == 'scaled':
        scale = np.full(x.shape[1], 1 / np.sqrt(x.shape[1]))
    else:
        scale = np.ones(x.shape[1])
    return mean, scale


def unpack(theta, dimension, hidden, outputs=6):
    if not hidden:
        return [(theta[:dimension * outputs].reshape(dimension, outputs), theta[dimension * outputs:])]
    first = dimension * hidden
    second = first + hidden
    third = second + hidden * outputs
    return [(theta[:first].reshape(dimension, hidden), theta[first:second]),
            (theta[second:third].reshape(hidden, outputs), theta[third:])]


def objective(theta, x, y, hidden, l2, weight_power):
    layers = unpack(theta, x.shape[1], hidden)
    activations = [x]
    for i, (w, b) in enumerate(layers):
        z = activations[-1] @ w + b
        activations.append(np.tanh(z) if i < len(layers) - 1 else z)
    logits = activations[-1]
    prevalence = np.clip(y.mean(axis=0), 1e-6, 1 - 1e-6)
    positive_weight = np.clip(((1 - prevalence) / prevalence) ** weight_power, 0.2, 8)
    weights = 1 + y * (positive_weight - 1)
    normalizer = weights.sum()
    loss = float(np.sum(weights * (np.logaddexp(0, logits) - y * logits)) / normalizer)
    delta = (sigmoid(logits) - y) * weights / normalizer
    gradients = []
    for i in reversed(range(len(layers))):
        w, b = layers[i]
        loss += l2 * float(np.sum(w * w)) / 2
        gw = activations[i].T @ delta + l2 * w
        gb = delta.sum(axis=0)
        gradients[0:0] = [gw.ravel(), gb]
        if i:
            delta = (delta @ w.T) * (1 - activations[i] ** 2)
    return loss, np.concatenate(gradients)


def fit(x, y, config, seed=7919):
    mean, scale = preprocessing(x, config)
    transformed = np.ascontiguousarray((x - mean) / scale)
    hidden = config['hidden']
    dimensions = [x.shape[1], hidden, 6] if hidden else [x.shape[1], 6]
    rng = np.random.default_rng(seed)
    pieces = []
    prevalence = np.clip(y.mean(axis=0), 1e-4, 1 - 1e-4)
    for i, (a, b) in enumerate(zip(dimensions[:-1], dimensions[1:])):
        w = rng.normal(0, np.sqrt(2 / (a + b)), (a, b)) if hidden else np.zeros((a, b))
        bias = np.log(prevalence / (1 - prevalence)) if i == len(dimensions) - 2 else np.zeros(b)
        pieces += [w.ravel(), bias]
    result = minimize(objective, np.concatenate(pieces), args=(transformed, y, hidden, config['l2'], config['weightPower']),
                      method='L-BFGS-B', jac=True,
                      options={'maxiter': 400, 'maxfun': 1200, 'gtol': 1e-7, 'ftol': 1e-11, 'maxls': 30})
    if not np.isfinite(result.fun) or not np.isfinite(result.x).all():
        raise ValueError('Non-finite fit.')
    return {'mean': mean, 'scale': scale, 'layers': unpack(result.x, x.shape[1], hidden),
            'optimizer': {'success': bool(result.success), 'message': str(result.message),
                          'iterations': int(result.nit), 'evaluations': int(result.nfev), 'loss': float(result.fun)}}


def predict(model, x):
    values = (x - model['mean']) / model['scale']
    for i, (weights, bias) in enumerate(model['layers']):
        values = values @ weights + bias
        if i < len(model['layers']) - 1:
            values = np.tanh(values)
    return sigmoid(values)


WORK_X = WORK_Y = WORK_FOLDS = None


def initialize_worker(x, y, folds):
    global WORK_X, WORK_Y, WORK_FOLDS
    WORK_X, WORK_Y, WORK_FOLDS = x, y, folds


def evaluate_trial(config):
    started = time.monotonic()
    fold_metrics, optimizer = [], []
    out_of_fold = np.zeros_like(WORK_Y)
    for fold, (training, validation) in enumerate(WORK_FOLDS):
        model = fit(WORK_X[training], WORK_Y[training], config, seed=7919)
        probabilities = predict(model, WORK_X[validation])
        out_of_fold[validation] = probabilities
        fold_metrics.append(metrics(WORK_Y[validation], probabilities))
        optimizer.append(model['optimizer'])
    return {'config': config, 'cv': metrics(WORK_Y, out_of_fold),
            'foldMacroF1': [m['macroF1'] for m in fold_metrics],
            'foldStandardDeviation': float(np.std([m['macroF1'] for m in fold_metrics])),
            'optimizer': optimizer, 'seconds': time.monotonic() - started}


def trial_rank(trial):
    return (-trial['cv']['macroF1'], trial['cv']['bce'], trial['config']['hidden'], trial['config']['trial'])


def random_config(rng, index, phase, parent=None, radius=1):
    if parent is None:
        hidden = 0 if index % 3 else int(rng.choice([8, 16, 32]))
        preprocess = str(rng.choice(['unit', 'scaled', 'standardize']))
        exponent = rng.uniform(-6, -0.5)
        weight = rng.uniform(0, 1)
    else:
        hidden = parent['hidden']
        preprocess = parent['preprocess']
        exponent = np.clip(np.log10(parent['l2']) + rng.normal(0, radius), -7, 0)
        weight = np.clip(parent['weightPower'] + rng.normal(0, radius / 3), 0, 1)
    return {'trial': index, 'phase': phase, 'hidden': hidden, 'preprocess': preprocess,
            'center': bool(rng.integers(2)) if parent is None else parent['center'],
            'l2': float(10 ** exponent), 'weightPower': float(weight)}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def self_test():
    rng = np.random.default_rng(123)
    x = rng.normal(size=(11, 14))
    y = (rng.random((11, 6)) > .6).astype(float)
    errors = []
    for hidden in [0, 3]:
        dimension = x.shape[1]
        n = dimension * 6 + 6 if not hidden else dimension * hidden + hidden + hidden * 6 + 6
        theta = rng.normal(0, .1, n)
        value, gradient = objective(theta, x, y, hidden, .002, .65)
        for i in rng.choice(n, min(40, n), replace=False):
            plus, minus = theta.copy(), theta.copy()
            plus[i] += 1e-5
            minus[i] -= 1e-5
            numerical = (objective(plus, x, y, hidden, .002, .65)[0] - objective(minus, x, y, hidden, .002, .65)[0]) / 2e-5
            errors.append(abs(numerical - gradient[i]))
    assert max(errors) < 1e-7, max(errors)
    perfect = metrics(y, y * .8 + .1)
    assert perfect['macroF1'] == 1 and perfect['exactMatch'] == 1
    config = {'hidden': 0, 'preprocess': 'standardize', 'center': True, 'l2': 1e-4, 'weightPower': 0}
    model = fit(x, y, config)
    assert metrics(y, predict(model, x))['exactMatch'] == 1
    return {'maxGradientAbsoluteError': max(errors), 'gradientCoordinatesChecked': len(errors),
            'smallBatchExactMatch': 1, 'metricsPerfectPrediction': True}


def bootstrap_comparison(y, selected, baseline, groups, selected_threshold, repetitions=1000, baseline_threshold=.5):
    rng = np.random.default_rng(SEED + 91)
    unique = list(dict.fromkeys(groups))
    values, differences = [], []
    for _ in range(repetitions):
        sampled = rng.choice(len(unique), len(unique), replace=True)
        ix = np.concatenate([np.flatnonzero(groups == unique[g]) for g in sampled])
        a = metrics(y[ix], selected[ix], selected_threshold)['macroF1']
        b = metrics(y[ix], baseline[ix], baseline_threshold)['macroF1']
        values.append(a)
        differences.append(a - b)
    return {'method': 'Percentile paired group bootstrap; sparse-class resamples can have zero support.',
            'repetitions': repetitions, 'groupCount': len(unique),
            'macroF1_95PercentInterval': np.quantile(values, [.025, .975]).tolist(),
            'deltaVsComparatorMacroF1_95PercentInterval': np.quantile(differences, [.025, .975]).tolist()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--stages', default='72,48,32', help='Broad, local, fine trial counts.')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/meaning-taxonomy-training')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--selection-only', action='store_true', help='Replay search/selection without loading test targets or exporting a model.')
    args = parser.parse_args()
    assert 1 <= args.workers <= max(1, os.cpu_count() or 1)
    checks = self_test()
    if args.self_test:
        print(json.dumps(checks, indent=2))
        return
    subprocess.run(['node', str(ROOT / 'scripts/audit-meaning-taxonomy.mjs')], cwd=ROOT, check=True, capture_output=True)
    dataset_bytes = (FIXTURE / 'dataset.json').read_bytes()
    dataset = json.loads(dataset_bytes)
    assert dataset['categories'] == CATEGORIES
    embedding_bytes = (FIXTURE / 'embeddings.json.gz').read_bytes()
    encoded = json.loads(gzip.decompress(embedding_bytes))
    assert encoded['datasetFileSha256'] == digest(dataset_bytes)
    assert encoded['dimension'] == 512
    by_id = {row['id']: row for row in encoded['rows']}
    assert len(by_id) == len(encoded['rows']) == len(dataset['items'])
    for row in dataset['items']:
        prompt = f"A photo illustrating {row['word']} ({row['partOfSpeech'] or 'word'}): {row['definition']}"
        assert by_id[row['id']]['promptSha256'] == digest(prompt.encode())
    # Fitting/search only receive the training rows and labels. Merely encoding
    # all fixed prompts does not fit a representation or disclose test labels.
    training_rows = [row for row in dataset['items'] if row['split'] == 'train']
    validation_rows = [row for row in dataset['items'] if row['split'] == 'validation']
    x_train = np.asarray([by_id[row['id']]['vector'] for row in training_rows], dtype=float)
    y_train = np.asarray([row['targets'] for row in training_rows], dtype=float)
    x_validation = np.asarray([by_id[row['id']]['vector'] for row in validation_rows], dtype=float)
    y_validation = np.asarray([row['targets'] for row in validation_rows], dtype=float)
    # The source audit inspects split integrity, not test model performance.
    # Drop parsed test records from the tuning process; reload only after freeze.
    del dataset
    assert x_train.shape[1] == 512 and np.isfinite(x_train).all()
    assert np.allclose(np.linalg.norm(x_train, axis=1), 1, atol=1e-5)
    groups = np.asarray([row['groupId'] for row in training_rows])
    folds = group_folds(y_train, groups, SEED)
    stage_sizes = [int(v) for v in args.stages.split(',')]
    assert len(stage_sizes) == 3 and min(stage_sizes) > 0
    output = args.output
    protocol = {
        'schemaVersion': 1, 'seed': SEED, 'categories': CATEGORIES,
        'datasetFileSha256': digest(dataset_bytes), 'embeddingsFileSha256': digest(embedding_bytes),
        'encoder': encoded['encoder'], 'inputProtocol': encoded['inputProtocol'],
        'trainingCount': len(training_rows), 'validationCount': len(validation_rows),
        'quarantineExcluded': True, 'testLabelsUsedForSelection': False,
        'workers': args.workers, 'blasThreadsPerWorker': 1, 'searchStages': stage_sizes,
        'searchSpace': {'hidden': [0, 8, 16, 32], 'preprocess': ['unit', 'scaled', 'standardize'],
                        'center': [False, True], 'log10L2': [-6, -.5], 'positiveWeightPower': [0, 1]},
        'selection': 'Training-only 4-fold grouped CV macro-F1 at 0.5; BCE, size, then trial ID break ties. Local refinement around top six regions, radii 0.7 then 0.25 log10(L2), clipped to -7..0. Confirm top four per model family on a second grouped fold assignment. Validate three linear and three nonlinear finalists; tune one global threshold 0.25..0.75, ties nearest 0.5. Select validation macro-F1, then BCE, size and trial ID. Test metrics evaluated only after selection.json is written. The source audit can inspect test split metadata; test targets are not passed to fitting or selection.',
        'stopping': 'Three bounded coarse-to-fine stages; report stage gains and stop at the predeclared budget to limit search overfitting.',
        'optimizer': {'name': 'L-BFGS-B', 'maxiter': 400, 'maxfun': 1200, 'maxls': 30, 'gtol': 1e-7, 'ftol': 1e-11},
        'source': 'Reviewed AI-label pilot; no external human ground truth or image-quality claim.',
        'versions': {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__,
                     'architecture': platform.machine()},
        'trainIds': [row['id'] for row in training_rows], 'validationIds': [row['id'] for row in validation_rows],
        'foldValidationIds': [[training_rows[int(i)]['id'] for i in va] for tr, va in folds],
        'selfTests': checks
    }
    write_json(output / 'protocol.json', protocol)
    baseline_config = {'trial': -1, 'phase': 'baseline', 'hidden': 0, 'preprocess': 'unit',
                       'center': False, 'l2': .001, 'weightPower': 0.0}
    rng = np.random.default_rng(SEED)
    trials, stages = [], []
    started = time.monotonic()
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers, mp_context=multiprocessing.get_context('spawn'),
                                                initializer=initialize_worker, initargs=(x_train, y_train, folds)) as pool:
        baseline_cv = pool.submit(evaluate_trial, baseline_config).result()
        trials.append(baseline_cv)
        next_id = 0
        for phase, count in enumerate(stage_sizes):
            previous_best = sorted(trials, key=trial_rank)[0]['cv']['macroF1']
            if phase == 0:
                configs = [random_config(rng, next_id + i, 'broad') for i in range(count)]
                # Include the unweighted endpoints; random draws alone almost
                # never select exactly zero positive reweighting.
                for i in range(0, count, 9):
                    configs[i]['weightPower'] = 0.0
            else:
                parents = sorted(trials, key=trial_rank)[:6]
                configs = [random_config(rng, next_id + i, ['broad', 'local', 'fine'][phase],
                                         parents[i % len(parents)]['config'], radius=.7 if phase == 1 else .25)
                           for i in range(count)]
            next_id += count
            futures = {pool.submit(evaluate_trial, config): config for config in configs}
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                trial = future.result()
                trials.append(trial)
                completed += 1
                if completed % 12 == 0 or completed == count:
                    best = sorted(trials, key=trial_rank)[0]
                    print(f"Stage {phase + 1}: {completed}/{count}; best CV macro-F1={best['cv']['macroF1']:.4f}; hidden={best['config']['hidden']}", flush=True)
            best = sorted(trials, key=trial_rank)[0]
            stages.append({'stage': phase + 1, 'trialCount': count, 'bestMacroF1': best['cv']['macroF1'],
                           'gain': best['cv']['macroF1'] - previous_best, 'bestConfig': best['config']})
            write_json(output / 'trials.json', sorted(trials, key=lambda t: t['config']['trial']))
            write_json(output / 'stages.json', stages)
    # Robustness check before the external validation set: a different grouped
    # training-only fold assignment for the top four of each model family.
    second_folds = group_folds(y_train, groups, SEED + 1)
    candidates = []
    for is_nonlinear in [False, True]:
        candidates += sorted([t for t in trials if bool(t['config']['hidden']) == is_nonlinear], key=trial_rank)[:4]
    confirmation = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers, mp_context=multiprocessing.get_context('spawn'),
                                                initializer=initialize_worker, initargs=(x_train, y_train, second_folds)) as pool:
        for first, second in zip(candidates, pool.map(evaluate_trial, [t['config'] for t in candidates])):
            confirmation.append({'config': first['config'], 'firstCV': first['cv'], 'secondCV': second['cv'],
                                 'secondOptimizer': second['optimizer'],
                                 'meanMacroF1': (first['cv']['macroF1'] + second['cv']['macroF1']) / 2})
    finalists = []
    for is_nonlinear in [False, True]:
        finalists += sorted([c for c in confirmation if bool(c['config']['hidden']) == is_nonlinear],
                             key=lambda c: (-c['meanMacroF1'], c['secondCV']['bce'], c['config']['trial']))[:3]
    validation_trials = []
    fitted_models = {}
    for candidate in finalists:
        config = candidate['config']
        model = fit(x_train, y_train, config)
        probabilities = predict(model, x_validation)
        options = [metrics(y_validation, probabilities, float(t)) for t in np.linspace(.25, .75, 21)]
        selected_metric = sorted(options, key=lambda m: (-m['macroF1'], abs(m['threshold'] - .5)))[0]
        validation_trials.append({'config': config, 'confirmationMeanMacroF1': candidate['meanMacroF1'],
                                  'validationDefault': metrics(y_validation, probabilities),
                                  'validationSelectedThreshold': selected_metric, 'optimizer': model['optimizer']})
        fitted_models[config['trial']] = model
    chosen = sorted(validation_trials, key=lambda c: (-c['validationSelectedThreshold']['macroF1'],
                    c['validationSelectedThreshold']['bce'], c['config']['hidden'], c['config']['trial']))[0]
    linear_champion = sorted([c for c in validation_trials if c['config']['hidden'] == 0],
                             key=lambda c: (-c['validationSelectedThreshold']['macroF1'],
                                            c['validationSelectedThreshold']['bce'], c['config']['trial']))[0]
    model = fitted_models[chosen['config']['trial']]
    threshold = chosen['validationSelectedThreshold']['threshold']
    selection = {'selected': chosen, 'finalists': validation_trials, 'confirmation': confirmation,
                 'testLabelsUsed': False, 'decisionFrozenBeforeTest': True}
    write_json(output / 'selection.json', selection)
    selection_sha = digest((output / 'selection.json').read_bytes())
    if args.selection_only:
        print(json.dumps({'selectedConfig': chosen['config'], 'decisionThreshold': threshold,
                          'selectionFileSha256': selection_sha, 'testTargetsEvaluated': False}, indent=2))
        return
    baseline = fit(x_train, y_train, baseline_config)
    # The selected configuration, weights and threshold are frozen above. This
    # is the first use of test targets for model-performance metrics.
    dataset = json.loads(dataset_bytes)
    test_rows = [row for row in dataset['items'] if row['split'] == 'test']
    x_test = np.asarray([by_id[row['id']]['vector'] for row in test_rows], dtype=float)
    y_test = np.asarray([row['targets'] for row in test_rows], dtype=float)
    p_test, baseline_test = predict(model, x_test), predict(baseline, x_test)
    linear_model = fitted_models[linear_champion['config']['trial']]
    linear_threshold = linear_champion['validationSelectedThreshold']['threshold']
    linear_test = predict(linear_model, x_test)
    p_validation = predict(model, x_validation)
    p_train = predict(model, x_train)
    exported = {'schemaVersion': 1, 'version': 'meaning-category-v1', 'role': 'meaning-category',
                'categories': CATEGORIES, 'inputDimension': 512, 'encoder': encoded['encoder'],
                'inputProtocol': encoded['inputProtocol'], 'calibrated': False,
                'modelType': 'mlp' if chosen['config']['hidden'] else 'logistic-regression',
                'preprocessor': {'mean': model['mean'].tolist(), 'scale': model['scale'].tolist()},
                'layers': [{'weights': w.tolist(), 'bias': b.tolist(),
                            'activation': 'tanh' if i < len(model['layers']) - 1 else 'linear'}
                           for i, (w, b) in enumerate(model['layers'])],
                'decisionThreshold': threshold, 'hyperparameters': chosen['config'],
                'provenance': {'datasetFileSha256': digest(dataset_bytes), 'embeddingsFileSha256': digest(embedding_bytes),
                               'selectionFileSha256': selection_sha, 'testUsedForSelection': False,
                               'trainedOn': 'train only; validation used for candidate/threshold selection',
                               'trainIds': protocol['trainIds'], 'validationIds': protocol['validationIds']}}
    write_json(FIXTURE / 'classifier.json', exported)
    linear_export = {**exported, 'modelType': 'logistic-regression',
                     'hyperparameters': linear_champion['config'], 'decisionThreshold': linear_threshold,
                     'preprocessor': {'mean': linear_model['mean'].tolist(), 'scale': linear_model['scale'].tolist()},
                     'layers': [{'weights': w.tolist(), 'bias': b.tolist(), 'activation': 'linear'}
                                for w, b in linear_model['layers']]}
    write_json(FIXTURE / 'classifier-linear.json', linear_export)
    predicted = [{'id': row['id'], 'probabilities': probabilities.tolist()}
                 for rows, array in [(training_rows, p_train), (validation_rows, p_validation), (test_rows, p_test)]
                 for row, probabilities in zip(rows, array)]
    write_json(output / 'predictions.json', {'categories': CATEGORIES, 'rows': predicted})
    report = {'schemaVersion': 1, 'selectedConfig': chosen['config'], 'decisionThreshold': threshold,
              'testUsedForSelection': False, 'selectionFileSha256': selection_sha,
              'trialCount': len(trials), 'confirmationTrialCount': len(confirmation), 'stageResults': stages,
              'baseline': {'config': baseline_config, 'cv': baseline_cv['cv'],
                           'validation': metrics(y_validation, predict(baseline, x_validation)),
                           'test': metrics(y_test, baseline_test)},
              'linearChampion': {'config': linear_champion['config'],
                                  'validation': linear_champion['validationSelectedThreshold'],
                                  'test': metrics(y_test, linear_test, linear_threshold),
                                  'parameterCount': int(sum(w.size + b.size for w, b in linear_model['layers']))},
              'selected': {'train': metrics(y_train, p_train, threshold),
                           'validation': metrics(y_validation, p_validation, threshold),
                           'test': metrics(y_test, p_test, threshold),
                           'testAtDefaultThreshold': metrics(y_test, p_test),
                           'testBySource': {source: metrics(y_test[ix], p_test[ix], threshold)
                                            for source in ['legacy', 'authored']
                                            if len(ix := np.asarray([i for i, row in enumerate(test_rows) if row['sourceKind'] == source]))}},
              'uncertainty': {**bootstrap_comparison(y_test, p_test, linear_test,
                              np.asarray([row['groupId'] for row in test_rows]), threshold, baseline_threshold=linear_threshold),
                              'comparator': f'Validation-selected tuned logistic regression; threshold {linear_threshold}.'},
              'testErrors': [{'id': row['id'], 'word': row['word'], 'definition': row['definition'],
                              'labels': row['labels'], 'predicted': [c for c, p in zip(CATEGORIES, probabilities) if p >= threshold],
                              'probabilities': probabilities.tolist()}
                             for row, probabilities in zip(test_rows, p_test)
                             if not np.array_equal(probabilities >= threshold, row['targets'])],
              'convergence': {'primarySearchNonconvergedCVFits': sum(not opt['success'] for t in trials for opt in t['optimizer']),
                              'confirmationNonconvergedCVFits': sum(not opt['success'] for t in confirmation for opt in t['secondOptimizer']),
                              'selectedFinalFit': model['optimizer']},
              'parameterCount': int(sum(w.size + b.size for w, b in model['layers'])),
              'classifierFileSha256': digest((FIXTURE / 'classifier.json').read_bytes()),
              'seconds': time.monotonic() - started,
              'limitations': ['Only 77 test meanings; categories have small overlapping supports.',
                             'AI-authored and AI-reviewed text pilot; no independent human ground truth.',
                             'Repeated tuning can overfit CV/validation; test was used only after freezing the decision.',
                             'Probability outputs are not claimed calibrated; positive reweighting can change calibration.',
                             'No image adapter training, semantic image-quality improvement or personal preference improvement established.',
                             'Offline candidate only; no production model was activated.']}
    write_json(output / 'report.json', report)
    print(json.dumps({'selectedConfig': chosen['config'], 'threshold': threshold,
                      'baselineTestMacroF1': report['baseline']['test']['macroF1'],
                      'selectedTestMacroF1': report['selected']['test']['macroF1'],
                      'testExactMatch': report['selected']['test']['exactMatch'],
                      'seconds': report['seconds']}, indent=2), flush=True)


if __name__ == '__main__':
    main()

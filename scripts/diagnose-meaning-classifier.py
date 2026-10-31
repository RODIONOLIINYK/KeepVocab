#!/usr/bin/env python3
"""Real-batch capacity, learning curves, calibration and precision/coverage audit."""
import gzip
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('meaning_trainer', ROOT / 'scripts/train-meaning-taxonomy.py')
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
np = t.np
OUT = ROOT / 'docs/meaning-taxonomy-training/diagnostics'
FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy'


def load_data():
    data = json.loads((FIXTURE / 'dataset.json').read_text())
    encoded = json.loads(gzip.decompress((FIXTURE / 'embeddings.json.gz').read_bytes()))
    assert encoded['datasetFileSha256'] == t.digest((FIXTURE / 'dataset.json').read_bytes())
    vectors = {r['id']: r['vector'] for r in encoded['rows']}
    parts = {}
    for split in ['train', 'validation']:
        rows = [r for r in data['items'] if r['split'] == split]
        parts[split] = (rows, np.asarray([vectors[r['id']] for r in rows], dtype=float), np.asarray([r['targets'] for r in rows], dtype=float))
    return parts


def from_export(artifact):
    return {'mean': np.asarray(artifact['preprocessor']['mean']), 'scale': np.asarray(artifact['preprocessor']['scale']),
            'layers': [(np.asarray(layer['weights']), np.asarray(layer['bias'])) for layer in artifact['layers']]}


def grouped_subset(rows, y, target, seed):
    groups = np.asarray([r['groupId'] for r in rows])
    unique = list(dict.fromkeys(groups))
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    remaining = [np.flatnonzero(groups == g) for g in unique]
    selected = []
    positives = np.zeros(6)
    while remaining and (len(selected) < target or np.any(positives < 3)):
        deficit = np.maximum(3 - positives, 0)
        scores = [np.minimum(deficit, y[ix].sum(axis=0)).sum() for ix in remaining]
        chosen = int(np.argmax(scores)) if max(scores) > 0 else 0
        ix = remaining.pop(chosen)
        selected.extend(ix.tolist())
        positives += y[ix].sum(axis=0)
    return np.asarray(sorted(selected))


def fitting_trace(x, y, xv, yv, config, limit=400):
    history = []
    mean, scale = t.preprocessing(x, config)
    iteration = 0

    def checkpoint(theta):
        nonlocal iteration
        iteration += 1
        if iteration > 5 and iteration % 5:
            return
        model = {'mean': mean, 'scale': scale, 'layers': t.unpack(theta, x.shape[1], config['hidden'])}
        history.append({'iteration': iteration, 'train': t.metrics(y, t.predict(model, x)),
                        'validation': t.metrics(yv, t.predict(model, xv))})

    model = t.fit(x, y, config, max_iterations=limit, callback=checkpoint)
    history.append({'iteration': model['optimizer']['iterations'],
                    'train': t.metrics(y, t.predict(model, x)), 'validation': t.metrics(yv, t.predict(model, xv))})
    return model, history


def reliability(y, p):
    records = []
    for column, name in enumerate(t.CATEGORIES):
        bins, ece = [], 0.0
        for index in range(10):
            low, high = index / 10, (index + 1) / 10
            mask = (p[:, column] >= low) & ((p[:, column] < high) if index < 9 else (p[:, column] <= high))
            n = int(mask.sum())
            average = float(p[mask, column].mean()) if n else None
            frequency = float(y[mask, column].mean()) if n else None
            if n:
                ece += n / len(y) * abs(average - frequency)
            bins.append({'lower': low, 'upper': high, 'count': n, 'meanPrediction': average, 'observedPositiveFraction': frequency})
        records.append({'category': name, 'ece10Bins': ece, 'brier': float(np.mean((p[:, column] - y[:, column]) ** 2)), 'bins': bins})
    return {'macroECE10Bins': float(np.mean([r['ece10Bins'] for r in records])), 'perClass': records,
            'caveat': 'ECE is a binned small-sample diagnostic, not a guarantee that any individual probability is calibrated.'}


def confidence_errors(rows, y, p):
    wrong = []
    for i, row in enumerate(rows):
        for j, name in enumerate(t.CATEGORIES):
            if (p[i, j] >= .9 and not y[i, j]) or (p[i, j] <= .1 and y[i, j]):
                wrong.append({'id': row['id'], 'word': row['word'], 'definition': row['definition'],
                              'category': name, 'probability': float(p[i, j]), 'goldMembership': int(y[i, j]),
                              'confidenceInWrongBinaryDecision': float(p[i, j] if not y[i, j] else 1 - p[i, j]),
                              'requiredEvidence': row['requiredEvidence'], 'annotationRationale': row['rationale']})
    return sorted(wrong, key=lambda r: (-r['confidenceInWrongBinaryDecision'], r['id'], r['category']))


def threshold_metrics(y, p, threshold):
    predicted = p >= threshold
    truth = y.astype(bool)
    tp_class = (predicted & truth).sum(axis=0)
    fp_class = (predicted & ~truth).sum(axis=0)
    fn_class = (~predicted & truth).sum(axis=0)
    tp, fp = int(tp_class.sum()), int(fp_class.sum())
    positives = predicted.sum(axis=0).astype(int).tolist()
    precision = np.divide(tp_class, tp_class + fp_class, out=np.zeros(6), where=tp_class + fp_class > 0)
    f1 = np.divide(2 * tp_class, 2 * tp_class + fp_class + fn_class, out=np.zeros(6), where=2 * tp_class + fp_class + fn_class > 0)
    return {'threshold': float(threshold), 'microPrecision': tp / (tp + fp) if tp + fp else None,
            'macroPrecision': float(np.mean(precision)),
            'microRecall': float(tp / max(1, y.sum())),
            'macroF1': float(f1.mean()), 'exactMatch': float(np.all(predicted == truth, axis=1).mean()),
            'positivePredictions': tp + fp, 'falsePositives': fp, 'perClassPositivePredictions': positives,
            'allClassesHaveAtLeastThreePredictions': min(positives) >= 3,
            'meaningsWithAnyPositiveLabel': int(np.any(p >= threshold, axis=1).sum())}


def select_precision_threshold(y, p, target=.97):
    # Every distinct predicted value is a possible decision boundary. A coarse
    # uniform grid can miss large coverage changes among near-one probabilities.
    curve = [threshold_metrics(y, p, threshold) for threshold in np.unique(p)]
    eligible = [m for m in curve if m['microPrecision'] is not None and m['microPrecision'] >= target
                and m['allClassesHaveAtLeastThreePredictions']]
    chosen = sorted(eligible, key=lambda m: (-m['microRecall'], -m['macroPrecision'], m['threshold']))[0] if eligible else None
    return chosen, curve


def selective_exact_accuracy(y, p):
    # Weakest binary marginal is a confidence heuristic, not a calibrated joint
    # probability; correlated label errors preclude multiplying six marginals.
    confidence = np.minimum(np.maximum(p, 1 - p).min(axis=1), .999999)
    correct = np.all((p >= .5) == y, axis=1)
    return [{'minimumMarginalConfidence': float(q), 'acceptedMeanings': int((keep := confidence >= q).sum()),
             'coverage': float(keep.mean()), 'exactAccuracy': float(correct[keep].mean()) if keep.any() else None}
            for q in np.linspace(.5, .99, 50)]


def fit_calibration(y, p, mode):
    if mode == 'none':
        return {'method': 'none', 'temperature': 1.0, 'offsets': [0.0] * 6}
    logits = np.log(np.clip(p, 1e-10, 1 - 1e-10) / np.clip(1 - p, 1e-10, 1))
    dimensions = 1 if mode == 'temperature' else 2 if mode == 'temperature-global-bias' else 7

    def objective(parameters):
        inverse = np.exp(-parameters[0])
        offsets = np.zeros(6) if dimensions == 1 else np.full(6, parameters[1]) if dimensions == 2 else parameters[1:]
        z = logits * inverse + offsets
        loss = np.mean(np.logaddexp(0, z) - y * z) + .001 * np.mean(parameters ** 2)
        delta = (t.sigmoid(z) - y) / y.size
        gradient = [float(np.sum(delta * -logits * inverse))]
        if dimensions == 2:
            gradient.append(float(delta.sum()))
        elif dimensions == 7:
            gradient.extend(delta.sum(axis=0))
        return float(loss), np.asarray(gradient) + .002 * parameters / dimensions

    result = t.minimize(objective, np.zeros(dimensions), method='L-BFGS-B', jac=True,
                        bounds=[(-2.3, 2.3)] + [(-4, 4)] * (dimensions - 1))
    assert result.success and np.isfinite(result.x).all()
    offsets = [0.0] * 6 if dimensions == 1 else [float(result.x[1])] * 6 if dimensions == 2 else result.x[1:].tolist()
    return {'method': mode, 'temperature': float(np.exp(result.x[0])), 'offsets': offsets,
            'fitLoss': float(result.fun), 'fitRows': len(y), 'fitScope': 'training-only grouped out-of-fold predictions'}


def calibrate(p, calibration):
    if calibration['method'] == 'none':
        return np.array(p, copy=True)
    raw = np.clip(p, 1e-10, 1 - 1e-10)
    return t.sigmoid(np.log(raw / (1 - raw)) / calibration['temperature'] + calibration['offsets'])


def main():
    data = load_data()
    rows, x, y = data['train']
    validation_rows, xv, yv = data['validation']
    artifact = json.loads((FIXTURE / 'classifier.json').read_text())
    config = artifact['hyperparameters']
    assert config['hidden'] == 32
    model = from_export(artifact)
    raw_train, raw_validation = t.predict(model, x), t.predict(model, xv)
    protocol = {'scope': 'Post-hoc development diagnosis; only train and reused validation are modeled. No test targets loaded for these experiments.',
                'goal': '97% positive-membership precision and separately 97% exact-label-set accuracy; coverage/recall must accompany any selective result.',
                'modelFileSha256': t.digest((FIXTURE / 'classifier.json').read_bytes()),
                'config': config, 'trainIds': [r['id'] for r in rows], 'validationIds': [r['id'] for r in validation_rows],
                'sizeTargets': [24, 48, 96, 160, 244], 'seeds': [101, 202, 303],
                'calibrationFit': 'Grouped out-of-fold training predictions only; method compared on reused validation.',
                'targetRule': 'Maximize recall among training-OOF thresholds with micro-precision >=0.97 and >=3 positive predictions per category. Zero-coverage precision is undefined, never success.',
                'batchOverfit': 'Actual reviewed training meanings and 512-D embeddings; same 32-unit architecture, regularized and zero-L2 fits.'}
    t.write_json(OUT / 'protocol.json', protocol)
    tiny_indices = grouped_subset(rows, y, 24, 101)
    tiny = []
    for name, cfg in [('selectedRegularization', config), ('zeroL2CapacityCheck', {**config, 'l2': 0.0})]:
        fitted, trace = fitting_trace(x[tiny_indices], y[tiny_indices], x[tiny_indices], y[tiny_indices], cfg, limit=1200)
        tiny.append({'name': name, 'count': len(tiny_indices), 'ids': [rows[i]['id'] for i in tiny_indices],
                     'metrics': t.metrics(y[tiny_indices], t.predict(fitted, x[tiny_indices])),
                     'optimizer': fitted['optimizer'], 'trace': trace})
    _, optimization = fitting_trace(x, y, xv, yv, config)
    learning = []
    for seed in [101, 202, 303]:
        for target in [24, 48, 96, 160, 244]:
            ix = grouped_subset(rows, y, target, seed)
            fitted = t.fit(x[ix], y[ix], config)
            learning.append({'seed': seed, 'targetCount': target, 'actualCount': len(ix),
                             'trainIds': [rows[i]['id'] for i in ix],
                             'train': t.metrics(y[ix], t.predict(fitted, x[ix])),
                             'validation': t.metrics(yv, t.predict(fitted, xv)), 'optimizer': fitted['optimizer']})
    print('Capacity and learning curves complete.', flush=True)
    groups = np.asarray([r['groupId'] for r in rows])
    folds = t.group_folds(y, groups, t.SEED)
    oof = np.zeros_like(y, dtype=float)
    for tr, va in folds:
        fitted = t.fit(x[tr], y[tr], config)
        oof[va] = t.predict(fitted, x[va])
    assert np.isfinite(oof).all() and np.all(oof.std(axis=0) > .01), 'OOF probabilities lost precision or coverage.'
    original = json.loads((ROOT / 'docs/meaning-taxonomy-training/report.json').read_text())
    selected_cv = next(stage['bestMacroF1'] for stage in original['stageResults'] if stage['bestConfig']['trial'] == config['trial'])
    assert abs(t.metrics(y, oof)['macroF1'] - selected_cv) < 1e-12, 'Baseline CV reproduction changed.'
    calibration_results = []
    for mode in ['none', 'temperature', 'temperature-global-bias', 'temperature-class-bias']:
        calibration = fit_calibration(y, oof, mode)
        predictions = calibrate(raw_validation, calibration)
        cutoff, curve = select_precision_threshold(y, calibrate(oof, calibration))
        calibration_results.append({'calibration': calibration, 'validation': t.metrics(yv, predictions, artifact['decisionThreshold']),
                                    'validationReliability': reliability(yv, predictions),
                                    'oof97PrecisionThreshold': cutoff,
                                    'validationAtOOF97Threshold': threshold_metrics(yv, predictions, cutoff['threshold']) if cutoff else None})
    raw_validation_metrics = t.metrics(yv, raw_validation, artifact['decisionThreshold'])
    admissible = [r for r in calibration_results if r['validation']['brier'] <= raw_validation_metrics['brier'] + 1e-12]
    chosen = min(admissible, key=lambda r: (r['validation']['bce'], r['validation']['brier']))
    t.write_json(OUT / 'calibration-selection.json', {'selected': chosen,
                 'policy': 'Minimize reused-validation BCE among methods not worsening validation Brier; fit parameters only on training OOF. This is development selection, not an independent confirmation.',
                 'candidates': calibration_results})
    calibration = chosen['calibration']
    transported_threshold = float(calibrate(np.full((1, 6), artifact['decisionThreshold']), calibration)[0, 0])
    calibrated_artifact = {**artifact, 'calibration': calibration,
                           'calibrationApplied': calibration['method'] != 'none', 'calibrated': False,
                           'probabilityReliabilityEstablished': False,
                           'decisionThreshold': transported_threshold,
                           'provenance': {**artifact['provenance'],
                              'rawModelFileSha256': protocol['modelFileSha256'],
                              'calibrationFitOn': 'training grouped OOF predictions only',
                              'developmentValidationReused': True,
                              'calibrationSelectionSha256': t.digest((OUT / 'calibration-selection.json').read_bytes())}}
    t.write_json(FIXTURE / 'classifier-calibrated.json', calibrated_artifact)
    raw_cutoff, raw_curve = select_precision_threshold(y, oof)
    p_calibrated = calibrate(raw_validation, chosen['calibration'])
    report = {'schemaVersion': 1, 'testUsed': False, 'rawModelUnchanged': True,
              'tinyBatchFits': tiny, 'optimizationTrace': optimization, 'sampleSizeLearningCurve': learning,
              'fullTrain': t.metrics(y, raw_train, artifact['decisionThreshold']),
              'validation': raw_validation_metrics,
              'confidence': {'rawReliability': reliability(yv, raw_validation),
                             'confidentWrongLabelsAt90Percent': confidence_errors(validation_rows, yv, raw_validation),
                             'rawSelectiveExactCurve': selective_exact_accuracy(yv, raw_validation),
                             'calibratedSelectiveExactCurve': selective_exact_accuracy(yv, p_calibrated)},
              'precisionTarget': {'target': .97, 'selectionRows': 'training OOF', 'rawOOFChosen': raw_cutoff,
                                  'rawValidationAtOOFThreshold': threshold_metrics(yv, raw_validation, raw_cutoff['threshold']) if raw_cutoff else None,
                                  'exactThresholdsSearched': len(raw_curve),
                                  'rawValidationThresholdCurve': [threshold_metrics(yv, raw_validation, m['threshold']) for m in raw_curve[::max(1, len(raw_curve) // 250)]],
                                  'calibratedValidationThresholdCurve': [threshold_metrics(yv, p_calibrated, threshold) for threshold in np.linspace(.05, .999, 251)]},
              'calibration': {'candidates': calibration_results, 'selected': chosen},
              'limitations': ['Validation was already used for earlier selection; new diagnostics/calibration are development evidence.',
                             'No physical-phone battery or thermal measurement is available.',
                             'More confidence does not establish correctness; calibration cannot restore missing semantic information.',
                             'No labels were changed to hide mistakes; no test-based hyperparameter tuning is performed.']}
    t.write_json(OUT / 'report.json', report)
    t.write_json(OUT / 'validation-predictions.json', {'categories': t.CATEGORIES,
        'rows': [{'id': row['id'], 'raw': p.tolist(), 'calibrated': q.tolist()} for row, p, q in zip(validation_rows, raw_validation, p_calibrated)]})
    print(json.dumps({'tinyBatchExactMatch': [r['metrics']['exactMatch'] for r in tiny],
                      'trainExact': report['fullTrain']['exactMatch'], 'validationExact': report['validation']['exactMatch'],
                      'confidentWrongLabels': len(report['confidence']['confidentWrongLabelsAt90Percent']),
                      'raw97OOFCutoff': raw_cutoff,
                      'calibration': {'parameters': chosen['calibration'], 'validationBCE': chosen['validation']['bce'],
                                      'validationBrier': chosen['validation']['brier'],
                                      'oof97Cutoff': chosen['oof97PrecisionThreshold']}}, indent=2), flush=True)


if __name__ == '__main__':
    main()

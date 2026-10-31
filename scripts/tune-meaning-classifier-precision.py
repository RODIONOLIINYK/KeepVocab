#!/usr/bin/env python3
"""Fixed-width precision-targeted development search; original test excluded."""
import concurrent.futures
import importlib.util
import json
import multiprocessing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('meaning_diagnostics', ROOT / 'scripts/diagnose-meaning-classifier.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
t, np = d.t, d.np
OUT = d.OUT / 'precision-search'
DATA = None
SEED = 970032


def initialize(x, y, folds):
    global DATA
    DATA = x, y, folds


def out_of_fold(config, x, y, folds):
    p = np.zeros_like(y, dtype=float)
    optimizers = []
    for tr, va in folds:
        fit = t.fit(x[tr], y[tr], config)
        p[va] = t.predict(fit, x[va])
        optimizers.append(fit['optimizer'])
    assert np.isfinite(p).all() and np.all(p.std(axis=0) > 0)
    return p, optimizers


def evaluate(config):
    x, y, folds = DATA
    p, optimizers = out_of_fold(config, x, y, folds)
    threshold, _ = d.select_precision_threshold(y, p)
    return {'config': config, 'cv': t.metrics(y, p), 'target': threshold, 'optimizers': optimizers}


def rank(record):
    point = record['target']
    return (0 if point else 1, -point['microRecall'] if point else record['cv']['bce'],
            record['cv']['bce'], -record['cv']['macroAveragePrecision'], record['config']['trial'])


def main():
    rows, x, y = d.load_data()['train']
    validation_rows, xv, yv = d.load_data()['validation']
    base = json.loads((d.FIXTURE / 'classifier.json').read_text())
    assert base['provenance']['datasetFileSha256'] == t.digest((d.FIXTURE / 'dataset.json').read_bytes())
    groups = np.asarray([r['groupId'] for r in rows])
    folds = t.group_folds(y, groups, SEED)
    protocol = {'schemaVersion': 1, 'seed': SEED, 'targetPrecision': .97, 'precisionDefinition': 'micro positive-membership precision',
                'secondaryMetrics': ['recall', 'macro precision/F1', 'BCE', 'Brier', 'average precision', 'exact label-set accuracy'],
                'minimumPredictedPositivesPerClass': 3, 'hiddenUnits': 32, 'workers': 6,
                'fitScope': '244 train meanings; grouped 4-fold CV; no test targets supplied',
                'validationScope': '91 reused development-validation meanings; not independent confirmation',
                'search': '32 broad plus 32 narrowed configurations, fixed architecture, L2/positive-weighting/preprocessing/optimization budget.',
                'selection': 'CV: maximize recall satisfying 97% precision and category support; break ties with BCE and AP. Validate three finalists plus the preserved baseline. Validation: prioritize supported 97% points and recall; if none, report failure and retain best probability-loss candidate.',
                'learningBudgetInterpretation': 'Iteration caps are intentional early-stopping candidates, not claims every trial converged.',
                'testUsed': False, 'labelsChanged': False,
                'trainIds': [r['id'] for r in rows], 'validationIds': [r['id'] for r in validation_rows]}
    t.write_json(OUT / 'protocol.json', protocol)
    rng = np.random.default_rng(SEED)
    baseline_config = {**base['hyperparameters'], 'trial': -1, 'phase': 'preservedBaseline', 'maxIterations': 400}
    results = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=6, mp_context=multiprocessing.get_context('spawn'),
                                                initializer=initialize, initargs=(x, y, folds)) as pool:
        results.append(pool.submit(evaluate, baseline_config).result())
        for stage in range(2):
            parents = sorted(results, key=rank)[:6]
            configs = []
            for index in range(32):
                if stage == 0:
                    config = {'hidden': 32, 'preprocess': str(rng.choice(['scaled', 'standardize'])), 'center': True,
                              'l2': float(10 ** rng.uniform(-4.5, -1.5)),
                              'weightPower': float(rng.choice([0, .25, .5, .75, 1])),
                              'maxIterations': int(rng.choice([40, 80, 160, 400]))}
                else:
                    parent = parents[index % len(parents)]['config']
                    config = {**parent, 'l2': float(10 ** np.clip(np.log10(parent['l2']) + rng.normal(0, .35), -5, -1)),
                              'weightPower': float(np.clip(parent['weightPower'] + rng.normal(0, .1), 0, 1))}
                configs.append({**config, 'trial': stage * 32 + index, 'phase': 'broad' if stage == 0 else 'narrow'})
            for count, result in enumerate(pool.map(evaluate, configs), 1):
                results.append(result)
                if count % 8 == 0:
                    best = sorted(results, key=rank)[0]
                    print(f"Precision stage {stage + 1}, {count}/32; best supported OOF recall at 97% precision: {best['target']['microRecall'] if best['target'] else 'infeasible'}", flush=True)
            t.write_json(OUT / 'trials.json', results)
    finalists = sorted(results, key=rank)[:3]
    if not any(r['config']['trial'] == -1 for r in finalists):
        finalists.append(results[0])
    assessed = []
    fitted = {}
    for candidate in finalists:
        config = candidate['config']
        p_oof, _ = out_of_fold(config, x, y, folds)
        raw_cutoff, _ = d.select_precision_threshold(y, p_oof)
        fit = t.fit(x, y, config)
        p_raw = t.predict(fit, xv)
        calibration = d.fit_calibration(y, p_oof, 'temperature-global-bias')
        p_calibrated = d.calibrate(p_raw, calibration)
        raw_metrics, cal_metrics = t.metrics(yv, p_raw), t.metrics(yv, p_calibrated)
        use_calibration = cal_metrics['bce'] < raw_metrics['bce'] and cal_metrics['brier'] <= raw_metrics['brier']
        actual_calibration = calibration if use_calibration else d.fit_calibration(y, p_oof, 'none')
        probabilities = p_calibrated if use_calibration else p_raw
        if raw_cutoff:
            raw_threshold = float(np.clip(raw_cutoff['threshold'], 1e-10, 1 - 1e-10))
            threshold = float(d.calibrate(np.full((1, 6), raw_threshold), actual_calibration)[0, 0])
            point = d.threshold_metrics(yv, probabilities, threshold)
        else:
            threshold, point = .5, None
        record = {'config': config, 'cv': candidate['cv'], 'oofTarget': raw_cutoff,
                  'calibration': actual_calibration, 'validationAtDefault': t.metrics(yv, probabilities),
                  'validationAtOOFTarget': point, 'evaluationThreshold': threshold,
                  'calibrationParametersFitOn': 'training OOF only',
                  'validationGoalMet': bool(point and point['microPrecision'] is not None and point['microPrecision'] >= .97
                                             and point['allClassesHaveAtLeastThreePredictions'])}
        assessed.append(record)
        fitted[config['trial']] = fit
    feasible = [r for r in assessed if r['validationGoalMet']]
    if feasible:
        selected = min(feasible, key=lambda r: (-r['validationAtOOFTarget']['microRecall'], r['validationAtDefault']['bce'], r['config']['trial']))
    else:
        selected = min(assessed, key=lambda r: (r['validationAtDefault']['bce'], r['validationAtDefault']['brier'], r['config']['trial']))
    t.write_json(OUT / 'selection.json', {'selected': selected, 'candidates': assessed, 'testUsed': False,
                 'goalMetOnReusedValidation': bool(feasible), 'independentConfirmation': False})
    model = fitted[selected['config']['trial']]
    exported = {**base, 'hyperparameters': selected['config'],
                'decisionThreshold': selected['evaluationThreshold'],
                'preprocessor': {'mean': model['mean'].tolist(), 'scale': model['scale'].tolist()},
                'layers': [{'weights': w.tolist(), 'bias': b.tolist(), 'activation': 'tanh' if i == 0 else 'linear'}
                           for i, (w, b) in enumerate(model['layers'])],
                'calibration': selected['calibration'], 'calibrationApplied': selected['calibration']['method'] != 'none',
                'calibrated': False, 'probabilityReliabilityEstablished': False,
                'provenance': {**base['provenance'], 'developmentCandidate': True,
                               'selectionFileSha256': t.digest((OUT / 'selection.json').read_bytes()),
                               'testUsedForSelection': False, 'developmentValidationReused': True}}
    t.write_json(d.FIXTURE / 'classifier-precision-candidate.json', exported)
    p_raw = t.predict(model, xv)
    p = d.calibrate(p_raw, selected['calibration'])
    t.write_json(OUT / 'validation-predictions.json', {'rows': [{'id': row['id'], 'probabilities': values.tolist()}
                                                            for row, values in zip(validation_rows, p)]})
    t.write_json(OUT / 'report.json', {'configurationCount': len(results), 'newConfigurations': 64,
                 'validationGoalMet': bool(feasible), 'selected': selected, 'allFinalists': assessed,
                 'testUsed': False, 'labelsChanged': False, 'originalModelChanged': False,
                 'caveats': ['97% development precision is not 97% full label-set accuracy or a deployment guarantee.',
                             'Reused validation is not independent confirmation. Recall and per-class support accompany the precision target.',
                             'The test set and ground-truth annotations were not used to refine this search.']})
    print(json.dumps({'validationGoalMet': bool(feasible), 'selected': selected}, indent=2), flush=True)


if __name__ == '__main__':
    main()

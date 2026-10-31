#!/usr/bin/env python3
"""Train-only grouped refinement, fresh validation selection, separate frozen test phase."""
import argparse
import concurrent.futures
import gzip
import importlib.util
import json
import multiprocessing
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

d = module('diagnostics', 'scripts/diagnose-meaning-classifier.py')
r = module('supplement_metrics', 'scripts/evaluate-meaning-supplement.py')
t, np = d.t, d.np
FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy/expanded-1000'
OUT = ROOT / 'docs/meaning-taxonomy-training/expanded-1000'
SEED = 10002026
DATA = None


def read(path):
    return json.loads(path.read_text())


def load_partitions(names):
    data_bytes = (FIXTURE / 'dataset.json').read_bytes()
    encoded_bytes = (FIXTURE / 'embeddings.json.gz').read_bytes()
    data = json.loads(data_bytes); encoded = json.loads(gzip.decompress(encoded_bytes))
    assert encoded['datasetFileSha256'] == t.digest(data_bytes)
    vectors = {row['id']: row['vector'] for row in encoded['rows']}
    result = {}
    for name in names:
        rows = [row for row in data['items'] if row['split'] == name]
        result[name] = (rows, np.asarray([vectors[row['id']] for row in rows], dtype=float),
                        np.asarray([row['targets'] for row in rows], dtype=float))
    return result, encoded, t.digest(data_bytes), t.digest(encoded_bytes)


def initialize(x, y, folds):
    global DATA
    DATA = x, y, folds


def oof_predictions(config, x, y, folds):
    p = np.zeros_like(y, dtype=float); optimizers = []
    for training, validation in folds:
        model = t.fit(x[training], y[training], config)
        p[validation] = t.predict(model, x[validation]); optimizers.append(model['optimizer'])
    assert np.isfinite(p).all() and np.all(p.std(axis=0) > .001)
    return p, optimizers


def best_f1_threshold(y, p):
    options = [r.expanded_metrics(y, p, float(v)) for v in np.linspace(.25, .75, 21)]
    return sorted(options, key=lambda m: (-m['macroF1'], -m['exactMatch'], abs(m['threshold'] - .5)))[0]


def evaluate_trial(config):
    x, y, folds = DATA
    p, optimizers = oof_predictions(config, x, y, folds)
    return {'config': config, 'cv': best_f1_threshold(y, p), 'optimizers': optimizers}


def rank(record):
    return (-record.get('confirmationMeanF1', record['cv']['macroF1']), record['cv']['bce'],
            -record['cv']['exactMatch'], record['config']['trial'])


def equivalent_linear(linear, mlp):
    """Predeclared operational margins, not statistical proof of equivalence."""
    margins = {'macroF1': .01, 'exactMatch': .02, 'microPrecision': .02, 'microRecall': .02,
               'bce': .01, 'brier': .003, 'perClassF1': .05}
    checks = {key: linear[key] >= mlp[key] - margins[key]
              for key in ['macroF1', 'exactMatch', 'microPrecision', 'microRecall']}
    checks.update({key: linear[key] <= mlp[key] + margins[key] for key in ['bce', 'brier']})
    checks['perClassF1'] = all(linear['perClass'][c]['f1'] >= mlp['perClass'][c]['f1'] - margins['perClassF1']
                              for c in t.CATEGORIES)
    return {'passed': all(checks.values()), 'checks': checks, 'margins': margins,
            'interpretation': 'Predeclared practical tolerances; small held-out samples do not prove statistical equivalence.'}


def export_model(model, config, threshold, calibration, encoded, provenance):
    artifact = {'schemaVersion': 1, 'version': 'meaning-category-v1', 'role': 'meaning-category',
                'categories': t.CATEGORIES, 'inputDimension': 512, 'encoder': encoded['encoder'],
                'inputProtocol': encoded['inputProtocol'], 'modelType': 'mlp' if config['hidden'] else 'logistic-regression',
                'preprocessor': {'mean': model['mean'].tolist(), 'scale': model['scale'].tolist()},
                'layers': [{'weights': w.tolist(), 'bias': b.tolist(), 'activation': 'tanh' if i < len(model['layers']) - 1 else 'linear'}
                           for i, (w, b) in enumerate(model['layers'])],
                'hyperparameters': config, 'decisionThreshold': threshold,
                'calibration': calibration, 'calibrationApplied': calibration['method'] != 'none',
                'calibrated': False, 'probabilityReliabilityEstablished': False, 'provenance': provenance}
    return artifact


def candidate_probabilities(artifact, x):
    return d.calibrate(t.predict(d.from_export(artifact), x), artifact.get('calibration', {'method': 'none'}))


def select(workers):
    started = time.monotonic()
    data, encoded, dataset_hash, embeddings_hash = load_partitions(['train', 'validation'])
    rows, x, y = data['train']; validation_rows, xv, yv = data['validation']
    assert len(rows) == 590 and len(validation_rows) == 120
    groups = np.asarray([row['groupId'] for row in rows])
    folds = t.group_folds(y, groups, SEED)
    old_models = {name: read(ROOT / f'tests/fixtures/meaning-taxonomy/{file}')
                  for name, file in [('linear', 'classifier-linear.json'), ('32', 'classifier.json')]}
    protocol = {'schemaVersion': 1, 'datasetFileSha256': dataset_hash, 'embeddingsFileSha256': embeddings_hash,
                'seed': SEED, 'fitSeed': 7919, 'workers': workers,
                'trainIds': [row['id'] for row in rows], 'validationIds': [row['id'] for row in validation_rows],
                'trainGroups': len(set(groups)), 'validationScope': '120 new grouped meanings; original evaluation retained as retired diagnostics',
                'input': '512-D frozen CLIP original-definition text vectors only; six independent sigmoid memberships',
                'search': '48 broad (24 per family), 32 narrowed (16 per family), optional 24 fine (12 per family) if second-stage pooled CV best F1 gain exceeds .003. Two preserved configurations are controls.',
                'searchSpace': {'architectures': ['linear six-output logistic', '512-32-tanh-6-sigmoid'],
                                'preprocessing': ['scaled and centered', 'per-coordinate standardization and centering'],
                                'linearL2Log10': [-5, -1], 'mlpL2Log10': [-4, -1], 'positiveWeightPower': [0, .25, .5, .75, 1], 'maxIterations': 400},
                'confirmation': 'Two finalists per family replayed on a second training-only 4-fold grouping; both fresh-validation assessed.',
                'threshold': 'Global F1 threshold selected on training OOF only from .25:.025:.75; transport under global calibration preserves labels.',
                'calibration': 'Only none or temperature-plus-shared-logit-bias; parameters fitted on train OOF, applied if fresh-validation BCE improves and Brier is no more than .002 worse.',
                'familySelection': 'Within each architecture: validation macro-F1, BCE, exact match. Prefer linear if all practical tolerances hold against the best 32-unit candidate.',
                'linearTolerances': {'macroF1': .01, 'exactMatch': .02, 'microPrecision': .02, 'microRecall': .02, 'bce': .01, 'brier': .003, 'perClassF1': .05},
                'promotion': 'Architecture selection frozen before test. Promote only if the selected model on fresh test is no more than .01 worse in macro-F1 and .02 in exact match/micro precision/micro recall than the frozen original 32-unit head. Otherwise preserve the previous current recommendation; do not switch to a different new architecture using test outcomes.',
                'testUsedForSelection': False, 'legacyEvaluationUsedForSelection': False,
                'classBalance': read(FIXTURE / 'dataset.json')['classBalance']['train'],
                'limitations': ['AI-authored/reviewed balanced pilot; shared authorship is not expert truth or real-app prevalence.',
                               'Validation used for selection; confidence and practical tolerances need fresh-test confirmation.']}
    t.write_json(OUT / 'protocol.json', protocol)
    protocol_hash = t.digest((OUT / 'protocol.json').read_bytes())
    configs = [{**old_models[name]['hyperparameters'], 'trial': -2 + i, 'phase': 'preserved-config', 'maxIterations': 400}
               for i, name in enumerate(['linear', '32'])]
    rng = np.random.default_rng(SEED); trials = []; stages = []; trial_index = 0
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context('spawn'),
                                                initializer=initialize, initargs=(x, y, folds)) as pool:
        trials.extend(pool.map(evaluate_trial, configs))
        last_best = max(row['cv']['macroF1'] for row in trials)
        for stage, count in enumerate([48, 32, 24]):
            if stage == 2 and stages[-1]['bestF1Gain'] <= .003: break
            candidates = []
            for hidden in [0, 32]:
                parents = sorted([row for row in trials if row['config']['hidden'] == hidden], key=rank)[:4]
                for i in range(count // 2):
                    if stage == 0:
                        config = {'hidden': hidden, 'preprocess': str(rng.choice(['scaled', 'standardize'])), 'center': True,
                                  'l2': float(10 ** rng.uniform(-5 if hidden == 0 else -4, -1)),
                                  'weightPower': float(rng.choice([0, .25, .5, .75, 1]))}
                    else:
                        parent = parents[i % len(parents)]['config']
                        config = {**parent, 'l2': float(10 ** np.clip(np.log10(parent['l2']) + rng.normal(0, .35 if stage == 1 else .15), -6, -.3)),
                                  'weightPower': float(np.clip(parent['weightPower'] + rng.normal(0, .15 if stage == 1 else .07), 0, 1))}
                    candidates.append({**config, 'trial': trial_index, 'phase': ['broad', 'narrow', 'fine'][stage], 'maxIterations': 400}); trial_index += 1
            for i, value in enumerate(pool.map(evaluate_trial, candidates), 1):
                trials.append(value)
                if i % 8 == 0: print(f"Stage {stage+1} {i}/{count}; CV best macro-F1={max(v['cv']['macroF1'] for v in trials):.4f}", flush=True)
            best = max(row['cv']['macroF1'] for row in trials)
            stages.append({'stage': stage + 1, 'configurations': count, 'bestCVF1': best, 'bestF1Gain': best - last_best}); last_best = best
            t.write_json(OUT / 'trials.json', trials); t.write_json(OUT / 'stages.json', stages)
    finalists = []
    for hidden in [0, 32]: finalists += sorted([row for row in trials if row['config']['hidden'] == hidden], key=rank)[:2]
    second = t.group_folds(y, groups, SEED + 1)
    assessed = []
    for trial in finalists:
        config = trial['config']; p, _ = oof_predictions(config, x, y, folds)
        confirmation, optimizers = oof_predictions(config, x, y, second)
        confirmed = best_f1_threshold(y, confirmation)
        fitted = t.fit(x, y, config); pv = t.predict(fitted, xv)
        raw_threshold = trial['cv']['threshold']
        raw_validation = r.expanded_metrics(yv, pv, raw_threshold)
        calibration = d.fit_calibration(y, p, 'temperature-global-bias')
        calibrated_validation = d.calibrate(pv, calibration)
        threshold = float(d.calibrate(np.full((1, 6), raw_threshold), calibration)[0, 0])
        cal_validation = r.expanded_metrics(yv, calibrated_validation, threshold)
        use_calibration = cal_validation['bce'] < raw_validation['bce'] and cal_validation['brier'] <= raw_validation['brier'] + .002
        if not use_calibration:
            calibration = d.fit_calibration(y, p, 'none'); threshold = raw_threshold
        v = d.calibrate(pv, calibration)
        target97, _ = d.select_precision_threshold(y, d.calibrate(p, calibration))
        provenance = {'datasetFileSha256': dataset_hash, 'embeddingsFileSha256': embeddings_hash,
                      'protocolFileSha256': protocol_hash, 'trainIds': protocol['trainIds'], 'validationIds': protocol['validationIds'],
                      'trainedOn': '590 train meanings only; 120 new validation meanings for model/calibration selection; threshold from training OOF.',
                      'testUsedForSelection': False, 'legacyEvaluationUsedForSelection': False}
        artifact = export_model(fitted, config, threshold, calibration, encoded, provenance)
        name = f'candidate-{config["hidden"]}-{config["trial"]}.json'
        t.write_json(FIXTURE / name, artifact)
        assessed.append({'config': config, 'cv': trial['cv'], 'secondCV': confirmed,
                         'confirmationMeanF1': (trial['cv']['macroF1'] + confirmed['macroF1']) / 2,
                         'confirmationOptimizers': optimizers, 'optimizer': fitted['optimizer'],
                         'validation': r.expanded_metrics(yv, v, threshold), 'rawValidation': raw_validation,
                         'globalCalibrationValidation': cal_validation, 'calibrationApplied': use_calibration,
                         'oofTarget97': target97,
                         'validationAtOOFTarget97': d.threshold_metrics(yv, v, target97['threshold']) if target97 else None,
                         'artifact': name, 'artifactFileSha256': t.digest((FIXTURE / name).read_bytes())})
        print(f"Finalist hidden={config['hidden']} trial={config['trial']}: validation macro-F1={assessed[-1]['validation']['macroF1']:.4f}", flush=True)
    family = {}
    for hidden, name in [(0, 'linear'), (32, '32')]:
        best = sorted([row for row in assessed if row['config']['hidden'] == hidden], key=lambda row: (-row['validation']['macroF1'], row['validation']['bce'], -row['validation']['exactMatch']))[0]
        family[name] = best
        (FIXTURE / f'classifier-{name}.json').write_bytes((FIXTURE / best['artifact']).read_bytes())
    equivalence = equivalent_linear(family['linear']['validation'], family['32']['validation'])
    selected = 'linear' if equivalence['passed'] else '32'
    (FIXTURE / 'classifier.json').write_bytes((FIXTURE / f'classifier-{selected}.json').read_bytes())
    # Fixed original-config expanded fit provides a controlled data-size comparison.
    fixed = t.fit(x, y, old_models['32']['hyperparameters'])
    t.write_json(FIXTURE / 'classifier-fixed-32.json', export_model(fixed, old_models['32']['hyperparameters'], old_models['32']['decisionThreshold'], {'method': 'none', 'temperature': 1.0, 'offsets': [0.0] * 6}, encoded,
                  {'datasetFileSha256': dataset_hash, 'trainIds': protocol['trainIds'], 'testUsedForSelection': False, 'control': 'Original frozen 32-unit config/seed/threshold fitted on expanded train590'}))
    decision = {'schemaVersion': 1, 'selectedArchitecture': selected, 'practicalLinearComparison': equivalence,
                'families': family, 'finalists': assessed, 'testUsedForSelection': False,
                'classifierFileSha256': t.digest((FIXTURE / 'classifier.json').read_bytes()),
                'protocolFileSha256': protocol_hash, 'decisionFrozenBeforeTest': True,
                'configurationCount': len(trials), 'newConfigurationCount': trial_index, 'elapsedSeconds': time.monotonic() - started}
    t.write_json(OUT / 'selection.json', decision)
    predictions = []
    for name in ['linear', '32']:
        artifact = read(FIXTURE / f'classifier-{name}.json'); p = candidate_probabilities(artifact, xv)
        predictions += [{'architecture': name, 'id': row['id'], 'probabilities': pp.tolist()} for row, pp in zip(validation_rows, p)]
    t.write_json(OUT / 'validation-predictions.json', {'rows': predictions})
    print(json.dumps({'selectedArchitecture': selected, 'linearEquivalence': equivalence, 'freshTestEvaluated': False}, indent=2), flush=True)


def evaluate():
    selection_bytes = (OUT / 'selection.json').read_bytes(); selection = json.loads(selection_bytes)
    assert selection['decisionFrozenBeforeTest'] and not selection['testUsedForSelection']
    assert selection['classifierFileSha256'] == t.digest((FIXTURE / 'classifier.json').read_bytes())
    data, _, _, _ = load_partitions(['test', 'legacy-validation', 'legacy-test'])
    rows, x, y = data['test']; assert len(rows) == 120
    artifacts = {name: read(FIXTURE / file) for name, file in [('linear', 'classifier-linear.json'), ('32', 'classifier-32.json'), ('fixed-expanded-32', 'classifier-fixed-32.json')]}
    artifacts['original244-32'] = read(ROOT / 'tests/fixtures/meaning-taxonomy/classifier.json')
    artifacts['supplement301-32'] = read(ROOT / 'tests/fixtures/meaning-taxonomy/supplement/classifier-32.json')
    results, probabilities = {}, {}
    for name, artifact in artifacts.items():
        p = candidate_probabilities(artifact, x); probabilities[name] = p
        results[name] = {'test': r.expanded_metrics(y, p, artifact['decisionThreshold'])}
        if name in ['linear', '32']:
            target = selection['families'][name]['oofTarget97']
            results[name]['testAtOOFTarget97'] = d.threshold_metrics(y, p, target['threshold']) if target else None
            results[name]['legacyDiagnostics'] = {split: r.expanded_metrics(yy, candidate_probabilities(artifact, xx), artifact['decisionThreshold'])
                                                 for split, (_, xx, yy) in data.items() if split != 'test'}
    name = selection['selectedArchitecture']; chosen = results[name]['test']; old = results['original244-32']['test']
    promotion_checks = {key: chosen[key] >= old[key] - margin for key, margin in [('macroF1', .01), ('exactMatch', .02), ('microPrecision', .02), ('microRecall', .02)]}
    comparison = equivalent_linear(results['linear']['test'], results['32']['test'])
    bootstrap = t.bootstrap_comparison(y, probabilities['linear'], probabilities['32'], np.asarray([row['groupId'] for row in rows]),
                                      artifacts['linear']['decisionThreshold'], repetitions=1000, baseline_threshold=artifacts['32']['decisionThreshold'])
    bootstrap.update({'reportedModel': 'linear', 'comparatorModel': '32', 'differenceDirection': 'linear minus 32'})
    report = {'schemaVersion': 1, 'selectionFileSha256': t.digest(selection_bytes), 'selectedArchitecture': name,
              'freshTestCount': 120, 'testUsedForArchitectureOrHyperparameterSelection': False,
              'results': results, 'linearPracticalMarginsOnFreshTest': comparison, 'pairedGroupBootstrap': bootstrap,
              'promotionGate': {'passed': all(promotion_checks.values()), 'checks': promotion_checks,
                                'comparator': 'frozen original244 32-unit architecture/config/weights/threshold',
                                'meaning': 'Predeclared confirmation gate; failing preserves the previous recommendation rather than choosing a new architecture using test outcomes.'},
              'limitations': ['Balanced AI-authored/reviewed pilot, not human-expert truth or real-app prevalence.',
                             'Architecture and thresholds frozen before this fresh-test evaluation; legacy evaluation is retired diagnosis.',
                             'Practical margins and a confidence interval including zero do not establish population-level equivalence.']}
    t.write_json(OUT / 'report.json', report)
    t.write_json(OUT / 'test-predictions.json', {'categories': t.CATEGORIES, 'rows': [
        {'id': row['id'], 'word': row['word'], 'targets': row['targets'], 'probabilities': {name: p[i].tolist() for name, p in probabilities.items()}}
        for i, row in enumerate(rows)]})
    if report['promotionGate']['passed']:
        registry = {'schemaVersion': 1, 'role': 'current-meaning-category-classifier', 'modelType': artifacts[name]['modelType'],
                    'artifact': 'tests/fixtures/meaning-taxonomy/expanded-1000/classifier.json', 'artifactFileSha256': selection['classifierFileSha256'],
                    'selection': 'docs/meaning-taxonomy-training/expanded-1000/selection.json', 'confirmation': 'docs/meaning-taxonomy-training/expanded-1000/report.json',
                    'productionPersonalizerChanged': False}
        t.write_json(ROOT / 'tests/fixtures/meaning-taxonomy/current-classifier.json', registry)
    print(json.dumps({'selectedArchitecture': name, 'promotionGate': report['promotionGate'],
                      'freshTest': {n: {k: m['test'][k] for k in ['macroF1', 'exactMatch', 'microPrecision', 'microRecall', 'bce', 'brier']} for n, m in results.items()}}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--phase', choices=['select', 'evaluate'], default='select'); parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    if args.phase == 'select': select(args.workers)
    else: evaluate()

#!/usr/bin/env python3
"""Post-hoc diagnostic comparison of frozen finalists; no hyperparameter search."""
import importlib.util
import json
from pathlib import Path
import gzip

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('meaning_trainer', ROOT / 'scripts/train-meaning-taxonomy.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)
np = trainer.np
OUTPUT = ROOT / 'docs/meaning-taxonomy-training'
FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy'


def read(path):
    return json.loads(path.read_text())


def loaded_model(artifact):
    return {'mean': np.asarray(artifact['preprocessor']['mean']), 'scale': np.asarray(artifact['preprocessor']['scale']),
            'layers': [(np.asarray(layer['weights']), np.asarray(layer['bias'])) for layer in artifact['layers']]}


def expanded_metrics(y, p, threshold):
    result = trainer.metrics(y, p, threshold)
    cls = result['perClass'].values()
    tp = sum(m['tp'] for m in cls)
    fp = sum(m['fp'] for m in cls)
    fn = sum(m['fn'] for m in cls)
    result.update({'macroPrecision': float(np.mean([m['precision'] for m in cls])),
                   'macroRecall': float(np.mean([m['recall'] for m in cls])),
                   'microPrecision': tp / max(1, tp + fp), 'microRecall': tp / max(1, tp + fn),
                   'hammingAccuracy': 1 - (fp + fn) / y.size,
                   'topOneIsAnyValidLabel': float(np.mean(y[np.arange(len(y)), p.argmax(axis=1)])),
                   'tp': tp, 'fp': fp, 'fn': fn})
    return result


def old_class(case):
    word = case['word']
    pos, head, domain = word['partOfSpeech'].lower(), word['word'].lower(), case['domain']
    if domain == 'actions' or pos == 'verb':
        return 'action'
    if domain in ['attributes', 'weather'] or pos in ['adjective', 'adverb', 'preposition'] or head in ['open', 'closed', 'beside', 'white', 'blue']:
        return 'attribute'
    if domain in ['scenes', 'structures', 'nature', 'street']:
        return 'place'
    return 'thing'


def main():
    selection = read(OUTPUT / 'selection.json')
    finalists = selection['finalists']
    best_f1 = max(c['validationSelectedThreshold']['macroF1'] for c in finalists)
    eligible = [c for c in finalists if c['validationSelectedThreshold']['macroF1'] >= best_f1 - .01]
    soft_candidate = sorted(eligible, key=lambda c: (c['validationDefault']['bce'],
                            c['validationDefault']['brier'], -c['validationDefault']['macroAveragePrecision'],
                            c['config']['hidden'], c['config']['trial']))[0]
    # This policy responds to the soft-routing use case, not observed test gains.
    # The existing test has been inspected for other models, so this comparison
    # is explicitly post hoc and cannot establish a new untouched-test result.
    decision = {'postHoc': True, 'hyperparametersRetuned': False,
                'existingTestPreviouslyInspectedForOtherModels': True,
                'policy': 'Compare all metrics. For soft routing, among frozen finalists within 0.01 validation macro-F1 of the best, prefer validation BCE, then Brier, AP and simplicity. Preserve the original F1 winner.',
                'selectedFrozenCandidate': soft_candidate['config'],
                'selectedThresholdUnchanged': soft_candidate['validationSelectedThreshold']['threshold'],
                'testPerformanceUsedToSelectThisCandidate': False,
                'validationCandidates': [{'config': c['config'], 'metrics': c['validationSelectedThreshold']} for c in finalists]}
    trainer.write_json(OUTPUT / 'comparison-decision.json', decision)
    dataset = read(FIXTURE / 'dataset.json')
    encoded = json.loads(gzip.decompress((FIXTURE / 'embeddings.json.gz').read_bytes()))
    vectors = {r['id']: r['vector'] for r in encoded['rows']}
    train_rows = [r for r in dataset['items'] if r['split'] == 'train']
    x = np.asarray([vectors[r['id']] for r in train_rows])
    y = np.asarray([r['targets'] for r in train_rows])
    soft_fit = trainer.fit(x, y, soft_candidate['config'])
    chosen_artifact = read(FIXTURE / 'classifier.json')
    soft_artifact = {**chosen_artifact,
                     'hyperparameters': soft_candidate['config'],
                     'decisionThreshold': soft_candidate['validationSelectedThreshold']['threshold'],
                     'modelType': 'mlp' if soft_candidate['config']['hidden'] else 'logistic-regression',
                     'preprocessor': {'mean': soft_fit['mean'].tolist(), 'scale': soft_fit['scale'].tolist()},
                     'layers': [{'weights': w.tolist(), 'bias': b.tolist(),
                                 'activation': 'tanh' if i < len(soft_fit['layers']) - 1 else 'linear'}
                                for i, (w, b) in enumerate(soft_fit['layers'])],
                     'provenance': {**chosen_artifact['provenance'], 'postHocDiagnostic': True,
                                    'comparisonDecisionSha256': trainer.digest((OUTPUT / 'comparison-decision.json').read_bytes())}}
    trainer.write_json(FIXTURE / 'classifier-soft-candidate.json', soft_artifact)
    artifacts = {'tunedLinear': read(FIXTURE / 'classifier-linear.json'),
                 'f1Selected32': chosen_artifact, 'softCandidate8': soft_artifact}
    results, probabilities = {}, {}
    for name, artifact in artifacts.items():
        model = loaded_model(artifact)
        results[name] = {'hidden': artifact['hyperparameters']['hidden'],
                         'parameterCount': sum(w.size + b.size for w, b in model['layers']),
                         'decisionThreshold': artifact['decisionThreshold']}
        for split in ['validation', 'test']:
            rows = [r for r in dataset['items'] if r['split'] == split]
            labels = np.asarray([r['targets'] for r in rows])
            p = trainer.predict(model, np.asarray([vectors[r['id']] for r in rows]))
            results[name][split] = expanded_metrics(labels, p, artifact['decisionThreshold'])
            if split == 'test':
                probabilities[name] = [{'id': r['id'], 'probabilities': v.tolist()} for r, v in zip(rows, p)]
    cases = read(ROOT / 'tests/fixtures/image-pretraining-v2/cases.json')
    legacy = {}
    key = lambda r: (r['word'].lower(), r['partOfSpeech'].lower(), r['definition'])
    for case in cases['cases']:
        legacy.setdefault(key(case['word']), case)
    transitions, counts = [], {'legacyMeaningCount': 0, 'primaryChanged': 0, 'labelSetChanged': 0, 'multilabelLegacyMeanings': 0}
    for row in dataset['items']:
        if row['sourceKind'] != 'legacy':
            continue
        original = old_class(legacy[key(row)])
        mapped = {'thing': 'entity', 'attribute': 'state'}.get(original, original)
        counts['legacyMeaningCount'] += 1
        counts['primaryChanged'] += int(mapped != row['primaryClass'])
        counts['labelSetChanged'] += int([mapped] != row['labels'])
        counts['multilabelLegacyMeanings'] += int(len(row['labels']) > 1)
        if [mapped] != row['labels']:
            transitions.append({'id': row['id'], 'word': row['word'], 'definition': row['definition'],
                                'originalDomain': legacy[key(row)]['domain'], 'oldClass': original,
                                'newPrimaryClass': row['primaryClass'], 'newLabels': row['labels']})
    previous = read(OUTPUT / 'previous-run-reference.json')['meaningClassification']['fourClass_ActionPlaceThingAttribute']['logisticRegressionVecOnly']
    result = {'schemaVersion': 1, 'postHoc': True, 'newHyperparameterSearch': False,
              'models': results, 'testProbabilities': probabilities,
              'historicalLogisticRegression': previous,
              'labelReviewChanges': {**counts, 'transitions': transitions},
              'historicalTask': {'categories': ['action', 'place', 'thing', 'attribute'],
                                 'meaningCount': 237, 'trainingMeanings': 141, 'combinedValidationTestMeanings': 96,
                                 'exclusiveLabel': True, 'labelsFromDomainAndPOSRules': True,
                                 'crossValidation': 'Five-fold row-index modulo; not connected-family grouped.'},
              'currentTask': {'categories': dataset['categories'], 'meaningCount': len(dataset['items']),
                              'trainingMeanings': 244, 'validationMeanings': 91, 'testMeanings': 77,
                              'quarantinedMeanings': 5, 'multilabelMeanings': sum(len(r['labels']) > 1 for r in dataset['items']),
                              'exclusiveLabel': False, 'crossValidation': 'Training-only connected-family grouped folds.'},
              'causalityLimit': 'The historical/current scores change labels, output task, data, splits, optimizer and hyperparameters together. This comparison does not estimate each change\'s causal contribution.',
              'softCandidateCaveat': 'Trial 122 was chosen from frozen validation results under the disclosed post-hoc probability-quality policy. Its test metrics are diagnostic on an already-used test; no independent confirmatory gain is claimed.'}
    trainer.write_json(OUTPUT / 'comparison.json', result)
    print(json.dumps({'models': {name: {split: {k: v[split][k] for k in ['macroF1', 'macroPrecision', 'macroRecall', 'exactMatch', 'bce', 'brier', 'macroAveragePrecision']} for split in ['validation', 'test']} for name, v in results.items()}, 'labelChanges': counts}, indent=2))


if __name__ == '__main__':
    main()

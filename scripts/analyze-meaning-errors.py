#!/usr/bin/env python3
"""Frozen, deterministic error analysis for the original meaning classifier artifacts.

This is a diagnostic replay only: it does not fit models or select a model using
the already inspected validation/test sets.
"""
import gzip
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy'
OUT = ROOT / 'docs/meaning-taxonomy-training/diagnostics'
sys.path.insert(0, str(ROOT / 'work/meaning-taxonomy-training/python-libs'))

spec = importlib.util.spec_from_file_location('meaning_trainer', ROOT / 'scripts/train-meaning-taxonomy.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)
np = trainer.np


def read(path):
    return json.loads(path.read_text())


def model_from_artifact(artifact):
    return {
        'mean': np.asarray(artifact['preprocessor']['mean'], dtype=float),
        'scale': np.asarray(artifact['preprocessor']['scale'], dtype=float),
        'layers': [(np.asarray(layer['weights'], dtype=float), np.asarray(layer['bias'], dtype=float))
                   for layer in artifact['layers']],
    }


def expanded_metrics(y, p, threshold):
    base = trainer.metrics(y, p, threshold)
    per = list(base['perClass'].values())
    tp = sum(item['tp'] for item in per)
    fp = sum(item['fp'] for item in per)
    fn = sum(item['fn'] for item in per)
    base.update({
        'macroPrecision': float(np.mean([item['precision'] for item in per])),
        'macroRecall': float(np.mean([item['recall'] for item in per])),
        'microPrecision': float(tp / max(1, tp + fp)),
        'microRecall': float(tp / max(1, tp + fn)),
        'bitwiseAccuracy': float(1 - (fp + fn) / y.size),
        'tp': int(tp), 'fp': int(fp), 'fn': int(fn),
    })
    return base


def labels_for(row, categories):
    return [category for category, value in zip(categories, row) if value]


def main():
    dataset_bytes = (FIXTURE / 'dataset.json').read_bytes()
    embedding_bytes = (FIXTURE / 'embeddings.json.gz').read_bytes()
    dataset = json.loads(dataset_bytes)
    encoded = json.loads(gzip.decompress(embedding_bytes))
    assert encoded['datasetFileSha256'] == trainer.digest(dataset_bytes)
    vectors = {row['id']: row['vector'] for row in encoded['rows']}
    categories = dataset['categories']
    splits = {
        'validation': [row for row in dataset['items'] if row['split'] == 'validation'],
        'test': [row for row in dataset['items'] if row['split'] == 'test'],
    }
    assert len(splits['validation']) == 91 and len(splits['test']) == 77
    assert all(row['id'] in vectors for rows in splits.values() for row in rows)

    model_files = {'logisticRegression': 'classifier-linear.json', 'mlp': 'classifier.json'}
    result = {
        'schemaVersion': 1,
        'datasetFileSha256': trainer.digest(dataset_bytes),
        'embeddingsFileSha256': trainer.digest(embedding_bytes),
        'diagnosticOnly': True,
        'retrained': False,
        'modelSelectionPerformed': False,
        'validationPolicy': 'Original validation split (91); frozen artifact threshold; diagnostic replay only.',
        'testPolicy': 'Original test split (77); frozen artifact threshold; reused diagnostically and not for model selection.',
        'labelTruth': 'Annotation accuracy is unknown. Targets are AI-pilot labels, not independent expert-human ground truth.',
        'categories': categories,
        'splitCounts': {name: len(rows) for name, rows in splits.items()},
        'models': {},
    }

    for model_name, filename in model_files.items():
        artifact_bytes = (FIXTURE / filename).read_bytes()
        artifact = json.loads(artifact_bytes)
        assert artifact['provenance']['datasetFileSha256'] == trainer.digest(dataset_bytes)
        assert artifact['provenance']['embeddingsFileSha256'] == trainer.digest(embedding_bytes)
        model = model_from_artifact(artifact)
        threshold = float(artifact['decisionThreshold'])
        model_result = {'artifact': filename, 'artifactFileSha256': trainer.digest(artifact_bytes), 'modelType': artifact['modelType'], 'threshold': threshold, 'splits': {}}
        for split_name, rows in splits.items():
            y = np.asarray([row['targets'] for row in rows], dtype=int)
            x = np.asarray([vectors[row['id']] for row in rows], dtype=float)
            probabilities = trainer.predict(model, x)
            prediction = probabilities >= threshold
            metrics = expanded_metrics(y, probabilities, threshold)
            errors = []
            high_confidence = []
            per_class = metrics['perClass']
            for row, gold, pred, probs in zip(rows, y, prediction, probabilities):
                gold_labels = labels_for(row['targets'], categories)
                predicted_labels = labels_for(pred, categories)
                errors.append({
                    'id': row['id'], 'word': row['word'], 'partOfSpeech': row.get('partOfSpeech'),
                    'definition': row['definition'], 'goldLabels': gold_labels,
                    'predictedLabels': predicted_labels,
                    'probabilities': {category: float(prob) for category, prob in zip(categories, probs)},
                    'wrongMemberships': [
                        {'category': category, 'gold': int(gold[k]), 'predicted': int(pred[k]),
                         'probability': float(probs[k]), 'kind': 'falsePositive' if pred[k] else 'falseNegative'}
                        for k, category in enumerate(categories) if bool(gold[k]) != bool(pred[k])
                    ],
                })
                for k, category in enumerate(categories):
                    if bool(gold[k]) != bool(pred[k]) and (probs[k] >= .8 or probs[k] <= .2):
                        high_confidence.append({
                            'id': row['id'], 'word': row['word'], 'partOfSpeech': row.get('partOfSpeech'),
                            'definition': row['definition'], 'category': category,
                            'gold': int(gold[k]), 'predicted': int(pred[k]),
                            'probability': float(probs[k]),
                            'confidenceRule': 'wrong membership with p >= 0.8 or p <= 0.2',
                        })
            # Per-class membership-level false positive and false negative cases.
            for k, category in enumerate(categories):
                class_errors = {'falsePositives': [], 'falseNegatives': []}
                for row, gold, pred, probs in zip(rows, y, prediction, probabilities):
                    if pred[k] and not gold[k]:
                        class_errors['falsePositives'].append({'id': row['id'], 'word': row['word'], 'definition': row['definition'], 'probability': float(probs[k])})
                    elif gold[k] and not pred[k]:
                        class_errors['falseNegatives'].append({'id': row['id'], 'word': row['word'], 'definition': row['definition'], 'probability': float(probs[k])})
                per_class[category]['errors'] = class_errors
            model_result['splits'][split_name] = {
                'metrics': metrics, 'meanings': errors, 'highConfidenceWrongMemberships': high_confidence,
            }
        result['models'][model_name] = model_result

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'errors.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    write_markdown(result, OUT.parent / 'ERROR_ANALYSIS.md')
    for model_name, model in result['models'].items():
        test = model['splits']['test']['metrics']
        print(f"{model_name}: test exact={test['exactMatch']:.4f}, micro-F1={test['microF1']:.4f}, macro-F1={test['macroF1']:.4f}")


def pct(value):
    return f'{value * 100:.2f}%'


def write_markdown(result, path):
    lines = [
        '# Frozen meaning classifier error analysis', '',
        'This is a deterministic replay of the original 91-meaning validation and 77-meaning test splits using the frozen artifacts and each artifact’s own threshold. No weights, splits, or labels were changed; no model selection or retraining was performed. The test split has already been inspected in earlier diagnostics, so this report reuses it diagnostically and does not use it for model selection.', '',
        'Targets are AI-pilot annotations. **Annotation accuracy is unknown**; these results measure agreement with the current labels, not verified semantic truth. For follow-up, collect new independent examples and review them independently; do not copy held-out examples into training.', '',
        '## Test metrics', '',
        '| Frozen model | Threshold | Micro P | Micro R | Micro F1 | Macro P | Macro R | Macro F1 | Exact label set | Bitwise accuracy |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ]
    for model_name, model in result['models'].items():
        m = model['splits']['test']['metrics']
        label = 'Logistic regression' if model_name == 'logisticRegression' else 'MLP'
        lines.append(f"| {label} | {model['threshold']:.3f} | {pct(m['microPrecision'])} | {pct(m['microRecall'])} | {pct(m['microF1'])} | {pct(m['macroPrecision'])} | {pct(m['macroRecall'])} | {pct(m['macroF1'])} | {pct(m['exactMatch'])} | {pct(m['bitwiseAccuracy'])} |")
    lines += ['', 'The logistic model’s test exact label-set match is **74.03%** and macro-F1 is **83.74%**, reflecting agreement with the pilot labels only.', '', '## Per-class test errors', '']
    for model_name, model in result['models'].items():
        label = 'Logistic regression' if model_name == 'logisticRegression' else 'MLP'
        lines += [f'### {label}', '', '| Category | Support | TP | FP | FN | Precision | Recall | F1 |', '|---|---:|---:|---:|---:|---:|---:|---:|']
        metrics = model['splits']['test']['metrics']
        for category, m in metrics['perClass'].items():
            lines.append(f"| {category} | {m['positiveSupport']} | {m['tp']} | {m['fp']} | {m['fn']} | {pct(m['precision'])} | {pct(m['recall'])} | {pct(m['f1'])} |")
        weakest = sorted(metrics['perClass'].items(), key=lambda pair: (pair[1]['f1'], pair[0]))[:2]
        lines += ['', 'Largest weaknesses by F1: ' + ', '.join(f"**{c}** ({pct(m['f1'])}, {m['fp']} FP / {m['fn']} FN)" for c, m in weakest) + '.', '']
    lines += ['Full per-meaning predictions, probabilities, FP/FN memberships, and high-confidence errors are in [`diagnostics/errors.json`](diagnostics/errors.json). A high-confidence wrong membership is defined as an incorrect binary decision with probability at least 0.8 or at most 0.2.', '']
    path.write_text('\n'.join(lines))


if __name__ == '__main__':
    main()

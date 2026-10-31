#!/usr/bin/env python3
"""Fixed-config diagnostic for the reviewed training supplement; validation only."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy'
SUPPLEMENT = FIXTURE / 'supplement'
OUTPUT = ROOT / 'docs/meaning-taxonomy-training/diagnostics/supplement'
spec = importlib.util.spec_from_file_location('meaning_trainer', ROOT / 'scripts/train-meaning-taxonomy.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)  # also adds the bundled NumPy/SciPy path
np = trainer.np
CATEGORIES = trainer.CATEGORIES


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def expanded_metrics(y, p, threshold):
    result = trainer.metrics(y, p, threshold)
    classes = list(result['perClass'].values())
    tp, fp, fn = (sum(m[k] for m in classes) for k in ('tp', 'fp', 'fn'))
    result.update({
        'macroPrecision': float(np.mean([m['precision'] for m in classes])),
        'macroRecall': float(np.mean([m['recall'] for m in classes])),
        'microPrecision': tp / max(1, tp + fp),
        'microRecall': tp / max(1, tp + fn),
        'hammingAccuracy': 1 - (fp + fn) / y.size,
        'topOneIsAnyValidLabel': float(np.mean(y[np.arange(len(y)), p.argmax(axis=1)])),
        'tp': int(tp), 'fp': int(fp), 'fn': int(fn),
    })
    return result


def loaded_model(artifact):
    return {'mean': np.asarray(artifact['preprocessor']['mean']),
            'scale': np.asarray(artifact['preprocessor']['scale']),
            'layers': [(np.asarray(layer['weights']), np.asarray(layer['bias'])) for layer in artifact['layers']]}


def artifact_from_fit(template, model, config, threshold, provenance):
    return {
        **template,
        'modelType': 'mlp' if config['hidden'] else 'logistic-regression',
        'preprocessor': {'mean': model['mean'].tolist(), 'scale': model['scale'].tolist()},
        'layers': [{'weights': weights.tolist(), 'bias': bias.tolist(),
                    'activation': 'tanh' if i < len(model['layers']) - 1 else 'linear'}
                   for i, (weights, bias) in enumerate(model['layers'])],
        'hyperparameters': config,
        'decisionThreshold': threshold,
        'calibrated': False,
        'provenance': provenance,
    }


def main():
    base_bytes = (FIXTURE / 'dataset.json').read_bytes()
    supplement_bytes = (SUPPLEMENT / 'dataset.json').read_bytes()
    base_embedding_bytes = (FIXTURE / 'embeddings.json.gz').read_bytes()
    supplement_embedding_bytes = (SUPPLEMENT / 'embeddings.json.gz').read_bytes()
    base = json.loads(base_bytes)
    supplement = json.loads(supplement_bytes)
    base_embeddings = json.loads(gzip.decompress(base_embedding_bytes))
    supplement_embeddings = json.loads(gzip.decompress(supplement_embedding_bytes))

    # Hash/encoder/prompt checks bind vectors to the exact reviewed text rows.
    assert base_embeddings['datasetFileSha256'] == sha(base_bytes)
    assert supplement_embeddings['datasetFileSha256'] == sha(supplement_bytes)
    assert base_embeddings['dimension'] == supplement_embeddings['dimension'] == 512
    assert base_embeddings['encoder'] == supplement_embeddings['encoder']
    assert base_embeddings['inputProtocol'] == supplement_embeddings['inputProtocol']
    assert supplement['sourceDatasetSha256'] == sha(base_bytes)
    vectors = {}
    for encoded in (base_embeddings, supplement_embeddings):
        for row in encoded['rows']:
            assert row['id'] not in vectors
            assert len(row['vector']) == 512
            assert np.isfinite(row['vector']).all()
            vectors[row['id']] = row['vector']
    base_by_id = {row['id']: row for row in base_embeddings['rows']}
    supplement_by_id = {row['id']: row for row in supplement_embeddings['rows']}
    for row in base['items']:
        encoded = base_by_id[row['id']]
        prompt = f"A photo illustrating {row['word']} ({row['partOfSpeech'] or 'word'}): {row['definition']}"
        assert encoded['promptSha256'] == sha(prompt.encode())
    for row in supplement['items']:
        encoded = supplement_by_id[row['id']]
        prompt = f"A photo illustrating {row['word']} ({row['partOfSpeech'] or 'word'}): {row['definition']}"
        assert encoded['promptSha256'] == sha(prompt.encode())

    old_train = [row for row in base['items'] if row['split'] == 'train']
    validation = [row for row in base['items'] if row['split'] == 'validation']
    add_train = list(supplement['items'])
    assert (len(old_train), len(add_train), len(old_train) + len(add_train), len(validation)) == (244, 57, 301, 91)
    assert all(row['split'] == 'train' for row in add_train)
    assert not ({r['id'] for r in old_train} | {r['id'] for r in add_train}) & {r['id'] for r in validation}
    ids_old = [row['id'] for row in old_train]
    ids_add = [row['id'] for row in add_train]
    validation_ids = [row['id'] for row in validation]
    y_validation = np.asarray([row['targets'] for row in validation], dtype=float)
    x_validation = np.asarray([vectors[row_id] for row_id in validation_ids], dtype=float)
    x_old = np.asarray([vectors[row_id] for row_id in ids_old], dtype=float)
    y_old = np.asarray([row['targets'] for row in old_train], dtype=float)
    x_expanded = np.concatenate([x_old, np.asarray([vectors[row_id] for row_id in ids_add], dtype=float)])
    y_expanded = np.concatenate([y_old, np.asarray([row['targets'] for row in add_train], dtype=float)])

    model_specs = [
        ('linear', FIXTURE / 'classifier-linear.json'),
        ('32', FIXTURE / 'classifier.json'),
    ]
    frozen = []
    for name, path in model_specs:
        artifact = read_json(path)
        assert artifact['decisionThreshold'] == ({'linear': .325, '32': .45}[name])
        config = dict(artifact['hyperparameters'])
        assert config['hidden'] == (0 if name == 'linear' else 32)
        frozen.append({'name': name, 'sourceArtifact': str(path.relative_to(ROOT)),
                       'config': config, 'threshold': artifact['decisionThreshold']})

    protocol = {
        'schemaVersion': 1,
        'purpose': 'Fixed-config training-set expansion diagnostic; no hyperparameter or threshold selection.',
        'sourceDatasetSha256': sha(base_bytes),
        'supplementDatasetSha256': sha(supplement_bytes),
        'sourceEmbeddingsSha256': sha(base_embedding_bytes),
        'supplementEmbeddingsSha256': sha(supplement_embedding_bytes),
        'encoder': base_embeddings['encoder'],
        'inputProtocol': base_embeddings['inputProtocol'],
        'counts': {'originalTraining': len(old_train), 'supplementTraining': len(add_train),
                   'expandedTraining': len(old_train) + len(add_train), 'reusedValidation': len(validation)},
        'trainingIds': {'original': ids_old, 'supplement': ids_add,
                        'expanded': ids_old + ids_add},
        'validationIds': validation_ids,
        'models': frozen,
        'fitSeed': 7919,
        'fitSeedRationale': 'Matches trainer.fit default used for the original final artifact fits.',
        'comparison': 'For each fixed original tuned model config, refit on original 244 and expanded 301 training examples; evaluate both only on original 91 validation meanings at each source artifact threshold.',
        'thresholdsUnchanged': True,
        'hyperparametersRetuned': False,
        'testTargetsOrPredictionsUsed': False,
        'interpretation': 'Validation is reused development data, not an independent test; results are diagnostic and do not guarantee any target score.',
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    trainer.write_json(OUTPUT / 'protocol.json', protocol)  # Freeze protocol before fitting.
    protocol_hash = sha((OUTPUT / 'protocol.json').read_bytes())

    comparison = {}
    validation_predictions = {
        'schemaVersion': 1, 'validationSplit': 'original-validation-reused-development',
        'validationCount': len(validation), 'categories': CATEGORIES,
        'items': [{'id': row['id'], 'word': row['word'], 'targets': row['targets']} for row in validation],
        'models': {},
    }
    for spec_row in frozen:
        config, threshold, name = spec_row['config'], spec_row['threshold'], spec_row['name']
        comparison[name] = {'config': config, 'decisionThreshold': threshold, 'old244': {}, 'expanded301': {}}
        validation_predictions['models'][name] = {}
        for train_name, x_train, y_train in [('old244', x_old, y_old), ('expanded301', x_expanded, y_expanded)]:
            model = trainer.fit(x_train, y_train, config, seed=7919)
            probabilities = trainer.predict(model, x_validation)
            if train_name == 'old244':
                source_artifact = read_json(FIXTURE / ('classifier-linear.json' if name == 'linear' else 'classifier.json'))
                frozen_probabilities = trainer.predict(loaded_model(source_artifact), x_validation)
                assert np.max(np.abs(probabilities - frozen_probabilities)) <= 1e-10, (
                    f'Original refit mismatch for {name}: {np.max(np.abs(probabilities - frozen_probabilities))}')
            result_metrics = expanded_metrics(y_validation, probabilities, threshold)
            comparison[name][train_name] = {'metrics': result_metrics, 'optimizer': model['optimizer']}
            validation_predictions['models'][name][train_name] = probabilities.tolist()
            if train_name == 'expanded301':
                source_path = FIXTURE / ('classifier-linear.json' if name == 'linear' else 'classifier.json')
                template = read_json(source_path)
                provenance = {
                    'sourceDatasetFileSha256': sha(base_bytes),
                    'supplementDatasetFileSha256': sha(supplement_bytes),
                    'sourceEmbeddingsFileSha256': sha(base_embedding_bytes),
                    'supplementEmbeddingsFileSha256': sha(supplement_embedding_bytes),
                    'protocolFileSha256': protocol_hash,
                    'trainedOn': 'original train 244 + reviewed supplement train 57 = 301; no validation or test rows',
                    'trainIds': ids_old + ids_add,
                    'validationEvaluated': True,
                    'validationIds': validation_ids,
                    'validationUsedForHyperparameterOrThresholdSelection': False,
                    'testTargetsOrPredictionsUsed': False,
                }
                candidate = artifact_from_fit(template, model, config, threshold, provenance)
                out_name = 'classifier-linear.json' if name == 'linear' else 'classifier-32.json'
                trainer.write_json(SUPPLEMENT / out_name, candidate)
    report = {
        'schemaVersion': 1,
        'protocolFileSha256': protocol_hash,
        'purpose': 'Descriptive fixed-config comparison on reused validation only.',
        'models': comparison,
        'limitations': [
            'The original 91-row validation set has already guided development and is reused here.',
            'No independent test performance is reported; no test targets or predictions were used.',
            'AI-reviewed annotations are not human-expert ground truth.',
            'No hyperparameter, threshold, or calibration selection occurred in this diagnostic.',
            'Any metric changes are descriptive and do not establish causality or guarantee a target score.',
        ],
    }
    trainer.write_json(OUTPUT / 'report.json', report)
    trainer.write_json(OUTPUT / 'validation-predictions.json', validation_predictions)
    print(json.dumps({name: {split: {metric: val['metrics'][metric] for metric in ('macroF1','microF1','exactMatch','bce','brier','macroAveragePrecision')}
                            for split, val in model.items() if split in ('old244','expanded301')}
                      for name, model in comparison.items()}, indent=2))


if __name__ == '__main__':
    main()

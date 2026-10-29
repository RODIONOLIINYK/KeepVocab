"""Independently recompute JS experiment metrics in NumPy, including Brier identity.

Usage: python3 scripts/verify-image-training.py encoded.json[.gz] candidate.json.gz
       manifest.json results-directory output.json
"""
import base64
import gzip
import hashlib
import json
import sys
from pathlib import Path
import numpy as np


def read(path):
    path = Path(path)
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())


def vector(value):
    if not value.startswith('f32:'):
        raise ValueError('This check expects actual current full-precision feature records')
    return np.frombuffer(base64.b64decode(value[4:]), dtype='<f4')


def main():
    encoded_path, candidate_path, manifest_path, directory, output = sys.argv[1:]
    encoded, saved, manifest = read(encoded_path), read(candidate_path), read(manifest_path)
    candidate = saved['model']
    directory = Path(directory)
    report = read(directory / 'training-report.json')
    weights = np.asarray(candidate['weights'], dtype='<f4')
    last_checkpoint = saved.get('checkpoint') == 'last'
    assert hashlib.sha256(weights.tobytes()).hexdigest() == report['lastCandidateWeightsSha256' if last_checkpoint else 'candidateWeightsSha256']
    assert encoded['encoder'] == candidate['encoder'] == report['encoder']
    events = {}
    for row in encoded['events']:
        events.setdefault(row['decisionId'], []).append(row)
    names = ['clip', 'mlp', 'fusion'] if candidate['version'] == 'meaning-mlp-32-16-fusion-v2' else ['baseline', 'mlp']
    results = {split: {name: [] for name in names} for split in ['train', 'validation', 'test']}
    for case in manifest['cases']:
        pairs = events[case['id']]
        features = {row['context']['imageUrl']: vector(row['features']) for row in pairs}
        features[pairs[0]['context']['preferredUrl']] = vector(pairs[0]['preferredFeatures'])
        image = np.asarray([features[photo['url']] for photo in case['candidates']], dtype=np.float32)
        meaning = vector(pairs[0]['meaningFeatures'])[:512]
        inputs = np.concatenate([image[:, :512], np.broadcast_to(meaning, (len(image), 512)), image[:, :512] * meaning, image[:, 512:]], axis=1)
        a, offset = inputs, 0
        for layer, (nin, nout) in enumerate([(1539, 32), (32, 16), (16, 1)]):
            w = weights[offset:offset + nin * nout].reshape(nout, nin)
            b = weights[offset + nin * nout:offset + nin * nout + nout]
            a = a @ w.T + b
            if layer < 2:
                a = np.maximum(a, 0)
            offset += nin * nout + nout
        base = image[:, 512].astype(float) + .6 * image[:, 513].astype(float) - .25 * np.maximum(0, image[:, 514].astype(float))
        if candidate['version'] == 'meaning-mlp-32-16-fusion-v2':
            scores_by_model = [('clip', base), ('mlp', a[:, 0].astype(float)), ('fusion', .5 * base + .5 * a[:, 0].astype(float))]
        else:
            residual = .08 * np.tanh(a[:, 0].astype(float))
            residual = np.where(image[:, 513] < 0, np.minimum(residual, 0), residual)
            scores_by_model = [('baseline', base), ('mlp', base + residual)]
        preferred = next(i for i, photo in enumerate(case['candidates']) if photo['id'] == case['feedback']['selected'][0])
        for name, scores in scores_by_model:
            other = [i for i in range(len(image)) if i != preferred]
            difference = scores[preferred] - scores[other]
            probability = 1 / (1 + np.exp(-8 * difference))
            results[case['split']][name].append({'chosenAt1': int(np.argmax(scores) == preferred),
                'loss': float(np.mean(-np.log(np.maximum(1e-8, probability)))),
                'brier': float(np.mean((1-probability)**2)), 'pairwiseAccuracy': float(np.mean(difference > 0))})
    verified = {}
    for split, models in results.items():
        verified[split] = {}
        for name, rows in models.items():
            computed = {key: float(np.mean([row[key] for row in rows])) for key in ['loss', 'brier', 'pairwiseAccuracy']}
            computed['chosenAt1'] = sum(row['chosenAt1'] for row in rows)
            expected = (report['lastMetrics'] if last_checkpoint else report.get('finalMetrics', report.get('metrics')))[split][name]
            assert computed['chosenAt1'] == expected['chosenAt1'], (split, name, computed, expected)
            for key in ['loss', 'brier', 'pairwiseAccuracy']:
                assert abs(computed[key] - expected[key]) < 2e-6, (split, name, key, computed[key], expected[key])
            verified[split][name] = computed
    decomposition = read(directory / 'bias-variance.json')
    predictions = np.asarray(decomposition['predictionRuns'])
    mass = np.asarray(decomposition['predictionWeights'])
    bias = float(np.sum(mass * (1-predictions.mean(axis=0))**2))
    variance = float(np.sum(mass * predictions.var(axis=0, ddof=0)))
    error = float(np.sum(mass * ((1-predictions)**2).mean(axis=0)))
    assert abs(error-bias-variance) < 1e-12
    for key, value in [('squaredBiasToFixedLabels', bias), ('predictionVariance', variance), ('expectedBrierError', error)]:
        assert abs(value - decomposition[key]) < 1e-12
    last_decomposition = None
    if 'lastCheckpoint' in decomposition:
        last = decomposition['lastCheckpoint']
        p_last = np.asarray(last['predictionRuns'])
        last_decomposition = {
            'squaredBiasToFixedLabels': float(np.sum(mass * (1-p_last.mean(axis=0))**2)),
            'predictionVariance': float(np.sum(mass * p_last.var(axis=0, ddof=0))),
            'expectedBrierError': float(np.sum(mass * ((1-p_last)**2).mean(axis=0)))
        }
        for key, value in last_decomposition.items():
            assert abs(value - last[key]) < 1e-12
        assert abs(last_decomposition['expectedBrierError']-last_decomposition['squaredBiasToFixedLabels']-last_decomposition['predictionVariance']) < 1e-12
    result = {'passed': True, 'method': 'Independent NumPy forward pass, ranking/loss aggregation and empirical Brier decomposition',
              'numpyVersion': np.__version__, 'metrics': verified, 'biasVariance': {'squaredBiasToFixedLabels': bias,
                  'predictionVariance': variance, 'expectedBrierError': error, 'identityResidual': error-bias-variance}}
    if last_decomposition is not None:
        result['lastCheckpointBiasVariance'] = last_decomposition
    Path(output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()

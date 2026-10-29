"""Independent NumPy forward/ranking check; never trains or selects a model.

Usage: python3 scripts/verify-meaning-shift.py results-directory output.json
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
    assert value.startswith('f32:')
    return np.frombuffer(base64.b64decode(value[4:]), dtype='<f4')


def main():
    directory, output = Path(sys.argv[1]), Path(sys.argv[2])
    report = read(directory / 'report.json')
    plan = read(report['protocol']['split'])
    manifest, encoded = read(plan['sourceManifest']), read(plan['sourceFeatures'])
    events, cases = {}, {c['id']: c for c in manifest['cases']}
    for event in encoded['events']:
        events.setdefault(event['decisionId'], []).append(event)
    data = {}
    for cid, case in cases.items():
        pairs = events[cid]
        features = {row['context']['imageUrl']: vector(row['features']) for row in pairs}
        features[pairs[0]['context']['preferredUrl']] = vector(pairs[0]['preferredFeatures'])
        image = np.asarray([features[p['url']] for p in case['candidates']], dtype=np.float32)
        meaning = vector(pairs[0]['meaningFeatures'])[:512]
        inputs = np.concatenate([image[:, :512], np.broadcast_to(meaning, (len(image), 512)),
                                 image[:, :512] * meaning, image[:, 512:]], axis=1)
        base = image[:, 512].astype(float) + .6 * image[:, 513].astype(float) - .25 * np.maximum(0, image[:, 514].astype(float))
        preferred = next(i for i, p in enumerate(case['candidates']) if p['id'] == case['feedback']['selected'][0])
        data[cid] = inputs, base, preferred
    checked = []
    for run in report['runs']:
        saved = read(directory / f'{run["seed"]}-{run["arm"]}.json.gz')
        for checkpoint in ['selected', 'last']:
            model = saved[checkpoint]
            weights = np.asarray(model['weights'], dtype='<f4')
            assert hashlib.sha256(weights.tobytes()).hexdigest() == saved[f'{checkpoint}WeightsSha256']
            ids = {'train': plan['commonIds'] + plan[f'{run["arm"]}ExposureIds'],
                   'validation': plan['validationIds'], 'test': plan['testIds']}
            for split, case_ids in ids.items():
                rows = []
                for cid in case_ids:
                    inputs, base, preferred = data[cid]
                    state, offset = inputs, 0
                    for layer, (nin, nout) in enumerate([(1539, 32), (32, 16), (16, 1)]):
                        w = weights[offset:offset+nin*nout].reshape(nout, nin)
                        b = weights[offset+nin*nout:offset+nin*nout+nout]
                        # JS accumulates each dot product in double, then stores
                        # the layer output as Float32.
                        state = (state.astype(float) @ w.astype(float).T + b).astype(np.float32)
                        if layer < 2:
                            state = np.maximum(state, 0)
                        offset += nin*nout + nout
                    score = .5 * base + .5 * state[:, 0].astype(float)
                    other = [i for i in range(len(score)) if i != preferred]
                    difference = score[preferred] - score[other]
                    p = 1 / (1 + np.exp(-8 * difference))
                    rows.append({'id': cid, 'chosenAt1': int(np.argmax(score) == preferred),
                                 'loss': float(np.mean(-np.log(np.maximum(1e-8, p)))),
                                 'brier': float(np.mean((1-p)**2)), 'pairwiseAccuracy': float(np.mean(difference > 0))})
                actual = {key: float(np.mean([row[key] for row in rows])) for key in ['loss', 'brier', 'pairwiseAccuracy']}
                actual['chosenAt1'] = sum(row['chosenAt1'] for row in rows)
                expected = run['metrics'][split][checkpoint]
                assert actual['chosenAt1'] == expected['chosenAt1'], (run['seed'], run['arm'], checkpoint, split)
                assert [r['chosenAt1'] for r in rows] == [r['chosenAt1'] for r in expected['rows']]
                for key in ['loss', 'brier', 'pairwiseAccuracy']:
                    assert abs(actual[key]-expected[key]) < 2e-6, (key, actual[key], expected[key])
                checked.append({'seed': run['seed'], 'arm': run['arm'], 'checkpoint': checkpoint, 'split': split, **actual})
    output.write_text(json.dumps({'passed': True, 'checks': checked, 'rankChecks': len(checked),
                                 'tolerance': 2e-6, 'independentForward': 'NumPy double dot products with Float32 layer outputs'}, indent=2)+'\n')
    print(f'Independent check passed: {len(checked)} split/checkpoint evaluations.')


if __name__ == '__main__':
    main()

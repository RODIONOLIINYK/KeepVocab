"""Checks the research fitter before any pilot/test model selection."""
import argparse
from pathlib import Path
import numpy as np
from lib.image_regularization import read, write, load_data, assemble, Model, fit, metrics, digest


def packed_gradient(gradient):
    return np.concatenate([part.reshape(-1) for i in range(3) for part in [gradient[f'w{i}'], gradient[f'b{i}']]])


def finite_difference(model, batch, strength):
    model = model.clone(); model.dtype = np.float64
    model.p = {k: v.astype(float) for k, v in model.p.items()}
    loss, gradient, original = model.gradient(batch, strength)
    checks, skipped = [], 0
    for key in ['w0', 'w1', 'w2']+(['g0', 't0', 'g1', 't1'] if model.batch_norm else []):
        indices = np.argsort(-np.abs(gradient[key].reshape(-1)))
        tested = 0
        for index in indices[:min(100, len(indices))]:
            value = model.p[key].reshape(-1)[index]; h = 1e-5
            model.p[key].reshape(-1)[index] = value+h
            plus, _, pc = model.gradient(batch, strength)
            model.p[key].reshape(-1)[index] = value-h
            minus, _, mc = model.gradient(batch, strength)
            model.p[key].reshape(-1)[index] = value
            if any(not np.array_equal(p['pre'] > 0, m['pre'] > 0) for p, m in zip(pc[:2], mc[:2])):
                skipped += 1; continue
            numeric, analytic = (plus-minus)/(2*h), float(gradient[key].reshape(-1)[index])
            error = abs(numeric-analytic)
            if error > 2e-5:
                raise AssertionError((key, int(index), analytic, numeric, error))
            checks.append({'parameter': key, 'index': int(index), 'analytic': analytic, 'numeric': numeric, 'absoluteError': error})
            tested += 1
            if tested == 2:
                break
        if tested != 2:
            raise AssertionError('Insufficient smooth gradient checks '+key)
    return {'passed': True, 'loss': loss, 'checks': checks, 'epsilon': 1e-5, 'absoluteTolerance': 2e-5,
            'maximumAbsoluteError': max(r['absoluteError'] for r in checks), 'skippedBoundaries': skipped,
            'note': 'Float64 shadow checks differentiability; actual training uses Float32 parameters/activations.'}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', default='work/image-regularization/preflight.json')
    args = parser.parse_args()
    protocol = read('docs/image-regularization-protocol.json'); plan = read(protocol['dataSplit'])
    prepared = read('work/image-regularization/prepared.json.gz'); data, _ = load_data(plan)
    initial = prepared['initials'][str(protocol['pilotSeed'])]
    plain = Model(initial['weights']); first = assemble(data, prepared['parity']['ids'])
    loss, gradient, _ = plain.gradient(first)
    actual, expected = packed_gradient(gradient), np.asarray(prepared['parity']['gradient'])
    gradient_error = float(np.max(np.abs(actual-expected)))
    assert gradient_error < 1e-5, gradient_error
    assert abs(loss-prepared['parity']['loss']) < 2e-6
    parity = {'gradientMaximumAbsoluteError': gradient_error, 'gradientTolerance': 1e-5,
              'lossAbsoluteError': abs(loss-prepared['parity']['loss'])}
    for name, ids in [('oneBatch', prepared['parity']['ids']), ('oneEpoch', prepared['parity']['trainIds'])]:
        run = fit(plain, data, ids, ids, protocol['recipe'], 0, epochs=1)
        error = float(np.max(np.abs(run['model'].packed()-np.asarray(prepared['parity'][name]['weights']))))
        comparison = assemble(data, prepared['parity']['trainIds'])
        original_model = Model(prepared['parity'][name]['weights'])
        original_scores, _ = original_model.forward(comparison['x'])
        research_scores, _ = run['model'].forward(comparison['x'])
        score_error = float(np.max(np.abs(original_scores-research_scores)))
        assert score_error < .001, (name, score_error)
        weight_tolerance = 2e-5 if name == 'oneBatch' else 2e-4
        assert error < weight_tolerance, (name, error)
        parity[name] = {'maximumWeightError': error, 'weightTolerance': weight_tolerance, 'maximumRawScoreError': score_error, 'scoreTolerance': .001,
                        'productionTrainingCorrect': metrics(original_model, comparison)['chosenAt1'],
                        'researchTrainingCorrect': metrics(run['model'], comparison)['chosenAt1']}
    parity['roundingNote'] = ('An initial fully vectorized reduction failed strict weight parity despite gradient difference1.49e-8. '
                             'It was rejected. The corrected control kernel preserves production pairwise Float32 accumulation order; '
                             'the original strict weight tolerances remain. No optimizer settings were changed.')
    checks = {}
    for bn in [False, True]:
        model = Model(initial['weights'], batch_norm=bn)
        if bn:
            model.calibrate_identity(assemble(data, prepared['parity']['trainIds'])['x'])
            original, _ = plain.forward(first['x']); calibrated, _ = model.forward(first['x'])
            identity_error = float(np.max(np.abs(original-calibrated)))
            assert identity_error < 2e-6, identity_error
            parity['batchNormInitialMaximumScoreError'] = identity_error
        for strength in [0, .001]:
            checks[f'bn={bn},l2={strength}'] = finite_difference(model, first, strength)
        before = {k: v.copy() for k, v in model.running.items()}
        metrics(model, first)
        assert all(np.array_equal(before[k], v) for k, v in model.running.items())
    result = {'passed': True, 'baselineProductionParity': parity, 'gradients': checks,
              'evaluationDoesNotUpdateBatchNorm': True, 'independentFromTestLabels': True,
              'kernelSha256': digest('scripts/lib/image_regularization.py'),
              'protocolSha256': digest('docs/image-regularization-protocol.json')}
    write(args.output, result)
    print({'passed': True, 'productionParity': parity, 'gradientChecks': sum(len(r['checks']) for r in checks.values())})


if __name__ == '__main__':
    main()

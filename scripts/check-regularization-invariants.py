"""Extra mathematical checks; no training/selection/test labels required."""
import numpy as np
from lib.image_regularization import read, write, load_data, assemble, Model, digest

protocol = read('docs/image-regularization-protocol.json')
prepared = read('work/image-regularization/prepared.json.gz')
data, _ = load_data(read(protocol['dataSplit']))
batch = assemble(data, prepared['parity']['ids'])
checks = []
for bn in [False, True]:
    model = Model(prepared['initials']['78123']['weights'], bn)
    if bn:
        model.calibrate_identity(batch['x'])
    loss0, g0, _ = model.gradient(batch)
    loss1, g1, _ = model.gradient(batch, .001)
    error = max(float(np.max(np.abs((g1[k]-g0[k])-(.001*v if k.startswith('w') else 0)))) for k, v in model.p.items())
    assert error < 1e-7, error
    assert abs(loss1-loss0-model.regularization(.001)) < 1e-12
    before = {k: v.copy() for k, v in model.running.items()}
    together, _ = model.forward(batch['x'])
    separately = np.concatenate([model.forward(x[None, :])[0] for x in batch['x']])
    maximum = float(np.max(np.abs(together-separately)))
    assert maximum < 2e-6, maximum
    assert all(np.array_equal(before[k], v) for k, v in model.running.items())
    occurrences = sum(len(g['indices']) for g in batch['galleries'])
    checks.append({'batchNorm': bn, 'l2GradientMaximumError': error, 'l2Penalty': model.regularization(.001),
                   'evaluationBatchIndependenceMaximumError': maximum, 'evaluationRunningStatsUnchanged': True,
                   'uniquePhotoMeaningRows': len(batch['x']), 'galleryCandidateOccurrences': occurrences})
write('work/image-regularization/invariants.json', {'passed': True, 'checks': checks, 'kernelSha256': digest('scripts/lib/image_regularization.py')})
print({'passed': True, 'checks': checks})

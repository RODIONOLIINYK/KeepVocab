"""Fixed-epoch four-family experiment. Test scoring is a separate final stage."""
import argparse
import hashlib
import json
import time
from pathlib import Path
import numpy as np
from lib.image_regularization import read, write, digest, load_data, assemble, Model, fit, metrics


def model_hash(model):
    value = hashlib.sha256()
    for key in sorted(model.p):
        value.update(key.encode()); value.update(model.p[key].tobytes())
    for key in sorted(model.running):
        value.update(key.encode()); value.update(model.running[key].tobytes())
    return value.hexdigest()


def restore(state):
    model = Model([0]*49825, state['batchNorm'], state['epsilon'], state['momentum'])
    model.p = {k: np.asarray(v, dtype=np.float32) for k, v in state['parameters'].items()}
    model.running = {k: np.asarray(v, dtype=float) for k, v in state['running'].items()}
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--directory', default='work/image-regularization')
    ap.add_argument('--pilot-lane', type=int); ap.add_argument('--final-lane', type=int)
    ap.add_argument('--select', action='store_true'); ap.add_argument('--aggregate', action='store_true'); ap.add_argument('--tiny', action='store_true')
    args = ap.parse_args(); root = Path(args.directory); root.mkdir(exist_ok=True, parents=True)
    protocol = read('docs/image-regularization-protocol.json'); plan = read(protocol['dataSplit'])
    prepared = read(root/'prepared.json.gz'); preflight = read(root/'preflight.json')
    if not preflight['passed'] or preflight['kernelSha256'] != digest('scripts/lib/image_regularization.py') or preflight['protocolSha256'] != digest('docs/image-regularization-protocol.json'):
        raise ValueError('Run numerical preflight with current source first')
    data, encoder = load_data(plan)
    source = {name: digest(name) for name in ['scripts/lib/image_regularization.py', 'scripts/benchmark-image-regularization.py', 'docs/image-regularization-protocol.json', protocol['dataSplit']]}
    provenance = {'sourceSha256': source, 'preparedSha256': digest(root/'prepared.json.gz'), 'encoder': encoder,
                  'preflightSha256': digest(root/'preflight.json'), 'dataPreserved': plan['preservation']}

    def log(phase, **fields):
        print(json.dumps({'phase': phase, **fields}), flush=True)

    def job(seed, arm, family, strength):
        name = f'{seed}-{arm}-{family}-{strength:g}'
        return {'seed': seed, 'arm': arm, 'family': family, 'strength': strength, 'name': name}

    def ids(arm):
        return {'train': plan['commonIds']+plan[f'{arm}ExposureIds'], 'validation': plan['validationIds'], 'test': plan['testIds']}

    def folded(model):
        template = prepared['initials'][str(protocol['pilotSeed'])].copy()
        template.update({'weights': model.packed(folded=True), 'role': 'semantic',
                         'genericValidation': {'accepted': False, 'reason': 'Offline retrospective regularization experiment; not activated.'}})
        return template

    def native(model):
        return {'state': model.state(), 'stateSha256': model_hash(model), 'foldedModel': folded(model)}

    def run(config):
        path = root/'runs'/config['name']; path.mkdir(parents=True, exist_ok=True)
        if (path/'run.json.gz').exists():
            saved = read(path/'run.json.gz')
            if saved['provenance'] != provenance:
                raise ValueError('Stale cached fit '+config['name'])
            log('cached', name=config['name']); return saved
        partition = ids(config['arm']); model = Model(prepared['initials'][str(config['seed'])]['weights'], 'batchnorm' in config['family'])
        if model.batch_norm:
            model.calibrate_identity(assemble(data, partition['train'])['x'])
        snapshots, legacy = {}, None
        historical = read(f'tests/fixtures/image-meaning-shift/models/{config["seed"]}-{config["arm"]}.json.gz')
        def capture(epoch, current):
            nonlocal legacy
            if epoch % 10 == 0:
                snapshots[epoch] = current.clone()
            if config['family'] == 'baseline' and epoch == historical['epochsRun']:
                expected = np.asarray(historical['last']['weights'], dtype=np.float32)
                legacy = {'epoch': epoch, 'maximumWeightError': float(np.max(np.abs(current.packed()-expected))),
                          'note': 'Historical early-stop time sampled without stopping this600epoch run.'}
        start = time.monotonic(); log('start', **config)
        fitted = fit(model, data, partition['train'], partition['validation'], protocol['recipe'], config['strength'],
                     progress=lambda row: log('epoch', name=config['name'], epoch=row['epoch'], trainLoss=row['train']['loss'],
                                               validationCorrect=row['validation']['chosenAt1'], validationLoss=row['validation']['loss']), snapshot=capture)
        packed = {'epochs': np.asarray(list(snapshots), dtype=int)}
        for key in model.p:
            packed['p_'+key] = np.stack([m.p[key] for m in snapshots.values()])
        for key in model.running:
            packed['r_'+key] = np.stack([m.running[key] for m in snapshots.values()])
        np.savez_compressed(path/'snapshots.npz', **packed)
        write(path/'curve.json.gz', fitted['curve'])
        report = {'config': config, 'provenance': provenance, 'selected': native(fitted['selected']), 'last': native(fitted['model']),
                  'selectedEpoch': fitted['selectedEpoch'], 'epochsRun': fitted['epochsRun'], 'steps': fitted['steps'],
                  'maximumGradientNorm': fitted['maximumGradientNorm'], 'clippedSteps': fitted['clippedSteps'],
                  'stoppedBy': fitted['stoppedBy'], 'elapsedSeconds': time.monotonic()-start, 'legacyReplay': legacy,
                  'validationSelected': metrics(fitted['selected'], assemble(data, partition['validation'])),
                  'testEvaluated': False, 'snapshotsSha256': digest(path/'snapshots.npz')}
        write(path/'run.json.gz', report); log('finished', name=config['name'], epoch=fitted['selectedEpoch'], seconds=report['elapsedSeconds'])
        return report

    pilots = [job(protocol['pilotSeed'], arm, family, strength)
              for family in protocol['families'] for strength in (protocol['l2PilotGrid'] if 'l2' in family else [0]) for arm in protocol['arms']]
    if args.pilot_lane is not None:
        for i, config in enumerate(pilots):
            if i % 3 == args.pilot_lane:
                run(config)
        return
    if args.select:
        results = []
        for config in pilots:
            saved = read(root/'runs'/config['name']/'run.json.gz')
            if saved['provenance'] != provenance or saved['testEvaluated'] or saved['epochsRun'] != protocol['recipe']['epochs']:
                raise ValueError('Invalid pilot')
            results.append(saved)
        selection = {'provenance': provenance, 'families': {}, 'pilotSummaries': []}
        for family in protocol['families']:
            candidates = []
            for strength in (protocol['l2PilotGrid'] if 'l2' in family else [0]):
                rows = [r for r in results if r['config']['family'] == family and r['config']['strength'] == strength]
                item = {'family': family, 'strength': strength, 'validationCorrect': sum(r['validationSelected']['chosenAt1'] for r in rows),
                        'validationLoss': float(np.mean([r['validationSelected']['loss'] for r in rows]))}
                candidates.append(item); selection['pilotSummaries'].append(item)
            winner = sorted(candidates, key=lambda x: (-x['validationCorrect'], x['validationLoss'], x['strength']))[0]
            selection['families'][family] = winner
        write(root/'selection.json', selection); log('selected', families=selection['families']); return

    selection = read(root/'selection.json')
    if selection['provenance'] != provenance:
        raise ValueError('Selection belongs to different source')
    final = [job(seed, arm, family, selection['families'][family]['strength']) for seed in protocol['seeds'] for family in protocol['families'] for arm in protocol['arms']]
    if args.final_lane is not None:
        for i, config in enumerate(final):
            if i % 3 == args.final_lane:
                run(config)
        return
    if args.tiny:
        training_ids = ids('seen')['train']; plain = Model(prepared['initials'][str(protocol['pilotSeed'])]['weights'])
        before = metrics(plain, assemble(data, training_ids), rows=True)
        mistakes = {r['id'] for r in before['rows'] if not r['chosenAt1']}
        seen, tiny = set(), []
        for cid in sorted(training_ids, key=lambda cid: (cid not in mistakes, cid)):
            meaning = data[cid]['meaningId']
            if meaning not in seen:
                seen.add(meaning); tiny.append(cid)
            if len(tiny) == 8:
                break
        results = []
        for family in protocol['families']:
            model = Model(prepared['initials'][str(protocol['pilotSeed'])]['weights'], 'batchnorm' in family)
            if model.batch_norm:
                model.calibrate_identity(assemble(data, tiny)['x'])
            fitted = fit(model, data, tiny, tiny, protocol['recipe'], selection['families'][family]['strength'])
            last = metrics(fitted['model'], assemble(data, tiny), rows=True)
            passed = last['chosenAt1'] == 8 and last['pairwiseAccuracy'] >= 1-1e-12
            results.append({'family': family, 'strength': selection['families'][family]['strength'], 'ids': tiny,
                            'before': fitted['curve'][0]['train'], 'after': last, 'curve': fitted['curve'], 'passed': passed})
        write(root/'tiny.json.gz', {'recipe': protocol['recipe'], 'sameKernelAsFull': True, 'results': results, 'passed': all(r['passed'] for r in results)})
        if not all(r['passed'] for r in results):
            raise ValueError('Inspect failed same-recipe tiny overfit check')
        log('tiny-passed'); return
    if not args.aggregate:
        raise ValueError('Choose pilot/final lane, select, tiny or aggregate')
    # All24complete fits/checkpoints must exist and be frozen before test use.
    frozen = []
    for config in final:
        saved = read(root/'runs'/config['name']/'run.json.gz')
        if saved['provenance'] != provenance or saved['epochsRun'] != protocol['recipe']['epochs'] or saved['testEvaluated']:
            raise ValueError('Invalid final fit')
        for checkpoint in ['selected', 'last']:
            if model_hash(restore(saved[checkpoint]['state'])) != saved[checkpoint]['stateSha256']:
                raise ValueError('Frozen weights changed')
        if digest(root/'runs'/config['name']/'snapshots.npz') != saved['snapshotsSha256']:
            raise ValueError('Frozen snapshots changed')
        frozen.append(saved)
    tiny = read(root/'tiny.json.gz')
    if not tiny['passed']:
        raise ValueError('Memorization check required before test')
    report = {'protocol': protocol, 'provenance': provenance, 'selection': selection, 'runs': [], 'activated': False,
              'primaryTestSize': len(plan['testIds']), 'allRunsFrozenBeforeTest': True}
    for saved in frozen:
        config = saved['config']; partition = ids(config['arm']); parts = {k: assemble(data, v) for k, v in partition.items()}
        item = {k: v for k, v in saved.items() if k not in ['selected', 'last']}
        item['metrics'] = {split: {ck: metrics(restore(saved[ck]['state']), batch, rows=True) for ck in ['selected', 'last']} for split, batch in parts.items()}
        curve = read(root/'runs'/config['name']/'curve.json.gz')
        snapshots = np.load(root/'runs'/config['name']/'snapshots.npz')
        for index, epoch in enumerate(snapshots['epochs']):
            model = restore(saved['last']['state'])
            model.p = {k: snapshots['p_'+k][index] for k in model.p}
            model.running = {k: snapshots['r_'+k][index] for k in model.running}
            curve[int(epoch)]['test'] = metrics(model, parts['test'])
        curve[saved['selectedEpoch']]['test'] = metrics(restore(saved['selected']['state']), parts['test'])
        write(root/'runs'/config['name']/'complete-curve.json.gz', curve)
        report['runs'].append(item)
    # The CLIP baseline uses the initial plain model, which exactly reproduces it.
    clip = Model(prepared['initials'][str(protocol['pilotSeed'])]['weights'])
    report['clipTest'] = metrics(clip, assemble(data, plan['testIds']), rows=True)
    write(root/'report.json.gz', report); log('aggregated', fits=len(frozen), clipCorrect=report['clipTest']['chosenAt1'])


if __name__ == '__main__':
    main()

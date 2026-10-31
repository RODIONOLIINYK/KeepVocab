#!/usr/bin/env python3
"""Offline regularization search for the expanded meaning classifier.

Selection is train-only grouped CV plus fresh validation. The independent fresh
 test is opened only by --phase evaluate after selection.json has been frozen.
"""
import argparse
import concurrent.futures
import gzip
import importlib.util
import json
import multiprocessing
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    obj = importlib.util.module_from_spec(spec); spec.loader.exec_module(obj); return obj

d = module('meaning_diagnostics', 'scripts/diagnose-meaning-classifier.py')
r = module('meaning_metrics', 'scripts/evaluate-meaning-supplement.py')
reg = module('meaning_regularization', 'scripts/lib/meaning_regularization.py')
t, np = d.t, d.np
FIXTURE = ROOT / 'tests/fixtures/meaning-taxonomy/regularized-expansion'
OUT = ROOT / 'docs/meaning-taxonomy-training/regularized-expansion'
CURRENT_REGISTRY = ROOT / 'tests/fixtures/meaning-taxonomy/current-classifier.json'
SEED = 20261031
DATA = None


def read(path): return json.loads(path.read_text())
def write(path, value): t.write_json(path, value)


def load_partitions(names):
    data_bytes = (FIXTURE / 'dataset.json').read_bytes()
    embeddings_bytes = (FIXTURE / 'embeddings.json.gz').read_bytes()
    data = json.loads(data_bytes); encoded = json.loads(gzip.decompress(embeddings_bytes))
    assert encoded['datasetFileSha256'] == t.digest(data_bytes), 'Embedding matrix is stale for dataset.json'
    assert encoded['dimension'] == 512
    vectors = {row['id']: row['vector'] for row in encoded['rows']}
    assert len(vectors) == len(encoded['rows'])
    assert set(vectors) == {row['id'] for row in data['items']}
    hashes = {row['id']: row['promptSha256'] for row in encoded['rows']}
    for row in data['items']:
        prompt=f"A photo illustrating {row['word']} ({row['partOfSpeech'] or 'word'}): {row['definition']}"
        assert hashes[row['id']] == t.digest(prompt.encode())
        vector=np.asarray(vectors[row['id']],dtype=float)
        assert vector.shape==(512,) and np.isfinite(vector).all()
        assert abs(float(np.linalg.norm(vector))-1)<1e-5
    result = {}
    for split in names:
        rows = [row for row in data['items'] if row['split'] == split]
        missing = [row['id'] for row in rows if row['id'] not in vectors]
        assert not missing, f'Missing embeddings for {len(missing)} rows, first={missing[:3]}'
        result[split] = (rows, np.asarray([vectors[row['id']] for row in rows], dtype=float),
                         np.asarray([row['targets'] for row in rows], dtype=float))
    return result, encoded, t.digest(data_bytes), t.digest(embeddings_bytes)


def sample_weights(rows):
    weights = np.asarray([float(row.get('sampleWeight', 1.0)) for row in rows])
    if not np.isfinite(weights).all() or np.any(weights <= 0): raise ValueError('Invalid sampleWeight in rows')
    return weights


def scoring_mask(rows):
    # Paraphrases augment fitting only. Each source original is scored once.
    return np.asarray([row.get('kind') != 'paraphrase' for row in rows], dtype=bool)


def validate_group_contract(rows):
    groups = {}
    for row in rows:
        groups.setdefault(row['groupId'], []).append(row)
    for group, members in groups.items():
        units = {}
        for row in members: units.setdefault(row.get('meaningUnitId', row['id']), []).append(row)
        for unit, unit_rows in units.items():
            paraphrases = [row for row in unit_rows if row.get('kind') == 'paraphrase']
            if paraphrases:
                originals = [row for row in unit_rows if row.get('kind') != 'paraphrase']
                assert len(originals) == 1, f'Expected one original in meaning unit {unit}'
                assert all(row['sourceId'] == originals[0]['id'] for row in paraphrases)
                assert abs(float(originals[0].get('sampleWeight', 1)) - .5) < 1e-9
                assert all(abs(float(row.get('sampleWeight', 0)) - .5) < 1e-9 for row in paraphrases)
    for row in rows:
        if row.get('kind') == 'paraphrase':
            assert row.get('sourceId') and row.get('meaningUnitId') and row.get('sourceGroupId')
            assert row['groupId'] in groups


def initialize(x, y, weights, folds, score_indices):
    global DATA
    DATA = x, y, weights, folds, score_indices


def fold_predictions(config, x, y, weights, folds, score_indices):
    p = np.zeros((len(score_indices), y.shape[1]), dtype=float)
    score_lookup = {int(row_ix): out_ix for out_ix, row_ix in enumerate(score_indices)}
    optimizers = []
    for train_ix, valid_ix in folds:
        model = reg.fit(x[train_ix], y[train_ix], config, seed=7919, sample_weight=weights[train_ix])
        selected = [int(ix) for ix in valid_ix if int(ix) in score_lookup]
        if selected:
            dest = [score_lookup[ix] for ix in selected]
            p[dest] = t.predict(model, x[selected])
        optimizers.append(model['optimizer'])
    # Constant predictions can be the correct outcome under strong L1; record them,
    # don't reject a valid trial with the old nonconstant-score assertion.
    if not np.isfinite(p).all(): raise ValueError('Non-finite out-of-fold probabilities')
    return p, optimizers


def best_threshold(y, p):
    choices = [r.expanded_metrics(y, p, float(threshold)) for threshold in np.linspace(.2, .8, 25)]
    return sorted(choices, key=lambda m: (-m['macroF1'], -m['exactMatch'], m['bce'], abs(m['threshold']-.5)))[0]


def evaluate_trial(config):
    x, y, weights, folds, score_ix = DATA
    try:
        p, optimizers = fold_predictions(config, x, y, weights, folds, score_ix)
        yy = y[score_ix]
        metrics = best_threshold(yy, p)
        return {'config': config, 'status': 'ok', 'cv': metrics, 'optimizers': optimizers,
                'predictionStdByClass': p.std(axis=0).tolist()}
    except Exception as exc:
        return {'config': config, 'status': 'failed', 'error': f'{type(exc).__name__}: {exc}'}


def config_rank(row):
    if row['status'] != 'ok': return (1, float('inf'), float('inf'), row['config']['trial'])
    return (0, -row['cv']['macroF1'], row['cv']['bce'], row['config']['trial'])



def equivalent_linear(linear, mlp):
    margins={'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05}
    checks={k:linear[k]>=mlp[k]-margins[k] for k in ('macroF1','exactMatch','microPrecision','microRecall')}
    checks.update({k:linear[k]<=mlp[k]+margins[k] for k in ('bce','brier')})
    checks['perClassF1']=all(linear['perClass'][c]['f1']>=mlp['perClass'][c]['f1']-margins['perClassF1'] for c in t.CATEGORIES)
    return {'passed':all(checks.values()),'checks':checks,'margins':margins,
            'interpretation':'Practical noninferiority margins on the same fresh validation cohort; not statistical proof.'}


def promotion_gate(candidate, baseline):
    checks={'macroF1':candidate['macroF1']>=baseline['macroF1']-.01,
      'exactMatch':candidate['exactMatch']>=baseline['exactMatch']-.02,
      'microPrecision':candidate['microPrecision']>=baseline['microPrecision']-.02,
      'microRecall':candidate['microRecall']>=baseline['microRecall']-.02,
      'bce':candidate['bce']<=baseline['bce']+.01,'brier':candidate['brier']<=baseline['brier']+.003,
      'perClassF1':all(candidate['perClass'][c]['f1']>=baseline['perClass'][c]['f1']-.05 for c in t.CATEGORIES)}
    return {'passed':all(checks.values()),'checks':checks,
      'margins':{'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05}}

def export_model(model, config, threshold, calibration, encoded, provenance):
    return {'schemaVersion': 1, 'version': 'meaning-category-v1', 'role': 'meaning-category',
            'categories': t.CATEGORIES, 'inputDimension': 512, 'encoder': encoded['encoder'],
            'inputProtocol': encoded['inputProtocol'],
            'modelType': 'mlp' if config['hidden'] else 'logistic-regression',
            'preprocessor': {'mean': model['mean'].tolist(), 'scale': model['scale'].tolist()},
            'layers': [{'weights': w.tolist(), 'bias': b.tolist(),
                        'activation': 'tanh' if i < len(model['layers'])-1 else 'linear'}
                       for i, (w, b) in enumerate(model['layers'])],
            'hyperparameters': config, 'decisionThreshold': float(threshold),
            'calibration': calibration, 'calibrationApplied': calibration.get('method') != 'none',
            'calibrated': False, 'probabilityReliabilityEstablished': False, 'provenance': provenance}


def probabilities(artifact, x):
    return d.calibrate(t.predict(d.from_export(artifact), x), artifact.get('calibration', {'method':'none'}))


def parameter_summary(model):
    weights = np.concatenate([w.ravel() for w, _ in model['layers']])
    biases = np.concatenate([b.ravel() for _, b in model['layers']])
    return {'weightParameters': int(len(weights)), 'biasParameters': int(len(biases)),
            'totalParameters': int(len(weights)+len(biases)),
            'exactZeroWeights': int(np.count_nonzero(weights == 0)),
            'zeroWeightFraction': float(np.mean(weights == 0)),
            'nonzeroWeightCount': int(np.count_nonzero(weights))}


def confidence_errors(rows, y, p):
    out=[]
    for i,row in enumerate(rows):
        for k,name in enumerate(t.CATEGORIES):
            if (p[i,k] >= .9 and y[i,k] == 0) or (p[i,k] <= .1 and y[i,k] == 1):
                out.append({'id':row['id'],'word':row['word'],'category':name,'probability':float(p[i,k]),
                            'goldMembership':int(y[i,k]),'confidenceInWrongBinaryDecision':float(p[i,k] if y[i,k]==0 else 1-p[i,k])})
    return out


def family_key(config): return f"hidden-{config['hidden']}-{config['regularizer']}"


def random_config(rng, hidden, regularizer, phase, parent=None):
    if parent is None:
        base={'hidden':hidden,'preprocess':'standardize','center':True,
              'weightPower':float(rng.uniform(0,.8))}
        if regularizer=='l2':
            base.update(l1=0.0,l2=float(10**rng.uniform(-6,-1)))
        elif regularizer=='l1':
            base.update(l1=float(10**rng.uniform(-6,-2)),l2=0.0)
        else:
            base.update(l1=float(10**rng.uniform(-6,-2)),l2=float(10**rng.uniform(-6,-1)))
    else:
        base={k:v for k,v in parent.items() if k not in ('trial','phase','maxIterations','regularizer')}
        if regularizer=='l2':
            base.update(l1=0.0,l2=float(10**np.clip(np.log10(max(parent['l2'],1e-8))+rng.normal(0,.55),-7,-.5)))
        elif regularizer=='l1':
            base.update(l2=0.0,l1=float(10**np.clip(np.log10(max(parent['l1'],1e-8))+rng.normal(0,.55),-7,-2)))
        else:
            base.update(l1=float(10**np.clip(np.log10(max(parent['l1'],1e-8))+rng.normal(0,.45),-7,-2)),
                        l2=float(10**np.clip(np.log10(max(parent['l2'],1e-8))+rng.normal(0,.45),-7,-1)))
        base['weightPower']=float(np.clip(parent['weightPower']+rng.normal(0,.12),0,.9))
    base.update(regularizer=regularizer,phase=phase,maxIterations=600 if phase=='broad' else 800)
    return base


def select(workers):
    started=time.monotonic(); OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists(): raise RuntimeError('Selection or test report already exists; refusing overwrite/reuse.')
    subprocess.run(['node','scripts/audit-meaning-regularization.mjs'],cwd=ROOT,check=True,capture_output=True)
    parts,encoded,dataset_hash,embedding_hash=load_partitions(['train','validation'])
    rows,x,y=parts['train']; val_rows,xv,yv=parts['validation']
    assert len(val_rows)==48, f'Expected 48 fresh validation meanings; got {len(val_rows)}'
    validate_group_contract(rows)
    score_ix=np.flatnonzero(scoring_mask(rows))
    weights=sample_weights(rows)
    groups=np.asarray([row['groupId'] for row in rows])
    # Assign folds on original meanings only, then expand each held-out group to
    # all of its paraphrases for fitting isolation. Every core original is scored once.
    core_groups=groups[score_ix]; core_y=y[score_ix]
    core_folds=t.group_folds(core_y,core_groups,SEED,count=4)
    folds=[]; scored=[]
    for ctr,cva in core_folds:
        train_groups=set(core_groups[ctr]); valid_groups=set(core_groups[cva])
        assert not train_groups & valid_groups
        tr=np.flatnonzero(np.isin(groups,list(train_groups)))
        va=np.flatnonzero(np.isin(groups,list(valid_groups)))
        assert set(groups[tr])==train_groups and set(groups[va])==valid_groups
        folds.append((tr,va)); scored.extend(score_ix[cva].tolist())
    assert sorted(scored)==sorted(score_ix.tolist()) and len(scored)==len(set(scored)), 'Every core meaning must be OOF-scored exactly once.'
    current_registry=read(CURRENT_REGISTRY)
    current_artifact_path=ROOT/current_registry['artifact']
    current=read(current_artifact_path)
    current_hash=t.digest(current_artifact_path.read_bytes())
    assert current_hash==current_registry['artifactFileSha256'], 'Current registry artifact hash mismatch'
    assert current['hyperparameters']['hidden']==32
    current_config={k:v for k,v in current['hyperparameters'].items() if k in ('hidden','preprocess','center','l2','weightPower')}
    protocol={'schemaVersion':1,'datasetFileSha256':dataset_hash,'embeddingsFileSha256':embedding_hash,
      'seed':SEED,'fitSeed':7919,'workers':workers,'trainingRows':len(rows),'scoredOriginalRows':len(score_ix),
      'validationRows':len(val_rows),'validationPromotionGateComparison':'Frozen current artifact on the same fresh validation meanings; all predeclared margins must pass for eligibility.','currentArtifactPath':current_registry['artifact'],'currentArtifactSha256':current_hash,'trainIds':[q['id'] for q in rows],'validationIds':[q['id'] for q in val_rows],
      'trainGroups':len(set(groups)),'scoringRule':'Paraphrase rows augment fitting only. Grouped by recomputed parent group; only original meaning rows contribute CV scores, threshold selection, and calibration.',
      'augmentationWeights':'Each parent original and each paraphrase in its unit have sampleWeight=.5; no-paraphrase rows have weight=1. Shared group IDs keep unit and related roots in one fold.',
      'search':'48 broad randomized configurations (8 per architecture x regularizer) and 24 narrow configurations (4 per architecture x regularizer), total 72; L1, L2, and elastic-net for linear and 32-unit heads.',
      'searchSpace':{'architectures':['linear six-output head','512-32-tanh-6-output head'],'regularizers':['exact L1','L2','elastic net'],'preprocessing':'Fixed to current classifier standardize + center feature preparation.','broadMaxIterations':600,'narrowMaxIterations':800,'L1Log10Range':[-6,-2],'L2Log10Range':[-6,-1]},
      'selection':'Top CV candidates per architecture/regularizer; validation chooses each architecture winner, then chooses 32-unit only when linear misses predeclared practical margins. Validation promotion eligibility is separately checked versus the frozen current artifact. Test remains unopened.',
      'promotionGate':{'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05},
      'currentClassifier':{'artifact':current_registry['artifact'],'sha256':current_hash,'config':current_config},
      'limitations':['AI-authored/reviewed semantic pilot; not human-expert truth or real app prevalence.','Validation is used for selecting configuration/calibration.','Sparse coefficients and grouped CV are diagnostics, not proof of real-world semantic accuracy.']}
    write(OUT/'protocol.json',protocol); protocol_hash=t.digest((OUT/'protocol.json').read_bytes())
    rng=np.random.default_rng(SEED); candidates=[]
    cells=[(h,regime) for h in (0,32) for regime in ('l1','l2','elasticnet')]
    for h,regime in cells:
        for _ in range(8): candidates.append(random_config(rng,h,regime,'broad'))
    # Fit six workers as requested; every trial is isolated and all convergence states are retained.
    trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),
        initializer=initialize,initargs=(x,y,weights,folds,score_ix)) as pool:
        for i,row in enumerate(pool.map(evaluate_trial,[dict(c,trial=i) for i,c in enumerate(candidates)]),1):
            trials.append(row)
            if i%8==0: print(f'Broad {i}/48 complete; successful={sum(z["status"]=="ok" for z in trials)}',flush=True)
        narrowed=[]
        write(OUT/'broad-trials.json',trials)
        for h,regime in cells:
            parents=[q['config'] for q in sorted([q for q in trials if q['status']=='ok' and q['config']['hidden']==h and q['config']['regularizer']==regime],key=config_rank)[:4]]
            if not parents: raise RuntimeError(f'No successful broad candidates for hidden={h}, regularizer={regime}')
            for _ in range(4): narrowed.append(random_config(rng,h,regime,'narrow',parents[int(rng.integers(len(parents)))]))
        start=len(trials)
        for i,row in enumerate(pool.map(evaluate_trial,[dict(c,trial=start+i) for i,c in enumerate(narrowed)]),1):
            trials.append(row)
            if i%8==0: print(f'Narrow {i}/24 complete; successful={sum(z["status"]=="ok" for z in trials)}',flush=True)
    write(OUT/'trials.json',trials)
    ok=[q for q in trials if q['status']=='ok']
    if not ok: raise RuntimeError('All regularization search configurations failed; inspect trials.json')
    # Preserve top two per cell for confirmation and fresh validation.
    finalists=[]
    for h,regime in cells:
        finalists += sorted([q for q in ok if q['config']['hidden']==h and q['config']['regularizer']==regime],key=config_rank)[:2]
    evaluated=[]; artifacts={}
    for trial in finalists:
        cfg=trial['config']; cvp,_=fold_predictions(cfg,x,y,weights,folds,score_ix)
        yy=y[score_ix]
        try: calibration=d.fit_calibration(yy,cvp,'temperature-global-bias')
        except Exception: calibration=d.fit_calibration(yy,cvp,'none')
        rawthr=trial['cv']['threshold']; calthr=float(d.calibrate(np.full((1,6),rawthr),calibration)[0,0])
        fitted=reg.fit(x,y,cfg,seed=7919,sample_weight=weights)
        rawv=t.predict(fitted,xv); cv=d.calibrate(rawv,calibration)
        rawmetrics=r.expanded_metrics(yv,rawv,rawthr); calmetrics=r.expanded_metrics(yv,cv,calthr)
        none=d.fit_calibration(yy,cvp,'none')
        use=calmetrics['bce'] < rawmetrics['bce'] and calmetrics['brier'] <= rawmetrics['brier']+.002
        if not use: calibration=none; threshold=rawthr; pv=rawv
        else: threshold=calthr; pv=cv
        name=f"candidate-{cfg['hidden']}-{cfg['regularizer']}-{cfg['trial']}.json"
        prov={'datasetFileSha256':dataset_hash,'embeddingsFileSha256':embedding_hash,'protocolFileSha256':protocol_hash,
              'trainIds':[q['id'] for q in rows],'validationIds':[q['id'] for q in val_rows],
              'trainedOn':'training split only; CV/threshold/calibration scores exclude paraphrases; fresh validation used only for selection.',
              'testUsedForSelection':False,'legacyEvaluationUsedForSelection':False,'regularization':fitted['regularization']}
        artifact=export_model(fitted,cfg,threshold,calibration,encoded,prov); write(FIXTURE/name,artifact); artifacts[name]=artifact
        evaluated.append({'config':cfg,'cv':trial['cv'],'optimizer':fitted['optimizer'],'regularization':fitted['regularization'],
          'parameters':parameter_summary(fitted),'originalOOFMetrics':r.expanded_metrics(yy,cvp,rawthr),
          'actualTrainOriginalMetrics':r.expanded_metrics(yy,d.calibrate(t.predict(fitted,x[score_ix]),calibration),threshold),
          'rawValidation':rawmetrics,'validation':r.expanded_metrics(yv,pv,threshold),'calibration':calibration,
          'calibrationApplied':use,'threshold':threshold,'confidentValidationErrors':confidence_errors(val_rows,yv,pv),
          'artifact':name,'artifactFileSha256':t.digest((FIXTURE/name).read_bytes())})
        print(f"Finalist {name} validation macro-F1={evaluated[-1]['validation']['macroF1']:.4f}",flush=True)
    # Choose best linear and best 32-unit candidates on the same fresh validation cohort,
    # then apply the cheaper-linear practical margin rule before promotion gating.
    bycell={}
    for h,regime in cells:
        cell=[q for q in evaluated if q['config']['hidden']==h and q['config']['regularizer']==regime]
        bycell[f'hidden-{h}-{regime}']=sorted(cell,key=lambda q:(-q['validation']['macroF1'],q['validation']['bce'],-q['validation']['exactMatch']))[0]
    best_linear=min([q for q in evaluated if q['config']['hidden']==0],key=lambda q:(-q['validation']['macroF1'],q['validation']['bce'],-q['validation']['exactMatch']))
    best_32=min([q for q in evaluated if q['config']['hidden']==32],key=lambda q:(-q['validation']['macroF1'],q['validation']['bce'],-q['validation']['exactMatch']))
    linear_equivalence=equivalent_linear(best_linear['validation'],best_32['validation'])
    chosen_family='linear' if linear_equivalence['passed'] else '32'
    selected=best_linear if chosen_family=='linear' else best_32
    selected_artifact=artifacts[selected['artifact']]
    selected_copy=FIXTURE/'classifier-regularized-selected.json'
    selected_copy.write_text(json.dumps(selected_artifact,ensure_ascii=False,indent=2)+'\n')
    oldv=probabilities(current,xv)
    current_validation=r.expanded_metrics(yv,oldv,current['decisionThreshold'])
    validation_gate=promotion_gate(selected['validation'],current_validation)
    # Fixed current 32-unit config: data-size and augmentation ablation, all on new training rows.
    train_orig_ix=np.asarray([i for i,row in enumerate(rows) if row.get('kind')!='paraphrase'])
    ablations={}
    for label,ix,ww in [('newdata-no-paraphrases',train_orig_ix,np.ones(len(train_orig_ix))),
                         ('newdata-shared-weight-paraphrases',np.arange(len(rows)),weights)]:
        model=reg.fit(x[ix],y[ix],current_config,seed=7919,sample_weight=ww)
        # Hold current published calibration and threshold fixed for a paired data ablation.
        ab_art=export_model(model,current_config,current['decisionThreshold'],current.get('calibration',{'method':'none'}),encoded,
          {'datasetFileSha256':dataset_hash,'embeddingsFileSha256':embedding_hash,'protocolFileSha256':protocol_hash,
           'control':label,'testUsedForSelection':False})
        pv=probabilities(ab_art,xv)
        ablations[label]={'validation':r.expanded_metrics(yv,pv,ab_art['decisionThreshold']),
          'optimizer':model['optimizer'],'regularization':model['regularization'],'parameters':parameter_summary(model),
          'trainRows':len(ix),'artifact':ab_art}
        write(FIXTURE/f'{label}.json',ab_art)
    ablations['current-artifact']={'validation':r.expanded_metrics(yv,oldv,current['decisionThreshold']),
       'optimizer':None,'parameters':{'totalParameters':sum(w.size+b.size for w,b in d.from_export(current)['layers'])}}
    selection={'schemaVersion':1,'datasetFileSha256':dataset_hash,'embeddingsFileSha256':embedding_hash,
      'protocolFileSha256':protocol_hash,'decisionFrozenBeforeTest':True,'testUsedForSelection':False,
      'currentArtifactPath':current_registry['artifact'],'currentArtifactSha256':current_hash,
      'selected':{'artifact':selected['artifact'],'artifactFileSha256':selected['artifactFileSha256'],
                  'artifactCopySha256':t.digest(selected_copy.read_bytes()),'config':selected['config'],
                  'validation':selected['validation'],'calibration':selected['calibration'],'threshold':selected['threshold'],
                  'promotionGate':protocol['promotionGate']},
      'linearPracticalEquivalence':linear_equivalence,'bestLinearValidation':best_linear['validation'],
      'best32Validation':best_32['validation'],'selectedFamily':chosen_family,
      'validationPromotionGate':{**validation_gate,'comparatorValidation':current_validation},
      'eligibleBeforeTest':bool(validation_gate['passed']),
      'selectedArtifact':'tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json',
      'protocolFileSha256':protocol_hash,'byArchitectureAndRegularizer':bycell,'finalists':evaluated,
      'ablation':{k:{kk:vv for kk,vv in v.items() if kk!='artifact'} for k,v in ablations.items()},
      'ablationArtifactHashes':{k:t.digest((FIXTURE/f'{k}.json').read_bytes()) for k in ('newdata-no-paraphrases','newdata-shared-weight-paraphrases')},
      'configurationCount':len(trials),'successfulConfigurations':len(ok),'elapsedSeconds':time.monotonic()-started}
    write(OUT/'selection.json',selection)
    print(json.dumps({'selected':selection['selected'],'freshTestEvaluated':False},indent=2),flush=True)


def evaluate():
    if (OUT/'report.json').exists(): raise RuntimeError('Frozen test report already exists; refusing a second test evaluation.')
    selection_bytes=(OUT/'selection.json').read_bytes(); sel=read(OUT/'selection.json')
    protocol_bytes=(OUT/'protocol.json').read_bytes(); protocol=read(OUT/'protocol.json')
    protocol_hash=t.digest(protocol_bytes)
    assert sel['decisionFrozenBeforeTest'] and not sel['testUsedForSelection']
    assert sel['protocolFileSha256']==protocol_hash
    assert sel['eligibleBeforeTest']==sel['validationPromotionGate']['passed']
    # A frozen, ineligible candidate can still be evaluated diagnostically. Its
    # test score cannot restore eligibility or trigger selection of another head.
    selected_path=FIXTURE/'classifier-regularized-selected.json'; artifact=read(selected_path)
    selected_copy_hash=t.digest(selected_path.read_bytes())
    assert selected_copy_hash==sel['selected']['artifactCopySha256'], 'Selected artifact copy changed after freeze'
    candidate_path=FIXTURE/sel['selected']['artifact']
    assert t.digest(candidate_path.read_bytes())==sel['selected']['artifactFileSha256'], 'Selected candidate artifact changed'
    parts,_,dataset_hash,embedding_hash=load_partitions(['test'])
    assert dataset_hash==sel['datasetFileSha256']==protocol['datasetFileSha256'], 'Dataset changed after selection'
    assert embedding_hash==sel['embeddingsFileSha256']==protocol['embeddingsFileSha256'], 'Embeddings changed after selection'
    rows,x,y=parts['test']; assert len(rows)==48, f'Expected 48 fresh test rows; got {len(rows)}'
    frozen_path=protocol['currentClassifier']['artifact']
    assert frozen_path==sel['currentArtifactPath']
    frozen_artifact_path=ROOT/frozen_path
    assert t.digest(frozen_artifact_path.read_bytes())==protocol['currentClassifier']['sha256']==sel['currentArtifactSha256'], 'Frozen current comparator changed'
    current=read(frozen_artifact_path)
    pnew=probabilities(artifact,x); pold=probabilities(current,x)
    newm=r.expanded_metrics(y,pnew,artifact['decisionThreshold']); oldm=r.expanded_metrics(y,pold,current['decisionThreshold'])
    test_gate=promotion_gate(newm,oldm)
    # Fixed-config data ablations were named and frozen before test; evaluate them
    # as controls without using their scores to select or replace the candidate.
    ablation_results={}
    for label in ('newdata-no-paraphrases','newdata-shared-weight-paraphrases'):
        path=FIXTURE/f'{label}.json'
        assert t.digest(path.read_bytes())==sel['ablationArtifactHashes'][label], f'{label} artifact changed after selection'
        ab=read(path); pa=probabilities(ab,x); ma=r.expanded_metrics(y,pa,ab['decisionThreshold'])
        boot=t.bootstrap_comparison(y,pa,pold,np.asarray([q['groupId'] for q in rows]),ab['decisionThreshold'],
                                    repetitions=1000,baseline_threshold=current['decisionThreshold'])
        ablation_results[label]={'metrics':ma,'parameters':parameter_summary(d.from_export(ab)),
             'confidentErrors':confidence_errors(rows,y,pa),'groupedBootstrapVsCurrentMacroF1':boot}
    bootstrap=t.bootstrap_comparison(y,pnew,pold,np.asarray([q['groupId'] for q in rows]),artifact['decisionThreshold'],
                                      repetitions=1000,baseline_threshold=current['decisionThreshold'])
    final_eligible=bool(sel['eligibleBeforeTest'] and test_gate['passed'])
    gate_result={'passed':test_gate['passed'],'eligibleBeforeTest':sel['eligibleBeforeTest'],
      'eligibleForRegistryUpdate':final_eligible,'validationChecks':sel['validationPromotionGate']['checks'],
      'testChecks':test_gate['checks'],'margins':test_gate['margins'],
      'comparator':frozen_path,'comparatorSha256':protocol['currentClassifier']['sha256'],
      'meaning':'Registry changes only if the validation and frozen test gates both pass; failed test results do not trigger candidate reselection.'}
    report={'schemaVersion':1,'selectionFileSha256':t.digest(selection_bytes),'protocolFileSha256':protocol_hash,
      'datasetFileSha256':dataset_hash,'embeddingsFileSha256':embedding_hash,'freshTestCount':len(rows),
      'testUsedForSelection':False,'selectedFamily':sel['selectedFamily'],
      'linearPracticalEquivalence':sel['linearPracticalEquivalence'],
      'validationPromotionGate':sel['validationPromotionGate'],
      'results':{'selectedRegularized':{'metrics':newm,'confidentErrors':confidence_errors(rows,y,pnew),
          'parameters':parameter_summary(d.from_export(artifact))},
        'currentClassifier':{'metrics':oldm,'confidentErrors':confidence_errors(rows,y,pold),
          'parameters':parameter_summary(d.from_export(current))},'fixedDataAblations':ablation_results},
      'selectedVsCurrentGroupedBootstrapMacroF1':bootstrap,'promotionGate':gate_result,
      'limitations':['Only 48 fresh AI-reviewed pilot meanings; not human-expert truth or real app prevalence.',
        'One frozen test evaluation after architecture/configuration selection; do not reuse these labels for another search.',
        'Validation-selected thresholds and calibrators are not guarantees of deployment calibration.']}
    write(OUT/'report.json',report)
    write(OUT/'test-predictions.json',{'categories':t.CATEGORIES,'rows':[{'id':row['id'],'word':row['word'],'targets':row['targets'],
      'selectedProbabilities':pnew[i].tolist(),'currentProbabilities':pold[i].tolist()} for i,row in enumerate(rows)]})
    if final_eligible:
      newreg={'schemaVersion':1,'role':'current-meaning-category-classifier','modelType':artifact['modelType'],
        'artifact':'tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json',
        'artifactFileSha256':selected_copy_hash,'selection':'docs/meaning-taxonomy-training/regularized-expansion/selection.json',
        'confirmation':'docs/meaning-taxonomy-training/regularized-expansion/report.json','productionPersonalizerChanged':False}
      write(CURRENT_REGISTRY,newreg)
    print(json.dumps({'promotionGate':gate_result,'selected':newm,'current':oldm},indent=2),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=['select','evaluate'],default='select');parser.add_argument('--workers',type=int,default=6)
    args=parser.parse_args()
    if args.workers<1: parser.error('--workers must be positive')
    if args.phase=='select': select(args.workers)
    else: evaluate()

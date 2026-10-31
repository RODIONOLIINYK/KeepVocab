#!/usr/bin/env python3
"""Controlled dropout/L2 experiment. Frozen labels; nested grouped early stopping.

Select before opening either retired test cohort. These are regression checks,
not fresh blind confirmation. Production inference remains unchanged.
"""
import argparse
import concurrent.futures
import gzip
import importlib.util
import json
import multiprocessing
from pathlib import Path
import platform
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
m=module('meaning_dropout_experiment','scripts/train-meaning-regularization.py')
drop=module('meaning_dropout_training','scripts/lib/meaning_dropout.py')
np,t=m.np,m.t
OUT=ROOT/'docs/meaning-taxonomy-training/dropout'
FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/dropout'
SEEDS=[7919,104729,130363]
DATA=None

def write(path,value):t.write_json(path,value)
def read(path):return json.loads(path.read_bytes())
def digest(path):return t.digest(path.read_bytes())
def key(cfg):return (cfg['dropout'],cfg['l2'],cfg['learningRate'])

def init(rows,x,y,weights,folds,core):
    global DATA
    DATA=rows,x,y,weights,folds,core

def cv_task(task):
    config,seed=task;rows,x,y,weights,folds,core=DATA
    lookup={int(ix):i for i,ix in enumerate(core)}
    p=np.zeros((len(core),6));covered=[];fits=[]
    for fold,(tr,va) in enumerate(folds):
        model=drop.fit_with_inner_stop([rows[i] for i in tr],x[tr],y[tr],weights[tr],config,seed,20261101+fold)
        selected=[int(ix) for ix in va if int(ix) in lookup]
        p[[lookup[ix] for ix in selected]]=t.predict(model,x[selected]);covered+=selected
        fits.append(model['optimizer'])
    assert sorted(covered)==sorted(core.tolist()) and len(covered)==len(set(covered))
    threshold=m.best_threshold(y[core],p)['threshold']
    cal=m.d.fit_calibration(y[core],p,'temperature-global-bias')
    calibrated=m.d.calibrate(p,cal)
    transformed=float(m.d.calibrate(np.full((1,6),threshold),cal)[0,0])
    return {'config':config,'seed':seed,'metrics':m.r.expanded_metrics(y[core],calibrated,transformed),
      'rawMetrics':m.r.expanded_metrics(y[core],p,threshold),'calibration':cal,
      'threshold':transformed,'fits':fits,'oof':p.tolist()}

def rank(q):return (-q['metrics']['macroF1'],q['metrics']['bce'],q['config']['dropout'],q['config']['trial'])

def average(metrics):
    keys=['macroF1','exactMatch','microPrecision','microRecall','bce','brier','microF1','macroAveragePrecision']
    return {**{k:float(np.mean([v[k] for v in metrics])) for k in keys},
      'macroF1StandardDeviation':float(np.std([v['macroF1'] for v in metrics],ddof=1)),
      'perClass':{c:{'f1':float(np.mean([v['perClass'][c]['f1'] for v in metrics]))} for c in t.CATEGORIES}}

def without_oof(q):return {k:v for k,v in q.items() if k!='oof'}

def frozen_inputs():
    registry=read(m.CURRENT_REGISTRY);artifact=read(ROOT/registry['artifact'])
    assert digest(ROOT/registry['artifact'])==registry['artifactFileSha256']
    return registry,artifact

def select(workers):
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen outputs exist; refusing overwrite.')
    OUT.mkdir(parents=True,exist_ok=True);FIXTURE.mkdir(parents=True,exist_ok=True)
    subprocess.run(['node','scripts/audit-meaning-regularization.mjs'],cwd=ROOT,check=True,capture_output=True)
    parts,encoded,dh,eh=m.load_partitions(['train','validation'])
    rows,x,y=parts['train'];vrows,xv,yv=parts['validation'];weights=m.sample_weights(rows)
    m.validate_group_contract(rows);core=np.flatnonzero(m.scoring_mask(rows))
    groups=np.asarray([q['groupId'] for q in rows]);folds=[]
    for tr,va in t.group_folds(y[core],groups[core],20261031,count=4):
        a=np.flatnonzero(np.isin(groups,groups[core[tr]]));b=np.flatnonzero(np.isin(groups,groups[core[va]]))
        assert not set(groups[a])&set(groups[b]);folds.append((a,b))
    registry,current=frozen_inputs();l2s=[0.,.001,.010670702863990359,current['hyperparameters']['l2']]
    base={'hidden':32,'preprocess':'standardize','center':True,'l1':0.,
      'weightPower':current['hyperparameters']['weightPower'],'learningRate':.003,
      'batchSize':64,'maxEpochs':400,'minEpochs':30,'patience':35,'minDelta':.0001}
    protocol={'schemaVersion':1,'date':'2026-11-01','datasetFileSha256':dh,'embeddingsFileSha256':eh,
      'currentClassifier':registry,'fixedLinearComparator':'tests/fixtures/meaning-taxonomy/regularized-expansion/candidate-0-l2-52.json',
      'fixedLinearComparatorSha256':digest(ROOT/'tests/fixtures/meaning-taxonomy/regularized-expansion/candidate-0-l2-52.json'),
      'architecture':'512 -> 32 tanh -> training-only inverted dropout -> 6 independent sigmoids',
      'trainingRows':len(rows),'independentTrainingMeanings':len(core),'trainingMeaningUnits':float(weights.sum()),
      'labelsChanged':False,'initialGrid':{'dropout':[0.,.1,.2,.3],'l2':l2s},'baseConfig':base,
      'search':'16 grid configs, then 4 local dropout candidates and their 4 matched zero-dropout controls. Top two dropout configs, exact matched controls, and the strongest zero-dropout config repeat over three seeds.',
      'seeds':SEEDS,'outerFoldSeed':20261031,'innerFoldSeedBase':20261101,
      'outerFolds':[{'trainIds':[rows[i]['id'] for i in tr],'validationIds':[rows[i]['id'] for i in va]} for tr,va in folds],
      'earlyStopping':'Within each outer training portion, split original meaning groups into five folds; monitor originals from one fold, fit the remaining groups with their paraphrases, choose epoch by unweighted BCE, then refit the entire outer training portion for that epoch. Outer fold never used for early stopping.',
      'loss':'Sample-weighted multilabel BCE with training-only positive weights; coupled L2 on weights only; biases free.',
      'controls':'Same Adam implementation, initialization, minibatch order, learning rate, row weights and early-stopping protocol for dropout and zero-dropout; dropout RNG separate from minibatch RNG.',
      'selection':'Mean validation F1 ranks finalist settings within dropout/zero-dropout. Prefer the strongest zero-dropout setting unless dropout improves mean grouped-CV F1 over its exact matched control by at least .003 and stays within validation margins of both that control and the strongest zero-dropout setting. Fixed seed7919 is exported, never the best observed seed.',
      'promotion':'Offline registry only: candidate mean CV F1 must improve on the frozen head CV by .003, validation mean and fixed-seed metrics must pass, and both retired regression cohorts must pass all margins. No alternate candidate is selected after evaluation. No production activation; fresh independent confirmation remains required.',
      'margins':{'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05},
      'testCohorts':['retired-original-120','retired-new-48'],'freshBlindConfirmation':False,
      'sources':{'trainer':digest(ROOT/'scripts/lib/meaning_dropout.py'),'runner':digest(Path(__file__)),
        'python':platform.python_version(),'numpy':np.__version__},'workers':workers}
    write(OUT/'protocol.json',protocol);ph=digest(OUT/'protocol.json')
    configs=[]
    for rate in [0.,.1,.2,.3]:
        for strength in l2s:configs.append({**base,'dropout':rate,'l2':strength,'trial':len(configs),'phase':'grid'})
    init(rows,x,y,weights,folds,core);started=time.monotonic();trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),
      initializer=init,initargs=(rows,x,y,weights,folds,core)) as pool:
        for q in pool.map(cv_task,[(c,SEEDS[0]) for c in configs]):
            trials.append(q);print('Grid',len(trials),'/16',key(q['config']),'F1',q['metrics']['macroF1'],flush=True)
        write(OUT/'grid-trials.json',[without_oof(q) for q in trials])
        parents=sorted([q for q in trials if q['config']['dropout']>0],key=rank)[:2]
        rng=np.random.default_rng(20261101);narrow=[]
        for parent in parents:
            for _ in range(2):
                strength=float(10**(np.log10(max(parent['config']['l2'],.0001))+rng.uniform(-.35,.35)))
                rate=float(np.clip(parent['config']['dropout']+rng.choice([-.05,.05]),.05,.35))
                for p in [rate,0.]:
                    narrow.append({**base,'dropout':p,'l2':strength,'trial':len(configs)+len(narrow),'phase':'local'})
        configs+=narrow
        for q in pool.map(cv_task,[(c,SEEDS[0]) for c in narrow]):
            trials.append(q);print('Local',len(trials)-16,'/8',key(q['config']),'F1',q['metrics']['macroF1'],flush=True)
        contenders=sorted([q for q in trials if q['config']['dropout']>0],key=rank)[:2]
        finalist_configs=[]
        for q in contenders:
            cfg=q['config'];control=next(c for c in configs if c['dropout']==0 and c['l2']==cfg['l2'])
            for c in [cfg,control]:
                if not any(key(v)==key(c) for v in finalist_configs):finalist_configs.append(c)
        best_zero=sorted([q for q in trials if q['config']['dropout']==0],key=rank)[0]['config']
        if not any(key(v)==key(best_zero) for v in finalist_configs):finalist_configs.append(best_zero)
        tasks=[(c,seed) for c in finalist_configs for seed in SEEDS[1:]]
        repeated=list(pool.map(cv_task,tasks));trials+=repeated
    compressed={'categories':t.CATEGORIES,'coreIds':[rows[i]['id'] for i in core],
      'runs':[{'trial':q['config']['trial'],'seed':q['seed'],'probabilities':q['oof']} for q in trials]}
    (OUT/'oof-predictions.json.gz').write_bytes(gzip.compress(json.dumps(compressed,separators=(',',':')).encode(),compresslevel=9,mtime=0))
    write(OUT/'trials.json',[without_oof(q) for q in trials])
    # The frozen LBFGS baseline is evaluated on exactly the same outer folds.
    current_cv,lbfgs_fits=m.fold_predictions(current['hyperparameters'],x,y,weights,folds,core)
    current_cv_metrics=m.r.expanded_metrics(y[core],m.d.calibrate(current_cv,current['calibration']),current['decisionThreshold'])
    current_val=m.r.expanded_metrics(yv,m.probabilities(current,xv),current['decisionThreshold'])
    summaries=[]
    for cfg in finalist_configs:
        runs=[q for q in trials if key(q['config'])==key(cfg)]
        assert sorted(q['seed'] for q in runs)==sorted(SEEDS)
        validation=[];models=[]
        for seed in SEEDS:
            q=next(v for v in runs if v['seed']==seed)
            model=drop.fit_with_inner_stop(rows,x,y,weights,cfg,seed,20261200)
            artifact=m.export_model(model,cfg,q['threshold'],q['calibration'],encoded,
              {'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
               'datasetFileSha256':dh,'embeddingsFileSha256':eh,'protocolFileSha256':ph,
               'testUsedForSelection':False,'legacyEvaluationUsedForSelection':False,
               'trainingOnlyDropout':cfg['dropout'],'inferenceDropout':False,'seed':seed,
               'earlyStopping':model['optimizer']})
            name=f"candidate-{cfg['trial']}-seed-{seed}.json";write(FIXTURE/name,artifact)
            probs=m.probabilities(artifact,xv);metrics=m.r.expanded_metrics(yv,probs,artifact['decisionThreshold'])
            validation.append(metrics)
            models.append({'seed':seed,'artifact':name,'artifactFileSha256':digest(FIXTURE/name),
              'validation':metrics,'trainOriginalMetrics':m.r.expanded_metrics(y[core],m.probabilities(artifact,x[core]),artifact['decisionThreshold']),
              'optimizer':model['optimizer']})
        summaries.append({'config':cfg,'cvMean':average([q['metrics'] for q in runs]),
          'cvBySeed':[{'seed':q['seed'],'metrics':q['metrics']} for q in runs],
          'validationMean':average(validation),'models':models})
        print('Repeated',key(cfg),'CV',summaries[-1]['cvMean']['macroF1'],'validation',summaries[-1]['validationMean']['macroF1'],flush=True)
    best_drop=min([q for q in summaries if q['config']['dropout']>0],key=lambda q:(-q['validationMean']['macroF1'],q['validationMean']['bce']))
    control=next(q for q in summaries if q['config']['dropout']==0 and q['config']['l2']==best_drop['config']['l2'])
    best_zero=min([q for q in summaries if q['config']['dropout']==0],key=lambda q:(-q['validationMean']['macroF1'],q['validationMean']['bce']))
    difference=best_drop['cvMean']['macroF1']-control['cvMean']['macroF1']
    paired_gate=m.promotion_gate(best_drop['validationMean'],control['validationMean'])
    best_zero_gate=m.promotion_gate(best_drop['validationMean'],best_zero['validationMean'])
    use_dropout=difference>=.003 and paired_gate['passed'] and best_zero_gate['passed']
    chosen=best_drop if use_dropout else best_zero
    chosen_fixed=next(q for q in chosen['models'] if q['seed']==SEEDS[0])
    val_gate=m.promotion_gate(chosen_fixed['validation'],current_val)
    mean_gate=m.promotion_gate(chosen['validationMean'],current_val)
    cv_improvement=chosen['cvMean']['macroF1']-current_cv_metrics['macroF1']
    eligible=val_gate['passed'] and mean_gate['passed'] and cv_improvement>=.003
    selected_path=FIXTURE/'classifier-candidate.json';selected_path.write_bytes((FIXTURE/chosen_fixed['artifact']).read_bytes())
    selection={'schemaVersion':1,'protocolFileSha256':ph,'datasetFileSha256':dh,'embeddingsFileSha256':eh,
      'decisionFrozenBeforeTest':True,'testUsedForSelection':False,'freshBlindConfirmation':False,
      'currentClassifier':registry,'currentCV':current_cv_metrics,'currentCVFits':lbfgs_fits,'currentValidation':current_val,
      'configurationCount':len(configs),'cvRuns':len(trials),'seeds':SEEDS,'finalists':summaries,
      'dropoutDecision':{'matchedControlTrial':control['config']['trial'],'dropoutTrial':best_drop['config']['trial'],
        'bestZeroDropoutTrial':best_zero['config']['trial'],'meanCVMacroF1Difference':difference,
        'validationGate':paired_gate,'bestZeroDropoutValidationGate':best_zero_gate,'useDropout':use_dropout},
      'selected':{'config':chosen['config'],'fixedSeed':SEEDS[0],'artifact':str(selected_path.relative_to(ROOT)),
        'artifactFileSha256':digest(selected_path),'cvMean':chosen['cvMean'],'validationMean':chosen['validationMean'],
        'fixedSeedValidation':chosen_fixed['validation']},
      'eligibilityBeforeRegressionChecks':{'passed':eligible,'fixedSeedValidation':val_gate,'meanValidation':mean_gate,
        'meanCVMacroF1DifferenceVsFrozenLBFGS':cv_improvement,'minimumCVGain':.003},
      'elapsedSeconds':time.monotonic()-started}
    write(OUT/'selection.json',selection)
    print(json.dumps({'selected':selection['selected']['config'],'dropoutDecision':selection['dropoutDecision'],
      'eligible':eligible,'testEvaluated':False},indent=2),flush=True)

def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Regression report already exists; refusing re-evaluation.')
    selection=read(OUT/'selection.json');protocol=read(OUT/'protocol.json')
    assert selection['decisionFrozenBeforeTest'] and not selection['testUsedForSelection']
    assert selection['protocolFileSha256']==digest(OUT/'protocol.json')
    selected_path=ROOT/selection['selected']['artifact'];assert digest(selected_path)==selection['selected']['artifactFileSha256']
    candidate=read(selected_path);registry=selection['currentClassifier']
    assert digest(ROOT/registry['artifact'])==registry['artifactFileSha256'];current=read(ROOT/registry['artifact'])
    lp=ROOT/protocol['fixedLinearComparator'];assert digest(lp)==protocol['fixedLinearComparatorSha256'];linear=read(lp)
    parts,_,dh,eh=m.load_partitions(['test']);assert dh==selection['datasetFileSha256'] and eh==selection['embeddingsFileSha256']
    oldroot=ROOT/'tests/fixtures/meaning-taxonomy/expanded-1000'
    old=read(oldroot/'dataset.json');encoded=json.loads(gzip.decompress((oldroot/'embeddings.json.gz').read_bytes()))
    assert encoded['datasetFileSha256']==digest(oldroot/'dataset.json')
    vectors={r['id']:r['vector'] for r in encoded['rows']};rr=[r for r in old['items'] if r['split']=='test']
    parts={'retired-new-48':parts['test'],'retired-original-120':(rr,np.asarray([vectors[r['id']] for r in rr]),np.asarray([r['targets'] for r in rr]))}
    summaries=selection['finalists'];pair=selection['dropoutDecision']
    control=next(q for q in summaries if q['config']['trial']==pair['matchedControlTrial'])
    dropped=next(q for q in summaries if q['config']['trial']==pair['dropoutTrial'])
    models={'candidate':candidate,'currentLBFGS':current,'fixedLinear':linear}
    for name,summary in [('matchedAdamControl',control),('dropoutAlternative',dropped)]:
        a=next(q for q in summary['models'] if q['seed']==SEEDS[0]);path=FIXTURE/a['artifact']
        assert digest(path)==a['artifactFileSha256'];models[name]=read(path)
    report={'schemaVersion':1,'selectionFileSha256':digest(OUT/'selection.json'),
      'protocolFileSha256':digest(OUT/'protocol.json'),'freshBlindConfirmation':False,
      'testUsedForHyperparameterOrSeedSelection':False,'labelsChanged':False,'results':{},'regressionGates':{}}
    predictions={'categories':t.CATEGORIES,'cohorts':{}}
    train_ids=set(candidate['provenance']['trainIds'])
    for name,(rows,x,y) in parts.items():
        assert not train_ids&{r['id'] for r in rows}
        probs={k:m.probabilities(a,x) for k,a in models.items()}
        metrics={k:m.r.expanded_metrics(y,probs[k],a['decisionThreshold']) for k,a in models.items()}
        report['results'][name]=metrics
        report['regressionGates'][name]=m.promotion_gate(metrics['candidate'],metrics['currentLBFGS'])
        report.setdefault('uncertainty',{})[name]=t.bootstrap_comparison(y,probs['candidate'],probs['currentLBFGS'],
          np.asarray([r['groupId'] for r in rows]),candidate['decisionThreshold'],baseline_threshold=current['decisionThreshold'])
        predictions['cohorts'][name]=[{'id':r['id'],'word':r['word'],'targets':r['targets'],
          'probabilities':{k:v[i].tolist() for k,v in probs.items()}} for i,r in enumerate(rows)]
    eligible=selection['eligibilityBeforeRegressionChecks']['passed'] and all(v['passed'] for v in report['regressionGates'].values())
    report['offlinePromotionEligible']=eligible
    report['productionPersonalizerChanged']=False
    report['limitations']=['Both test cohorts have already been inspected; this is a fixed regression experiment, not independent blind confirmation.',
      'AI-authored/reviewed pilot labels are frozen; dropout cannot resolve contradictory or ambiguous categories.',
      'Three seeds are a stability check, not proof of a statistically reliable population gain.']
    write(OUT/'report.json',report);write(OUT/'test-predictions.json',predictions)
    if eligible:
        write(m.CURRENT_REGISTRY,{'schemaVersion':1,'role':'current-meaning-category-classifier','modelType':'mlp',
          'artifact':selection['selected']['artifact'],'artifactFileSha256':selection['selected']['artifactFileSha256'],
          'selection':str((OUT/'selection.json').relative_to(ROOT)),'confirmation':str((OUT/'report.json').relative_to(ROOT)),
          'productionPersonalizerChanged':False,'freshBlindConfirmation':False})
    print(json.dumps({'promotedOffline':eligible,'results':report['results'],'gates':report['regressionGates']},indent=2),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True)
    ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('--workers must be positive')
    if args.phase=='select':select(args.workers)
    else:evaluate()

#!/usr/bin/env python3
"""Restore-best early stopping plus L2 on unchanged original-policy meanings.

Training-only stopping groups are reserved in every matched condition. No
full-data refit or post-fit calibration changes the retained checkpoint.
"""
import argparse,concurrent.futures,importlib.util,multiprocessing,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('early_l2_shared',ROOT/'scripts/train-meaning-structured.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
s,np=r.s,r.np
OUT=ROOT/'docs/meaning-taxonomy-training/early-l2';FIX=ROOT/'tests/fixtures/meaning-taxonomy/early-l2'
SEEDS=r.SEEDS;DATA=None
def configs():
    base={**r.make_configs()[0],'maxEpochs':1000,'capacitySweep':False}
    result=[]
    for width in [32,128,1024]:
        for l2 in [.0001,.001,.01,.1]:
            for patience in [15,30]:
                result.append({**base,'width':width,'l2':l2,'pairL2':l2,'patience':patience,'trial':len(result),'phase':'early-l2'})
    for width in [32,128,1024]:result.append({**base,'width':width,'l2':0.,'pairL2':0.,'patience':30,'trial':len(result),'phase':'zero-l2-control'})
    assert len(result)==27
    return result
def fit(rows,x,y,w,cfg,seed,split_seed=20261108,early=True):
    tr,va=r.j.a.d.inner_split(rows,y,split_seed);core=r.m.scoring_mask([rows[i] for i in tr])
    assert not {rows[i]['groupId'] for i in tr}&{rows[i]['groupId'] for i in va}
    assert all(rows[i].get('kind')!='paraphrase' for i in va)
    model=s.fit_neural(x[tr],y[tr],w[tr],cfg,seed,monitor=(x[va],y[va]) if early else None,
        epochs=None if early else cfg['maxEpochs'],scoring_mask=core)
    model['fitPartition']={'trainIds':[rows[i]['id'] for i in tr],'reservedMonitorIds':[rows[i]['id'] for i in va],
        'stoppingIds':[rows[i]['id'] for i in va] if early else [],'trainIndices':tr.tolist(),'monitorIndices':va.tolist(),
        'trainingOriginalCount':int(core.sum()),'restoredBestCheckpoint':early,'refittedOnMonitor':False}
    return model
def score_model(model,x,y):return r.h.score(y,np.exp(s.model_log_joint(model,x)),'map')
def setup(rows,x,y,w,core,folds):
    global DATA
    DATA=rows,x,y,w,core,folds
def cv_task(task):
    cfg,seed=task;rows,x,y,w,core,folds=DATA;lookup={int(i):k for k,i in enumerate(core)};log=np.zeros((len(core),64));fits=[];covered=[]
    for fold,(tr,va) in enumerate(folds):
        model=fit([rows[i] for i in tr],x[tr],y[tr],w[tr],cfg,seed,20261108+fold)
        ids=[int(i) for i in va if int(i) in lookup];dest=[lookup[i] for i in ids];log[dest]=s.model_log_joint(model,x[ids]);covered+=ids
        fits.append({'partition':model['fitPartition'],'optimizer':model['optimizer']})
    assert sorted(covered)==sorted(core.tolist()) and len(covered)==len(set(covered))
    return {'config':cfg,'seed':seed,'cv':r.h.score(y[core],np.exp(log),'map'),'fits':fits}
def rank(q):return (*r.ordering(q['cv']),q['config']['trial'])
def export(model,rows,ph,seed):
    partition=model['fitPartition'];clean={k:v for k,v in model.items() if k!='fitPartition'}
    artifact=r.export(clean,model['config'],r.u.fit_calibration(None,None,'none'),[rows[i] for i in partition['trainIndices']],ph,seed)
    artifact['provenance'].update(availableTrainingIds=[q['id'] for q in rows],stoppingIds=partition['stoppingIds'],reservedMonitorIds=partition['reservedMonitorIds'])
    artifact['fitPartition']=partition;artifact['experiment']='early-l2-restore-best'
    return artifact
def save_fit(model,rows,ph,seed,path):
    artifact=export(model,rows,ph,seed);r.write(path,artifact)
    return {'seed':seed,'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':r.digest(path),'optimizer':model['optimizer'],'partition':model['fitPartition']}
def select(workers):
    if (OUT/'protocol.json').exists():raise RuntimeError('Frozen protocol exists.')
    OUT.mkdir(parents=True,exist_ok=True);FIX.mkdir(parents=True,exist_ok=True)
    parts,_,dh,eh=r.m.load_partitions(['train','validation']);rows,x,y=parts['train'];vr,xv,yv=parts['validation'];w=r.m.sample_weights(rows);core=np.flatnonzero(r.m.scoring_mask(rows));groups=np.array([q['groupId'] for q in rows]);folds=[]
    for aa,bb in r.t.group_folds(y[core],groups[core],20261108,count=4):
        tr=np.flatnonzero(np.isin(groups,groups[core[aa]]));va=np.flatnonzero(np.isin(groups,groups[core[bb]]));folds.append((tr,va))
    reference=r.read(ROOT/r.h.BASELINE);refval=r.m.r.expanded_metrics(yv,r.m.probabilities(reference,xv),reference['decisionThreshold']);cfgs=configs()
    protocol={'schemaVersion':1,'date':'2026-11-01','labelPolicy':'original-v1','labelsChanged':False,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'trainIds':[q['id'] for q in rows],'validationIds':[q['id'] for q in vr],
        'folds':[{'trainIds':[rows[i]['id'] for i in tr],'validationIds':[rows[i]['id'] for i in va]} for tr,va in folds],
        'configs':cfgs,'seeds':SEEDS,'exportSeed':7919,'workers':workers,'reference':r.h.BASELINE,'priorCompact':r.PRIOR,
        'sources':{'runner':r.digest(Path(__file__)),'trainer':r.digest(ROOT/'scripts/lib/meaning_structured.py')},
        'search':'24 positive-L2 settings plus3 zero-L2 controls; grouped4-fold CV at seed7919. Best2 positive settings per width and all3 zero controls repeat all3 seeds. No test-based tuning.',
        'stopping':'Every5 epochs observe grouped inner-monitor original meanings; unregularized joint NLL improvement >0.0001 resets patience15/30. Execute at least30 epochs, ceiling1000. Restore selected checkpoint even if ceiling is reached. No refit.',
        'L2':'Objective adds lambda/2 times squared hidden/output weights and global couplings; six unary biases and hidden biases unpenalized. Adam coupled L2, not AdamW.',
        'fixed':'512D text vectors only; tanh global-pair joint head; seeded random Glorot-style matrices; LR.003,batch64,clipnorm5; no dropout, calibration, thresholds, label or representation changes.',
        'selection':'Positive-L2 candidates only. Rank mean validation exact/F1/BCE; require mean+fixed-seed multi-metric reference margins for eligibility. Prefer smaller tensors within .005 exact/.005 F1/.003 BCE. If no candidate qualifies retain best experimental, explicitly ineligible; no registry activation.',
        'controls':'After selection, fixed selected width/lambda/patience; all4 early-stop/L2 combinations use identical inner fitting rows, held-out groups, seeds and initialization. No-stop fits execute1000 epochs. Control scores cannot select a replacement.',
        'curves':'Replay selected fixed epoch on exactly its fitting rows, observe reused validation for diagnostics only, verify parameter parity. Original monitor trace records actual stopping. No test curves.',
        'freshBlindConfirmation':False,'testUsedForSelection':False,'registryUpdated':False}
    r.write(OUT/'protocol.json',protocol);ph=r.digest(OUT/'protocol.json');setup(rows,x,y,w,core,folds);start=time.monotonic()
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=DATA) as pool:
        trials=[]
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in cfgs]),1):
            trials.append(q)
            if i%3==0:print('Search',i,'/27 bestCV',min(trials,key=rank)['cv']['exactMatch'],flush=True)
        finalists=[]
        for width in [32,128,1024]:finalists += [q['config'] for q in sorted([q for q in trials if q['config']['width']==width and q['config']['l2']>0],key=rank)[:2]]
        finalists += [c for c in cfgs if c['l2']==0]
        repeated=list(pool.map(cv_task,[(c,seed) for c in finalists for seed in SEEDS]));trials+=repeated
    r.write(OUT/'trials.json.gz',trials);records=[]
    for cfg in finalists:
        models=[]
        for seed in SEEDS:
            model=fit(rows,x,y,w,cfg,seed);saved=save_fit(model,rows,ph,seed,FIX/f"candidate-{cfg['trial']}-seed-{seed}.json.gz")
            tr=np.array(saved['partition']['trainIndices']);va=np.array(saved['partition']['monitorIndices']);original=r.m.scoring_mask([rows[i] for i in tr])
            saved.update(validation=score_model(model,xv,yv),training=score_model(model,x[tr][original],y[tr][original]),stopping=score_model(model,x[va],y[va]),
                cv=next(q['cv'] for q in repeated if q['config']['trial']==cfg['trial'] and q['seed']==seed))
            models.append(saved)
        mean=r.average([q['validation'] for q in models]);fixed=next(q for q in models if q['seed']==7919)['validation']
        gates={'mean':r.m.promotion_gate(mean,refval),'fixedSeed':r.m.promotion_gate(fixed,refval)}
        records.append({'id':f"trial-{cfg['trial']}",'config':cfg,'models':models,'validationMean':mean,'gates':gates,
            'validationEligible':cfg['l2']>0 and all(g['passed'] for g in gates.values()),'tensorCount':r.tensors(r.read(ROOT/models[0]['artifact']))})
        print('Finalist',cfg['trial'],'width',cfg['width'],'L2',cfg['l2'],'patience',cfg['patience'],'validation',mean['exactMatch'],'eligible',records[-1]['validationEligible'],flush=True)
    positives=[q for q in records if q['config']['l2']>0];eligible=[q for q in positives if q['validationEligible']];pool=eligible or positives
    order=lambda q:(*r.ordering(q['validationMean']),q['tensorCount'],q['id']);best=min(pool,key=order)
    near=[q for q in pool if q['validationMean']['exactMatch']>=best['validationMean']['exactMatch']-.005 and q['validationMean']['macroF1']>=best['validationMean']['macroF1']-.005 and q['validationMean']['bce']<=best['validationMean']['bce']+.003]
    chosen=min(near,key=lambda q:(q['tensorCount'],*r.ordering(q['validationMean']),q['id']));fixed=next(q for q in chosen['models'] if q['seed']==7919);selected=FIX/'classifier-experimental-selected.json.gz';selected.write_bytes((ROOT/fixed['artifact']).read_bytes())
    selection={'schemaVersion':1,'protocolFileSha256':ph,'datasetFileSha256':dh,'embeddingsFileSha256':eh,'primaryMetric':'exactMatch','configurationCount':len(cfgs),'cvRuns':len(trials),
        'decisionFrozenBeforeTest':True,'testUsedForSelection':False,'registryUpdated':False,'freshBlindConfirmation':False,'seeds':SEEDS,'exportSeed':7919,
        'selectedId':chosen['id'],'selectedArtifact':str(selected.relative_to(ROOT)),'selectedArtifactSha256':r.digest(selected),'selectedValidationEligible':chosen['validationEligible'],
        'selectedValidationMean':chosen['validationMean'],'finalists':records,'elapsedSeconds':time.monotonic()-start}
    r.write(OUT/'selection.json',selection);print({k:selection[k] for k in ['selectedId','selectedValidationEligible','selectedValidationMean','elapsedSeconds']},flush=True)
def control_task(task):
    cfg,seed,early=task;rows,x,y,w,core,folds=DATA;start=time.monotonic();model=fit(rows,x,y,w,cfg,seed,early=early)
    return model,time.monotonic()-start
def controls(workers):
    if (OUT/'controls.json').exists():raise RuntimeError('Controls already frozen.')
    sel=r.read(OUT/'selection.json');protocol=r.read(OUT/'protocol.json');assert sel['protocolFileSha256']==r.digest(OUT/'protocol.json')
    assert protocol['sources']['runner']==r.digest(Path(__file__)) and protocol['sources']['trainer']==r.digest(ROOT/'scripts/lib/meaning_structured.py')
    chosen=next(q for q in sel['finalists'] if q['id']==sel['selectedId']);cfg=chosen['config'];parts,*_=r.m.load_partitions(['train','validation']);rows,x,y=parts['train'];vr,xv,yv=parts['validation'];w=r.m.sample_weights(rows);core=np.flatnonzero(r.m.scoring_mask(rows));setup(rows,x,y,w,core,[])
    records={};tasks=[];keys=[]
    for label,l2,early in [('neither',0.,False),('l2-only',cfg['l2'],False),('early-only',0.,True),('early-and-l2',cfg['l2'],True)]:
        records[label]={'l2':l2,'earlyStopping':early,'models':[]}
        for seed in SEEDS:
            if label=='early-and-l2':records[label]['models'].append(next(q for q in chosen['models'] if q['seed']==seed));continue
            tasks.append(({**cfg,'l2':l2,'pairL2':l2},seed,early));keys.append((label,seed))
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=DATA) as pool:
        for (label,seed),(model,elapsed) in zip(keys,pool.map(control_task,tasks)):
            saved=save_fit(model,rows,sel['protocolFileSha256'],seed,FIX/f'control-{label}-seed-{seed}.json.gz');tr=np.array(saved['partition']['trainIndices']);va=np.array(saved['partition']['monitorIndices']);mask=r.m.scoring_mask([rows[i] for i in tr])
            saved.update(validation=score_model(model,xv,yv),training=score_model(model,x[tr][mask],y[tr][mask]),stopping=score_model(model,x[va],y[va]),elapsedSeconds=elapsed)
            records[label]['models'].append(saved);print('Control',label,seed,'epoch',model['optimizer']['selectedEpoch'],'validation',saved['validation']['exactMatch'],flush=True)
    for record in records.values():
        record['validationMean']=r.average([q['validation'] for q in record['models']]);record['trainingMean']=r.average([q['training'] for q in record['models']])
    r.write(OUT/'controls.json',{'selectionFileSha256':r.digest(OUT/'selection.json'),'protocolFileSha256':sel['protocolFileSha256'],'usedForSelection':False,'testUsed':False,'conditions':records})
def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Report already frozen.')
    sel=r.read(OUT/'selection.json');controls=r.read(OUT/'controls.json');p=r.read(OUT/'protocol.json')
    assert controls['selectionFileSha256']==r.digest(OUT/'selection.json') and sel['protocolFileSha256']==r.digest(OUT/'protocol.json')
    assert p['sources']['runner']==r.digest(Path(__file__)) and p['sources']['trainer']==r.digest(ROOT/'scripts/lib/meaning_structured.py')
    models={f'{name}-seed-{q["seed"]}':q for name,condition in controls['conditions'].items() for q in condition['models']}
    artifacts={k:r.read(ROOT/q['artifact']) for k,q in models.items()};prior=r.read(ROOT/'tests/fixtures/meaning-taxonomy/structured-heads/prior-compact.json.gz');reference=r.read(ROOT/r.h.BASELINE);cohorts={}
    for name,folder in [('original120','expanded-1000'),('other48','regularized-expansion')]:
        d=ROOT/f'tests/fixtures/meaning-taxonomy/{folder}';data=r.read(d/'dataset.json');embedded=r.read(d/'embeddings.json.gz');assert embedded['datasetFileSha256']==r.digest(d/'dataset.json');vectors={q['id']:q['vector'] for q in embedded['rows']};rows=[q for q in data['items'] if q['split']=='test'];x=np.array([vectors[q['id']] for q in rows]);y=np.array([q['targets'] for q in rows]);metrics={};predictions={}
        for key,a in {**artifacts,'prior-compact':prior}.items():
            assert not {q['id'] for q in rows}&(set(a['provenance']['trainIds'])|set(a['provenance'].get('stoppingIds',[])))
            joint=r.predict(a,x);metrics[key]=r.h.score(y,joint,'map');predictions[key]={'joint':joint.tolist(),'marginals':(joint@s.P).tolist()}
        baseline=r.m.r.expanded_metrics(y,r.m.probabilities(reference,x),reference['decisionThreshold']);means={label:r.average([metrics[f'{label}-seed-{seed}'] for seed in SEEDS]) for label in controls['conditions']}
        selected=metrics['early-and-l2-seed-7919'];cohorts[name]={'count':len(rows),'rows':[{'id':q['id'],'targets':q['targets']} for q in rows],'metrics':metrics,'conditionMeans':means,'predictions':predictions,'reference':baseline,
            'selectedRegressionGate':r.m.promotion_gate(selected,baseline),'targetMet':selected['exactMatch']>.9}
    assert cohorts['original120']['reference']['exactMatch']==.725
    r.write(OUT/'report.json',{'schemaVersion':1,'selectionFileSha256':r.digest(OUT/'selection.json'),'controlsFileSha256':r.digest(OUT/'controls.json'),'testUsedForSelection':False,'registryUpdated':False,'freshBlindConfirmation':False,
        'models':{**{key:{'artifact':q['artifact'],'artifactFileSha256':q['artifactFileSha256']} for key,q in models.items()},'prior-compact':{'artifact':'tests/fixtures/meaning-taxonomy/structured-heads/prior-compact.json.gz','artifactFileSha256':r.digest(ROOT/'tests/fixtures/meaning-taxonomy/structured-heads/prior-compact.json.gz')}},'cohorts':cohorts})
    print({name:{key:{k:round(v[k],4) for k in ['exactMatch','macroF1','microPrecision','microRecall','bce','jointNLL']} for key,v in c['conditionMeans'].items()} for name,c in cohorts.items()},flush=True)
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','controls','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('Positive workers required.')
    {'select':lambda:select(args.workers),'controls':lambda:controls(args.workers),'evaluate':evaluate}[args.phase]()

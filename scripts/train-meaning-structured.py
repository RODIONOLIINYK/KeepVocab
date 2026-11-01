#!/usr/bin/env python3
"""Structure-aware head search, matched capacity sweep and plot-ready traces.

Original labels/vectors/splits remain fixed. Model/decoder choices freeze before
the historically exposed tests. Learning curves never fit test/validation data.
"""
import argparse,concurrent.futures,gzip,importlib.util,json,multiprocessing,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
h=module('structured_experiment_metrics','scripts/train-meaning-joint-search.py')
s=module('structured_architecture_models','scripts/lib/meaning_structured.py')
u,j,np,t=s.u,s.j,s.np,s.t;m=h.m
OUT=ROOT/'docs/meaning-taxonomy-training/structured-heads';FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/structured-heads'
PRIOR='tests/fixtures/meaning-taxonomy/joint-tuning/classifier-experimental-selected.json.gz'
SEEDS=[7919,104729,130363];DATA=None
def read(p):return h.read(p)
def write(p,v):h.write(p,v)
def digest(p):return h.digest(p)
def average(values):return {**h.average(values),'perClass':{c:{'f1':float(np.mean([v['perClass'][c]['f1'] for v in values]))} for c in t.CATEGORIES}}
def ordering(metric):return(-metric['exactMatch'],-metric['macroF1'],metric['bce'])
def setup(rows,x,y,w,core,folds):
    global DATA
    DATA=rows,x,y,w,core,folds
def cv_task(task):
    cfg,seed=task;rows,x,y,w,core,folds=DATA;lookup={int(i):k for k,i in enumerate(core)}
    raw=np.zeros((len(core),64));assessed=np.zeros_like(raw);raw_margins=np.zeros((len(core),6));fits=[];decoders=[];covered=[]
    for fold,(tr,va) in enumerate(folds):
        model=s.fit_inner([rows[i] for i in tr],x[tr],y[tr],w[tr],cfg,seed,20261108+fold);inner=model['innerDecoder']
        ids=[int(i) for i in va if int(i) in lookup];dest=[lookup[i] for i in ids];raw[dest]=s.model_log_joint(model,x[ids]);covered+=ids
        cal=u.fit_calibration(inner['targets'],inner['logJoint'],'none' if cfg['family']=='svm' else 'unary',.1)
        assessed[dest]=u.calibrate(raw[dest],cal)
        if cfg['family']=='svm':raw_margins[dest]=s.svm_margins(model,x[ids])
        decoders.append({'ids':inner['ids'],'trainingIds':inner['trainingIds'],'outerIndices':dest,'calibration':cal,
            'svmPlatt':model.get('platt'),'targets':inner['targets'].tolist()})
        fits.append(model['optimizer'])
    assert sorted(covered)==sorted(core.tolist()) and len(covered)==len(set(covered))
    return {'config':cfg,'seed':seed,'cv':h.score(y[core],assessed,'map'),'rawCV':h.score(y[core],np.exp(raw),'map'),
        'optimizers':fits,'decoderFits':decoders,'oofLogJoint':raw.tolist(),'rawSVMMargins':raw_margins.tolist() if cfg['family']=='svm' else None}
def rank(q):return(*ordering(q['cv']),q['config']['trial'])
def make_configs():
    rng=np.random.default_rng(20261108);result=[]
    base={'width':32,'context':False,'residual':False,'freezeLinear':False,'activation':'tanh','l2':.001,'edgeL2':.1,'pairL2':.001,
        'preprocess':'standardize','pca':0,'whiten':False,'learningRate':.003,'batchSize':64,'maxEpochs':250,'patience':30}
    for l2 in [.001,.01]:
        for width in [8,16,32,64,128]:result.append({**base,'family':'neural-global','width':width,'l2':l2,'capacitySweep':True,'trial':len(result),'phase':'capacity-control'})
    for family,count in [('neural-global',18),('neural-context',20),('residual',16),('context-linear',16),('svm',16)]:
        for i in range(count):
            cfg={**base,'family':family,'width':int(rng.choice([8,16,32,64])),'activation':str(rng.choice(['tanh','relu'])),
                'l2':float(10**rng.uniform(-4,-.6)),'edgeL2':float(10**rng.uniform(-2,1)),
                'pairL2':float(10**rng.uniform(-4,-.5)),'learningRate':float(10**rng.uniform(-3.3,-2.1)),
                'preprocess':str(rng.choice(['standardize','scaled'])),'batchSize':int(rng.choice([64,128])),
                'context':family in ['neural-context','context-linear'],'residual':family=='residual',
                'freezeLinear':family=='residual' and i%2==0,'trial':len(result),'phase':'broad'}
            if family=='context-linear':cfg.update(width=0,pca=int(rng.choice([0,16,32,64,128])))
            if family=='svm':cfg.update(width=0,context=False,pca=int(rng.choice([0,32,128])),C=float(10**rng.uniform(-2,2)),gammaFactor=float(10**rng.uniform(-1.2,1.2)),balanced=bool(i%2))
            result.append(cfg)
    assert len(result)==96
    return result
def local_configs(trials,start):
    result=[];rng=np.random.default_rng(20261109)
    for family in ['neural-global','neural-context','residual','context-linear','svm']:
        parents=sorted([q for q in trials if q['config']['family']==family],key=rank)[:3]
        for i in range(8):
            c=dict(parents[i%3]['config']);c.pop('capacitySweep',None)
            for key in ['l2','edgeL2','pairL2']:c[key]=float(10**np.clip(np.log10(c[key])+rng.normal(0,.35),-5,1))
            if family=='svm':
                for key in ['C','gammaFactor']:c[key]=float(10**np.clip(np.log10(c[key])+rng.normal(0,.35),-3,3))
            else:c['learningRate']=float(10**np.clip(np.log10(c['learningRate'])+rng.normal(0,.2),-3.5,-1.8))
            c.update(trial=start+len(result),phase='local');result.append(c)
    return result
def fold_calibration(model,cal):
    if model['family']=='svm' or cal['method']=='none':return model,False
    params={k:v.copy() for k,v in model['params'].items()};cfg=model['config'];temp=cal['temperature']
    for k in ['outputWeight','outputBias','skipWeight','couplings']:
        if k in params:params[k]/=temp
    params['outputBias'][:6]+=np.array(cal['unaryOffsets'])
    if cfg['context']:params['outputBias'][6:]+=np.array(cal['pairOffsets'])
    else:params['couplings']+=np.array(cal['pairOffsets'])
    return {**model,'params':params},True
def export(model,cfg,cal,rows,ph,seed):
    cleaned={k:v for k,v in model.items() if k!='innerDecoder'};folded,flag=fold_calibration(cleaned,cal)
    return {'schemaVersion':1,'role':'experimental-structured-head','kind':'model','inputDimension':512,'categories':t.CATEGORIES,
        'model':s.serializable(folded),'configuration':cfg,'calibration':cal,'calibrationFolded':flag,'labelPolicy':'original-v1',
        'provenance':{'trainIds':[r['id'] for r in rows],'fitSeed':seed,'protocolFileSha256':ph,'testUsedForSelection':False,'productionActivated':False}}
def predict(artifact,x):
    if artifact['kind']=='prior-compact':
        old=artifact['priorArtifact'];return j.joint_probabilities(j.restore(old['model']),x)
    model=s.restore(artifact['model']);lp=s.model_log_joint(model,x)
    return np.exp(lp) if artifact['calibrationFolded'] else u.calibrate(lp,artifact['calibration'])
def tensors(a):
    if a['kind']=='prior-compact':return 4117
    model=a['model'];f=model['features'];count=2*len(f['mean'])
    if f['projection'] is not None:count+=len(f['projection'])*len(f['projection'][0])+len(f['projectScale'])
    if model['family']=='svm':count+=len(model['supportVectors'])*len(model['supportVectors'][0])+len(model['coefficients'])*6+6+12
    else:
        for value in model['params'].values():count+=int(np.asarray(value).size)
    return count
def public(q):return {k:v for k,v in q.items() if k not in ['oofLogJoint','rawSVMMargins']}
def optimizer_ok(opt):
    return (opt.get('success',True) and opt.get('allConverged',True) and opt.get('plattSuccess',True)
        and (not opt.get('warmStart') or opt['warmStart']['success'])
        and (not opt.get('innerStop') or optimizer_ok(opt['innerStop']))
        and (not opt.get('innerSVM') or optimizer_ok(opt['innerSVM'])))
def fit_ok(model):return optimizer_ok(model['optimizer']) and model.get('platt',{}).get('success',True)
def select(workers):
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen experiment exists.')
    OUT.mkdir(parents=True,exist_ok=True);FIXTURE.mkdir(parents=True,exist_ok=True)
    parts,_,dh,eh=m.load_partitions(['train','validation']);rows,x,y=parts['train'];vrows,xv,yv=parts['validation'];w=m.sample_weights(rows);core=np.flatnonzero(m.scoring_mask(rows));groups=np.array([r['groupId'] for r in rows]);folds=[]
    for aa,bb in t.group_folds(y[core],groups[core],20261108,count=4):
        tr=np.flatnonzero(np.isin(groups,groups[core[aa]]));va=np.flatnonzero(np.isin(groups,groups[core[bb]]));assert not set(groups[tr])&set(groups[va]);folds.append((tr,va))
    reference=read(ROOT/h.BASELINE);reference_val=m.r.expanded_metrics(yv,m.probabilities(reference,xv),reference['decisionThreshold']);configs=make_configs()
    protocol={'schemaVersion':1,'date':'2026-11-01','labelPolicy':'original-v1','primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'labelsChanged':False,
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'reference':h.BASELINE,'priorCompact':PRIOR,'priorCompactSha256':digest(ROOT/PRIOR),
        'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
        'folds':[{'trainIds':[rows[i]['id'] for i in tr],'validationIds':[rows[i]['id'] for i in va]} for tr,va in folds],
        'initialConfigs':configs,'localCount':40,'seeds':SEEDS,'exportSeed':7919,'workers':workers,
        'search':'96 broad/capacity controls +40 local. Two best per family and all10 capacity controls repeat three seeds with neural maxEpochs600 before tests.',
        'stopping':'Grouped inner monitor originals; select neural epochs by joint NLL then refit full training portion for fixed epochs. Linear CRFs converge by optimizer criteria, never monitor loss. No test-based stopping.',
        'calibration':'Neural/context heads: fixed inner-fit joint unary calibration penalty.1 for outer CV. Full fits compare none/unary on training OOF then validation. SVM: no internal probability CV; fit positive-slope Platt calibration on inner monitor margins, full calibration from training OOF margins only.',
        'features':'Weighted means/scales/PCA use current fitting rows only; no held-out covariates fit features. Support vectors belong to current fitting rows. No encoder/prompt/label changes.',
        'residualWarmStart':'Linear CRF fitted only within current fitting portion; never reuse full-data/frozen weights within a CV fold.',
        'selection':'Rank mean validation exact/F1/BCE among mean+fixed-seed noninferiority-qualified candidates; if none qualify retain best experimental and mark ineligible. Frozen prior compact CRF is eligible before tests. Prefer smaller tensors within .005 exact/.005 F1/.003 BCE.',
        'capacityAnalysis':'Fixed neural-global tanh sweep, widths8/16/32/64/128 at L2 .001/.01, same optimizer/batch settings, three seeds. Curves assess original meanings once, no augmented-score inflation.',
        'curves':'Inner learning curves are recorded during training. After selection, fixed-epoch full-data replay can observe reused validation for plotting only; verify parameter parity against the saved raw fit. No test curves or stopping changes.',
        'freshBlindConfirmation':False,'testUsedForSelection':False,'registryUpdated':False,
        'sources':{'runner':digest(Path(__file__)),'trainer':digest(ROOT/'scripts/lib/meaning_structured.py')},
        'research':[{'url':'https://arxiv.org/abs/2106.11959','use':'Residual/shared feature architecture motivation, not an exact reproduction or guarantee.'},
            {'url':'https://pmc.ncbi.nlm.nih.gov/articles/PMC4410807/','use':'Input-conditioned pairwise potentials; exact64-state inference here.'},
            {'url':'https://arxiv.org/abs/1812.11118','use':'Capacity can sometimes improve generalization beyond interpolation; no guarantee or evidence of that regime for this task.'},
            {'url':'https://scikit-learn.org/1.7/modules/generated/sklearn.svm.SVC.html','use':'Version-specific SVC fit/margin API; separate grouped calibration.'}]}
    write(OUT/'protocol.json',protocol);ph=digest(OUT/'protocol.json');start=time.monotonic();setup(rows,x,y,w,core,folds);trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=(rows,x,y,w,core,folds)) as pool:
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in configs]),1):
            trials.append(q)
            if i%8==0:print('Broad',i,'/96','bestExact',min(trials,key=rank)['cv']['exactMatch'],flush=True)
        local=local_configs(trials,len(configs));configs+=local
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in local]),1):
            trials.append(q)
            if i%8==0:print('Local',i,'/40','bestExact',min(trials,key=rank)['cv']['exactMatch'],flush=True)
        finals=[]
        for family in ['neural-global','neural-context','residual','context-linear','svm']:
            finals+=[q['config'] for q in sorted([q for q in trials if q['config']['family']==family],key=rank)[:2]]
        for c in configs[:10]:
            if c['trial'] not in [z['trial'] for z in finals]:finals.append(c)
        finals=[{**c,'searchMaxEpochs':c['maxEpochs'],'maxEpochs':600,'phase':'confirmation'} for c in finals]
        repeated=list(pool.map(cv_task,[(c,seed) for c in finals for seed in SEEDS]));trials+=repeated
    write(OUT/'trials.json.gz',[public(q) for q in trials]);write(OUT/'finalist-oof.json.gz',{'ids':[rows[i]['id'] for i in core],'runs':[{'trial':q['config']['trial'],'seed':q['seed'],'logJoint':q['oofLogJoint'],'rawSVMMargins':q['rawSVMMargins']} for q in repeated]})
    records=[]
    for cfg in finals:
        fitseeds=[]
        for seed in SEEDS:
            run=next(q for q in repeated if q['config']['trial']==cfg['trial'] and q['seed']==seed);model=s.fit_inner(rows,x,y,w,cfg,seed)
            if cfg['family']=='svm':model['platt']=s.fit_platt(np.array(run['rawSVMMargins']),y[core])
            comparisons={}
            for mode in (['none'] if cfg['family']=='svm' else ['none','unary']):
                cal=u.fit_calibration(y[core],np.array(run['oofLogJoint']),mode,.1);artifact=export(model,cfg,cal,rows,ph,seed)
                comparisons[mode]={'validation':h.score(yv,predict(artifact,xv),'map'),'calibration':cal}
            fitseeds.append({'seed':seed,'model':model,'comparisons':comparisons,'cv':run['cv'],
                'trainRaw':h.score(y[core],np.exp(s.model_log_joint(model,x[core])),'map'),
                'validationRaw':h.score(yv,np.exp(s.model_log_joint(model,xv)),'map')})
        means={mode:average([q['comparisons'][mode]['validation'] for q in fitseeds]) for mode in fitseeds[0]['comparisons']}
        valid=[]
        for mode,mean in means.items():
            fixed=next(q for q in fitseeds if q['seed']==7919)['comparisons'][mode]['validation']
            cv_ok=all(optimizer_ok(opt) for q in repeated if q['config']['trial']==cfg['trial'] for opt in q['optimizers'])
            cal_ok=all(q['comparisons'][mode]['calibration'].get('optimizerSuccess',True) for q in fitseeds)
            if cv_ok and cal_ok and all(fit_ok(q['model']) for q in fitseeds) and m.promotion_gate(mean,reference_val)['passed'] and m.promotion_gate(fixed,reference_val)['passed']:valid.append(mode)
        mode=min(valid or list(means),key=lambda k:(*ordering(means[k]),k!='none'));saved=[]
        for q in fitseeds:
            artifact=export(q['model'],cfg,q['comparisons'][mode]['calibration'],rows,ph,q['seed']);path=FIXTURE/f"candidate-{cfg['trial']}-seed-{q['seed']}.json.gz";write(path,artifact)
            saved.append({'seed':q['seed'],'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':q['comparisons'][mode]['validation'],
                'cv':q['cv'],'trainRaw':q['trainRaw'],'validationRaw':q['validationRaw'],'optimizer':q['model']['optimizer']})
        records.append({'id':f"trial-{cfg['trial']}",'config':cfg,'models':saved,'calibrationChoice':mode,'calibrationComparisons':means,
            'validationMean':means[mode],'validationEligible':bool(valid),'tensorCount':tensors(read(ROOT/saved[0]['artifact']))})
        print('Finalist',cfg['trial'],cfg['family'],'width',cfg['width'],'context',cfg['context'],'valExact',means[mode]['exactMatch'],'eligible',bool(valid),flush=True)
    prior=read(ROOT/PRIOR);artifact={'schemaVersion':1,'role':'experimental-structured-head','kind':'prior-compact','inputDimension':512,'categories':t.CATEGORIES,
        'priorArtifact':prior,'provenance':{'trainIds':prior['provenance']['trainIds'],'protocolFileSha256':ph,'fitSeed':7919,'testUsedForSelection':False}}
    path=FIXTURE/'prior-compact.json.gz';write(path,artifact);metric=h.score(yv,predict(artifact,xv),'map')
    records.append({'id':'prior-compact','config':{'family':'prior-compact'},'models':[{'seed':7919,'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':metric}],
        'validationMean':metric,'validationEligible':m.promotion_gate(metric,reference_val)['passed'],'tensorCount':tensors(artifact)})
    order=lambda q:(*ordering(q['validationMean']),q['tensorCount'],q['id']);eligible=[q for q in records if q['validationEligible']];best=min(eligible or records,key=order)
    near=[q for q in (eligible or records) if q['validationMean']['exactMatch']>=best['validationMean']['exactMatch']-.005 and q['validationMean']['macroF1']>=best['validationMean']['macroF1']-.005 and q['validationMean']['bce']<=best['validationMean']['bce']+.003]
    selected=min(near,key=lambda q:(q['tensorCount'],*ordering(q['validationMean']),q['id']));fixed=next(q for q in selected['models'] if q['seed']==7919)
    candidate=FIXTURE/'classifier-experimental-selected.json.gz';candidate.write_bytes((ROOT/fixed['artifact']).read_bytes())
    best_neural=min([q for q in records if q['config']['family'] in ['neural-global','neural-context','residual']],key=order)
    selection={'schemaVersion':1,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'protocolFileSha256':ph,'datasetFileSha256':dh,'embeddingsFileSha256':eh,
        'decisionFrozenBeforeTest':True,'testUsedForSelection':False,'freshBlindConfirmation':False,'registryUpdated':False,'configurationCount':len(configs),'cvRuns':len(trials),
        'seeds':SEEDS,'exportSeed':7919,'finalists':records,'selectedId':selected['id'],'selectedArtifact':str(candidate.relative_to(ROOT)),'selectedArtifactSha256':digest(candidate),
        'selectedValidationMean':selected['validationMean'],'selectedValidationEligible':selected['validationEligible'],'bestNewId':min([q for q in records if q['id']!='prior-compact'],key=order)['id'],
        'bestNeuralCurveId':best_neural['id'],'elapsedSeconds':time.monotonic()-start,'freshIndependentConfirmationRequired':True}
    write(OUT/'selection.json',selection);print(json.dumps({k:selection[k] for k in ['configurationCount','cvRuns','selectedId','selectedValidationMean','bestNewId','bestNeuralCurveId','elapsedSeconds']},indent=2),flush=True)
def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Fixed regression report exists.')
    selection=read(OUT/'selection.json');p=read(OUT/'protocol.json');assert selection['protocolFileSha256']==digest(OUT/'protocol.json')
    assert p['sources']['runner']==digest(Path(__file__)) and p['sources']['trainer']==digest(ROOT/'scripts/lib/meaning_structured.py')
    paths={'selected':selection['selectedArtifact']}
    for family in ['neural-global','neural-context','residual','context-linear','svm']:
        q=min([q for q in selection['finalists'] if q['config']['family']==family],key=lambda q:(*ordering(q['validationMean']),q['id']))
        paths[family]=next(z['artifact'] for z in q['models'] if z['seed']==7919)
    paths['prior-compact']=next(q['models'][0]['artifact'] for q in selection['finalists'] if q['id']=='prior-compact');models={k:read(ROOT/v) for k,v in paths.items()};reference=read(ROOT/h.BASELINE);cohorts={}
    for name,folder in [('original120','expanded-1000'),('other48','regularized-expansion')]:
        directory=ROOT/f'tests/fixtures/meaning-taxonomy/{folder}';data=read(directory/'dataset.json');encoded=read(directory/'embeddings.json.gz');assert encoded['datasetFileSha256']==digest(directory/'dataset.json')
        vecs={q['id']:q['vector'] for q in encoded['rows']};rows=[q for q in data['items'] if q['split']=='test'];x=np.array([vecs[q['id']] for q in rows]);y=np.array([q['targets'] for q in rows]);results={};probs={}
        for k,artifact in models.items():
            assert not {q['id'] for q in rows}&set(artifact['provenance']['trainIds']);joint=predict(artifact,x);probs[k]=joint;results[k]=h.score(y,joint,'map')
        baseline=m.r.expanded_metrics(y,m.probabilities(reference,x),reference['decisionThreshold'])
        cohorts[name]={'count':len(rows),'metrics':results,'reference':baseline,'selectedRegressionGate':m.promotion_gate(results['selected'],baseline),
            'selectedVsCompactGate':m.promotion_gate(results['selected'],results['prior-compact']),'targetMet':results['selected']['exactMatch']>.9,
            'rows':[{'id':q['id'],'targets':q['targets']} for q in rows],'predictions':{k:{'joint':v.tolist(),'marginals':(v@j.PATTERNS).tolist()} for k,v in probs.items()}}
    assert cohorts['original120']['reference']['exactMatch']==.725
    report={'schemaVersion':1,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'selectionFileSha256':digest(OUT/'selection.json'),'testUsedForSelection':False,'freshBlindConfirmation':False,'registryUpdated':False,
        'models':{k:{'artifact':v,'artifactFileSha256':digest(ROOT/v)} for k,v in paths.items()},'cohorts':cohorts,'targetMetOnBothRegressionCohorts':all(q['targetMet'] for q in cohorts.values()),
        'limitations':['Historically exposed CV/validation/tests, adaptive search; no fresh independent generalization proof.','Fixed labels/features, no post-test model/threshold/epoch/seed selection.','No phone battery/latency claim; six probabilities retained.']}
    write(OUT/'report.json',report);print(json.dumps({name:{k:{z:round(v[z],4) for z in ['exactMatch','macroF1','microPrecision','microRecall']} for k,v in q['metrics'].items()} for name,q in cohorts.items()},indent=2),flush=True)
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('workers must be positive')
    select(args.workers) if args.phase=='select' else evaluate()

#!/usr/bin/env python3
"""Original-policy, matched BatchNorm experiment; retired tests are checks only.

Never changes labels, mixes policies or tunes against either test cohort.
Selection and evaluation are separate, immutable phases. No automatic promotion:
even favorable regression checks require fresh independent confirmation.
"""
import argparse
import concurrent.futures
import gzip
import importlib.util
import json
import multiprocessing
from pathlib import Path
import platform
import time

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
m=module('normalization_metrics','scripts/train-meaning-regularization.py')
b=module('normalization_fit','scripts/lib/meaning_batchnorm.py')
np,t=m.np,m.t
OUT=ROOT/'docs/meaning-taxonomy-training/normalization-original'
FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/normalization-original'
BASELINE='tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json'
SEEDS=[7919,104729,130363];DATA=None
def read(p):return json.loads(p.read_bytes())
def write(p,v):t.write_json(p,v)
def digest(p):return t.digest(p.read_bytes())
def setup(rows,x,y,w,folds,core):
    global DATA
    DATA=rows,x,y,w,folds,core
def fit(rows,x,y,w,cfg,seed,fold=0):
    if cfg['optimizer']=='lbfgs':return m.reg.fit(x,y,cfg,seed=seed,sample_weight=w)
    return b.fit_with_inner_stop(rows,x,y,w,cfg,seed,20261103+fold)
def cv_task(task):
    cfg,seed=task;rows,x,y,w,folds,core=DATA
    lookup={int(ix):i for i,ix in enumerate(core)};p=np.zeros((len(core),6));opts=[];covered=[]
    for fold,(tr,va) in enumerate(folds):
        fitted=fit([rows[i] for i in tr],x[tr],y[tr],w[tr],cfg,seed,fold)
        ids=[int(i) for i in va if int(i) in lookup]
        p[[lookup[i] for i in ids]]=t.predict(fitted,x[ids]);covered+=ids;opts.append(fitted['optimizer'])
    assert sorted(covered)==sorted(core.tolist()) and len(covered)==len(set(covered))
    return {'config':cfg,'seed':seed,'cv':m.best_threshold(y[core],p),'optimizers':opts,'oof':p.tolist()}
def rank(q):return(-q['cv']['macroF1'],-q['cv']['exactMatch'],q['cv']['bce'],q['config']['trial'])
def average(metrics):
    keys=['macroF1','exactMatch','microPrecision','microRecall','bce','brier','microF1','macroAveragePrecision']
    return {**{k:float(np.mean([q[k] for q in metrics])) for k in keys},
        'macroF1StandardDeviation':float(np.std([q['macroF1'] for q in metrics],ddof=1)),
        'exactMatchStandardDeviation':float(np.std([q['exactMatch'] for q in metrics],ddof=1)),
        'perClass':{c:{'f1':float(np.mean([q['perClass'][c]['f1'] for q in metrics]))} for c in t.CATEGORIES}}
def strip(q):return {k:v for k,v in q.items() if k!='oof'}
def calibration(yy,p):
    # Fix one method for every candidate; no validation calibration selection.
    cal=m.d.fit_calibration(yy,p,'temperature-global-bias')
    threshold=m.best_threshold(yy,m.d.calibrate(p,cal))['threshold']
    return cal,threshold
def configs(baseline):
    rng=np.random.default_rng(20261103);result=[]
    fixed={k:baseline['hyperparameters'][k] for k in ['hidden','preprocess','center','l2','weightPower']}
    result.append({**fixed,'l1':0.,'optimizer':'lbfgs','batchNorm':False,'maxIterations':3000,'trial':0,'phase':'baseline-recipe'})
    for hidden in [0,32]:
        for i in range(8 if hidden==0 else 7):
            result.append({'hidden':hidden,'preprocess':str(rng.choice(['standardize','scaled'])),'center':True,
                'l1':0.,'l2':float(10**rng.uniform(-5,-.7)),'weightPower':float(rng.uniform(0,.8)),
                'optimizer':'lbfgs','batchNorm':False,'maxIterations':3000,'trial':len(result),'phase':'lbfgs-broad'})
    for pair in range(24):
        cfg={'hidden':[16,32,64][pair%3],'preprocess':['standardize','scaled'][pair%2],'center':True,
            'l1':0.,'l2':float(10**rng.uniform(-5,-1.4)),'weightPower':float(rng.uniform(0,.8)),
            'optimizer':'adam','learningRate':float(10**rng.uniform(-3.3,-2)),
            'batchSize':[16,32,64,128][(pair//2)%4],'maxEpochs':300,'minEpochs':30,'patience':30,
            'minDelta':.0001,'epsilon':1e-5,'momentum':.1,'pair':pair,'phase':'adam-broad'}
        for enabled in [False,True]:result.append({**cfg,'batchNorm':enabled,'trial':len(result)})
    return result

def select(workers):
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen outputs already exist.')
    OUT.mkdir(parents=True,exist_ok=True);FIXTURE.mkdir(parents=True,exist_ok=True)
    parts,encoded,dh,eh=m.load_partitions(['train','validation'])
    rows,x,y=parts['train'];vrows,xv,yv=parts['validation'];w=m.sample_weights(rows)
    m.validate_group_contract(rows);core=np.flatnonzero(m.scoring_mask(rows));groups=np.array([r['groupId'] for r in rows]);folds=[]
    for aa,bb in t.group_folds(y[core],groups[core],20261103,count=4):
        tr=np.flatnonzero(np.isin(groups,groups[core[aa]]));va=np.flatnonzero(np.isin(groups,groups[core[bb]]))
        assert not set(groups[tr])&set(groups[va]);folds.append((tr,va))
    baseline=read(ROOT/BASELINE);cfgs=configs(baseline)
    protocol={'schemaVersion':1,'date':'2026-11-01','labelPolicy':'original-v1','userSelectedOriginalPolicy':True,
        'labelsChanged':False,'datasetFileSha256':dh,'embeddingsFileSha256':eh,'baseline':BASELINE,'baselineSha256':digest(ROOT/BASELINE),
        'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
        'trainingRows':len(rows),'scoredOriginalMeanings':len(core),'validationRows':len(vrows),
        'foldSeed':20261103,'seeds':SEEDS,'exportSeed':7919,'workers':workers,
        'folds':[{'trainIds':[rows[i]['id'] for i in a],'validationIds':[rows[i]['id'] for i in z]} for a,z in folds],
        'initialConfigurations':cfgs,'localPairs':6,
        'search':'16 L-BFGS-B controls/random configurations + 24 exact Adam plain/BN pairs; then 6 local pairs. 76 total configurations. No dropout.',
        'normalization':'BN between first dense and tanh; uniform training mini-batch moments, EMA momentum .1, unbiased running variance, epsilon1e-5. BCE row weights preserve paraphrase-family mass. Gamma/beta and dense biases have no L2. Fixed inference statistics folded into first dense.',
        'earlyStopping':'Five-fold grouped inner split within each training portion; monitor original meanings only, select epoch by BCE, refit entire portion for fixed epoch. No outer-fold/validation/test stopping.',
        'selection':'Top two Adam configs per normalization plus their exact matched partners, best L-BFGS linear/MLP and fixed baseline recipe repeat three seeds. Rank mean validation macroF1, then exact match then BCE. Prefer linear within all predeclared equivalence margins. Fixed seed7919 exported.',
        'calibration':'Global temperature/bias and global threshold fitted only on original-meaning OOF training predictions for each candidate. No per-class tuning and no test tuning.',
        'margins':{'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05},
        'testCohorts':['retired-original-120-v1','retired-new-48-v1'],'freshBlindConfirmation':False,
        'promotion':'No automatic registry promotion. Retired test gains require fresh independent confirmation. Original-policy baseline is the default reference.',
        'sourceFiles':{'runner':digest(Path(__file__)),'trainer':digest(ROOT/'scripts/lib/meaning_batchnorm.py')},
        'environment':{'python':platform.python_version(),'numpy':np.__version__,'machine':platform.machine()}}
    write(OUT/'protocol.json',protocol);ph=digest(OUT/'protocol.json');started=time.monotonic();setup(rows,x,y,w,folds,core)
    trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=(rows,x,y,w,folds,core)) as pool:
        for i,q in enumerate(pool.map(cv_task,[(c,SEEDS[0]) for c in cfgs]),1):
            trials.append(q)
            if i%8==0:print('Broad',i,'/64','lastF1',round(q['cv']['macroF1'],4),flush=True)
        write(OUT/'broad-trials.json',[strip(q) for q in trials])
        adam=sorted([q for q in trials if q['config']['optimizer']=='adam'],key=rank);parents=[]
        for q in adam:
            if q['config']['pair'] not in [p['config']['pair'] for p in parents]:parents.append(q)
            if len(parents)==4:break
        rng=np.random.default_rng(20261104);local=[]
        for j in range(6):
            parent=parents[j%len(parents)]['config']
            c={**parent,'l2':float(10**np.clip(np.log10(parent['l2'])+rng.normal(0,.35),-6,-.7)),
                'learningRate':float(10**np.clip(np.log10(parent['learningRate'])+rng.normal(0,.2),-3.5,-1.8)),
                'weightPower':float(np.clip(parent['weightPower']+rng.normal(0,.1),0,1)),
                'pair':24+j,'phase':'adam-local'}
            for enabled in [False,True]:local.append({**c,'batchNorm':enabled,'trial':len(cfgs)+len(local)})
        cfgs+=local
        for i,q in enumerate(pool.map(cv_task,[(c,SEEDS[0]) for c in local]),1):
            trials.append(q)
            if i%4==0:print('Local',i,'/12',flush=True)
        finalists=[]
        for enabled in [False,True]:
            top=sorted([q for q in trials if q['config']['optimizer']=='adam' and q['config']['batchNorm']==enabled],key=rank)[:2]
            for q in top:
                for cfg in cfgs:
                    if cfg.get('pair')==q['config']['pair'] and cfg['trial'] not in [c['trial'] for c in finalists]:finalists.append(cfg)
        for hidden in [0,32]:
            q=min([q for q in trials if q['config']['optimizer']=='lbfgs' and q['config']['hidden']==hidden],key=rank)
            if q['config']['trial'] not in [c['trial'] for c in finalists]:finalists.append(q['config'])
        if 0 not in [c['trial'] for c in finalists]:finalists.append(cfgs[0])
        repeated=list(pool.map(cv_task,[(c,seed) for c in finalists for seed in SEEDS[1:]]))
        trials+=repeated
    write(OUT/'trials.json',[strip(q) for q in trials])
    oof={'ids':[rows[i]['id'] for i in core],'runs':[{'trial':q['config']['trial'],'seed':q['seed'],'probabilities':q['oof']} for q in trials]}
    (OUT/'oof-predictions.json.gz').write_bytes(gzip.compress(json.dumps(oof,separators=(',',':')).encode(),compresslevel=9,mtime=0))
    records=[];yy=y[core]
    for cfg in finalists:
        runs=[q for q in trials if q['config']['trial']==cfg['trial']];assert sorted(q['seed'] for q in runs)==sorted(SEEDS)
        seeds=[]
        for q in runs:
            seed=q['seed'];p=np.array(q['oof']);cal,threshold=calibration(yy,p)
            fitted=fit(rows,x,y,w,cfg,seed)
            artifact=m.export_model(fitted,cfg,threshold,cal,encoded,{'annotationPolicyVersion':'original-v1','protocolFileSha256':ph,
                'datasetFileSha256':dh,'embeddingsFileSha256':eh,'trainIds':[r['id'] for r in rows],
                'testUsedForSelection':False,'legacyEvaluationUsedForSelection':False,'fitSeed':seed,'freshConfirmationRequired':True})
            artifact['normalization']=fitted.get('normalization',{'type':'none','foldedIntoDense':False})
            path=FIXTURE/f"candidate-{cfg['trial']}-seed-{seed}.json";write(path,artifact)
            val=m.r.expanded_metrics(yv,m.probabilities(artifact,xv),threshold)
            seeds.append({'seed':seed,'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),
                'validation':val,'cv':m.r.expanded_metrics(yy,m.d.calibrate(p,cal),threshold),
                'train':m.r.expanded_metrics(yy,m.probabilities(artifact,x[core]),threshold),'optimizer':fitted['optimizer']})
        records.append({'config':cfg,'models':seeds,'validationMean':average([z['validation'] for z in seeds]),'cvMean':average([z['cv'] for z in seeds])})
        print('Finalist',cfg['trial'],cfg['optimizer'],'BN',cfg['batchNorm'],'valF1',round(records[-1]['validationMean']['macroF1'],4),flush=True)
    ordering=lambda q:(-q['validationMean']['macroF1'],-q['validationMean']['exactMatch'],q['validationMean']['bce'],q['config']['trial'])
    best=min(records,key=ordering);linear=min([r for r in records if r['config']['hidden']==0],key=ordering)
    equivalent=m.equivalent_linear(linear['validationMean'],best['validationMean'])
    chosen=linear if equivalent['passed'] else best
    artifact=next(q for q in chosen['models'] if q['seed']==SEEDS[0]);selected=FIXTURE/'classifier-experimental-selected.json'
    selected.write_bytes((ROOT/artifact['artifact']).read_bytes())
    baseline_metrics=m.r.expanded_metrics(yv,m.probabilities(baseline,xv),baseline['decisionThreshold'])
    basecv=next(r for r in records if r['config']['trial']==0)['cvMean']
    gate=m.promotion_gate(chosen['validationMean'],baseline_metrics)
    pairs=[]
    for pair in range(30):
        plain=next(q for q in trials if q['seed']==SEEDS[0] and q['config'].get('pair')==pair and not q['config']['batchNorm'])
        norm=next(q for q in trials if q['seed']==SEEDS[0] and q['config'].get('pair')==pair and q['config']['batchNorm'])
        pairs.append({'pair':pair,'plainTrial':plain['config']['trial'],'batchNormTrial':norm['config']['trial'],
            'macroF1Delta':norm['cv']['macroF1']-plain['cv']['macroF1'],'exactMatchDelta':norm['cv']['exactMatch']-plain['cv']['exactMatch'],
            'bceDelta':norm['cv']['bce']-plain['cv']['bce']})
    summary={'pairs':pairs,'batchNormF1Wins':sum(q['macroF1Delta']>0 for q in pairs),
        'meanF1Delta':float(np.mean([q['macroF1Delta'] for q in pairs])),
        'medianF1Delta':float(np.median([q['macroF1Delta'] for q in pairs])),
        'adaptiveLocalSearch':True,'interpretation':'Descriptive matched-config results, not independent statistical evidence; shared folds and adaptive local search.'}
    selection={'schemaVersion':1,'labelPolicy':'original-v1','labelsChanged':False,'protocolFileSha256':ph,
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'baseline':BASELINE,'baselineSha256':digest(ROOT/BASELINE),
        'decisionFrozenBeforeTest':True,'testUsedForSelection':False,'freshBlindConfirmation':False,
        'configurationCount':len(cfgs),'cvRuns':len(trials),'seeds':SEEDS,'exportSeed':SEEDS[0],
        'finalists':records,'selectedTrial':chosen['config']['trial'],
        'selectedArtifact':str(selected.relative_to(ROOT)),'selectedArtifactSha256':digest(selected),
        'linearPracticalEquivalence':equivalent,'baselineValidation':baseline_metrics,'baselineRecipeCV':basecv,
        'selectedValidationGate':gate,'selectedCVDeltaMacroF1':chosen['cvMean']['macroF1']-basecv['macroF1'],
        'matchedBatchNorm':summary,'elapsedSeconds':time.monotonic()-started,
        'promotion':'Experimental only. No registry changes; fresh confirmation required.'}
    write(OUT/'selection.json',selection)
    print(json.dumps({k:selection[k] for k in ['configurationCount','cvRuns','selectedTrial','selectedCVDeltaMacroF1','elapsedSeconds']},indent=2),flush=True)

def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Retired-test evaluation already exists; no repeated test tuning.')
    selection=read(OUT/'selection.json');protocol=read(OUT/'protocol.json')
    assert selection['protocolFileSha256']==digest(OUT/'protocol.json')
    assert protocol['sourceFiles']['runner']==digest(Path(__file__))
    assert selection['decisionFrozenBeforeTest'] and not selection['testUsedForSelection']
    paths={'previous72_5':selection['baseline'],'experimentalSelected':selection['selectedArtifact']}
    for kind in ['batchnorm','plain','linear']:
        pool=[q for q in selection['finalists'] if ((q['config']['hidden']==0) if kind=='linear' else q['config']['optimizer']=='adam' and q['config']['batchNorm']==(kind=='batchnorm'))]
        best=min(pool,key=lambda q:(-q['validationMean']['macroF1'],-q['validationMean']['exactMatch'],q['validationMean']['bce'],q['config']['trial']))
        paths[kind]=next(q['artifact'] for q in best['models'] if q['seed']==SEEDS[0])
    paths['v2HeadForHistoricalDiagnosis']='tests/fixtures/meaning-taxonomy/policy-v2/classifier-selected.json'
    models={k:read(ROOT/p) for k,p in paths.items()}
    assert digest(ROOT/selection['selectedArtifact'])==selection['selectedArtifactSha256']
    cohorts={}
    for name,fixture in [('retired-original-120-v1',ROOT/'tests/fixtures/meaning-taxonomy/expanded-1000'),('retired-new-48-v1',m.FIXTURE)]:
        data=read(fixture/'dataset.json');encoded=json.loads(gzip.decompress((fixture/'embeddings.json.gz').read_bytes()))
        assert encoded['datasetFileSha256']==digest(fixture/'dataset.json')
        vs={r['id']:r['vector'] for r in encoded['rows']};rows=[r for r in data['items'] if r['split']=='test']
        x=np.array([vs[r['id']] for r in rows]);y=np.array([r['targets'] for r in rows]);ids={r['id'] for r in rows}
        train=read(m.FIXTURE/'dataset.json');train_rows=[r for r in train['items'] if r['split']=='train']
        assert not ids&{r['id'] for r in train_rows}
        assert not {r['groupId'] for r in rows}&{r['groupId'] for r in train_rows}
        for a in models.values():assert not ids&set(a['provenance']['trainIds'])
        probabilities={k:m.probabilities(a,x) for k,a in models.items()}
        metrics={k:m.r.expanded_metrics(y,probabilities[k],a['decisionThreshold']) for k,a in models.items()}
        cohorts[name]={'count':len(rows),'datasetFileSha256':digest(fixture/'dataset.json'),'metrics':metrics,
            'selectedRegressionGate':m.promotion_gate(metrics['experimentalSelected'],metrics['previous72_5']),
            'predictions':[{'id':r['id'],'word':r['word'],'targets':r['targets'],'probabilities':{k:p[i].tolist() for k,p in probabilities.items()}} for i,r in enumerate(rows)]}
    assert cohorts['retired-original-120-v1']['metrics']['previous72_5']['exactMatch']==.725
    report={'schemaVersion':1,'labelPolicy':'original-v1','selectionFileSha256':digest(OUT/'selection.json'),
        'protocolFileSha256':digest(OUT/'protocol.json'),'testUsedForSelection':False,'freshBlindConfirmation':False,
        'models':{k:{'artifact':p,'artifactFileSha256':digest(ROOT/p)} for k,p in paths.items()},'cohorts':cohorts,
        'registryUpdated':False,'productionPersonalizerChanged':False,'freshIndependentConfirmationRequired':True,
        'limitations':['Both test cohorts and validation have historical exposure. These are regression checks, not new blind evidence.',
            'The adaptive search reuses grouped folds; winning CV/validation scores are selection-biased.',
            'No labels changed. Original-v1 semantics differ from v2; scores cannot measure universal linguistic truth.']}
    write(OUT/'report.json',report)
    print(json.dumps({name:{k:{z:v[z] for z in ['exactMatch','macroF1','microPrecision','microRecall','bce']} for k,v in c['metrics'].items()} for name,c in cohorts.items()},indent=2),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('--workers must be positive')
    if args.phase=='select':select(args.workers)
    else:evaluate()

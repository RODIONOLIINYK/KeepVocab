#!/usr/bin/env python3
"""Original-policy architecture search targeting >90% exact label-set accuracy.

All search/calibration/thresholds use training OOF and reused validation only.
Two previously exposed tests are fixed regression checks after frozen selection.
No data relabeling, dropout, test tuning, or automatic classifier promotion.
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
    spec=importlib.util.spec_from_file_location(name,ROOT/path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
m=module('exact_search_metrics','scripts/train-meaning-regularization.py')
a=module('exact_search_architectures','scripts/lib/meaning_architectures.py')
np,t=m.np,m.t
OUT=ROOT/'docs/meaning-taxonomy-training/exact-accuracy-search'
FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/exact-accuracy-search'
SEEDS=[7919,104729,130363];DATA=None
BASELINE='tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json'
def read(p):return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
def write(p,v):
    if p.suffix=='.gz':p.write_bytes(gzip.compress(json.dumps(v,separators=(',',':')).encode(),compresslevel=9,mtime=0))
    else:t.write_json(p,v)
def digest(p):return t.digest(p.read_bytes())
def metrics(y,p,thresholds):
    # Existing probability metrics are retained; confusion counts use declared decoder.
    value=m.r.expanded_metrics(y,p,.5);thresholds=np.asarray(thresholds)
    threshold_description=thresholds.tolist() if thresholds.ndim<2 else 'row-specific thresholds fitted on training-inner monitors'
    thresholds=np.broadcast_to(thresholds,p.shape)
    predicted=p>=thresholds;truth=y.astype(bool)
    per={};tp=fp=fn=0
    for k,c in enumerate(t.CATEGORIES):
        hit=int(np.sum(predicted[:,k]&truth[:,k]));extra=int(np.sum(predicted[:,k]&~truth[:,k]));miss=int(np.sum(~predicted[:,k]&truth[:,k]))
        precision=hit/max(1,hit+extra);recall=hit/max(1,hit+miss)
        per[c]={**value['perClass'][c],'tp':hit,'fp':extra,'fn':miss,'predictedPositive':hit+extra,
                'precision':precision,'recall':recall,'f1':2*hit/max(1,2*hit+extra+miss)}
        tp+=hit;fp+=extra;fn+=miss
    value.update(perClass=per,thresholds=threshold_description,exactMatch=float(np.all(predicted==truth,axis=1).mean()),
        macroF1=float(np.mean([v['f1'] for v in per.values()])),macroPrecision=float(np.mean([v['precision'] for v in per.values()])),
        macroRecall=float(np.mean([v['recall'] for v in per.values()])),microPrecision=tp/max(1,tp+fp),microRecall=tp/max(1,tp+fn),
        microF1=2*tp/max(1,2*tp+fp+fn),hammingAccuracy=1-(fp+fn)/y.size,tp=tp,fp=fp,fn=fn)
    value.pop('threshold',None);return value
def threshold_key(y,p,thresholds):
    pred=p>=thresholds;truth=y.astype(bool);tp=(pred&truth).sum(axis=0);fp=(pred&~truth).sum(axis=0);fn=(~pred&truth).sum(axis=0)
    f1=np.divide(2*tp,2*tp+fp+fn,out=np.zeros(6),where=(2*tp+fp+fn)>0).mean()
    return (-float(np.all(pred==truth,axis=1).mean()),-float(f1),float(np.mean((np.asarray(thresholds)-.5)**2)))
def thresholds(y,p,mode):
    grid=np.linspace(.2,.8,31)
    global_t=min(grid,key=lambda z:threshold_key(y,p,np.full(6,z)));chosen=np.full(6,global_t)
    if mode=='per-class':
        # Fixed two coordinate passes; training OOF only, no test/validation adjustment.
        for _ in range(2):
            for k in range(6):
                options=[]
                for z in grid:
                    trial=chosen.copy();trial[k]=z;options.append(trial)
                chosen=min(options,key=lambda z:threshold_key(y,p,z))
    return chosen
def setup(rows,x,y,w,folds,core):
    global DATA
    DATA=rows,x,y,w,folds,core
def cv_task(task):
    cfg,seed=task;rows,x,y,w,folds,core=DATA;lookup={int(v):i for i,v in enumerate(core)};p=np.zeros((len(core),6));opts=[];covered=[]
    assessed=np.zeros_like(p);decoder_thresholds={mode:np.zeros_like(p) for mode in ['global','per-class']};decoder_data=[]
    for fold,(tr,va) in enumerate(folds):
        fitted=a.fit([rows[i] for i in tr],x[tr],y[tr],w[tr],cfg,seed,20261104+fold)
        ids=[int(i) for i in va if int(i) in lookup];dest=[lookup[i] for i in ids]
        p[dest]=a.probabilities(fitted,x[ids]);covered+=ids
        inner=fitted['decoderData'];cal=m.d.fit_calibration(inner['targets'],inner['probabilities'],'temperature-global-bias')
        innerp=m.d.calibrate(inner['probabilities'],cal);assessed[dest]=m.d.calibrate(p[dest],cal)
        for mode in decoder_thresholds:decoder_thresholds[mode][dest]=thresholds(inner['targets'],innerp,mode)
        decoder_data.append({'ids':inner['ids'],'trainingIds':inner['trainingIds'],'targets':inner['targets'].tolist(),
            'probabilities':innerp.tolist(),'outerIndices':dest,'calibration':cal})
        opts.append(fitted['optimizer'])
    assert sorted(covered)==sorted(core.tolist()) and len(covered)==len(set(covered))
    assert np.isfinite(p).all() and np.all((p>=0)&(p<=1+1e-12))
    nested={mode:metrics(y[core],assessed,th) for mode,th in decoder_thresholds.items()}
    return {'config':cfg,'seed':seed,'cv':nested['global'],'nestedCV':nested,'optimizers':opts,'oof':p.tolist(),
        'outerCalibrated':assessed.tolist(),'foldDecoderData':decoder_data,
        'assessment':'Outer folds untouched by calibration or decoder fitting; decoder fits training-inner monitor only.'}
def rank(q):return(-q['cv']['exactMatch'],-q['cv']['macroF1'],q['cv']['bce'],q['config']['trial'])
def family(cfg):
    return cfg['family'] if cfg['family']!='mlp' else ('deep-' if len(cfg['widths'])>1 else 'shallow-')+cfg['activation']
def average(values):
    keys=['exactMatch','macroF1','microPrecision','microRecall','bce','brier']
    return {**{k:float(np.mean([v[k] for v in values])) for k in keys},
        'exactMatchStandardDeviation':float(np.std([v['exactMatch'] for v in values],ddof=1)),
        'perClass':{c:{'f1':float(np.mean([v['perClass'][c]['f1'] for v in values]))} for c in t.CATEGORIES}}
def public(q):return {k:v for k,v in q.items() if k not in ['oof','outerCalibrated','foldDecoderData']}
def configurations():
    rng=np.random.default_rng(20261104);cfgs=[]
    widths=[[16],[32],[64],[128],[256],[32,16],[64,32],[128,32],[128,64],[64,32,16],[128,64,32],[256,64]]
    for kind,count in [('mlp',72),('powerset',24)]:
        for i in range(count):
            cfg={'family':kind,'widths':widths[i%len(widths)],'activation':['tanh','relu','silu'][(i//len(widths))%3],
                'preprocess':['standardize','scaled'][i%2],'l2':float(10**rng.uniform(-5,-1.2)),
                'weightPower':float(rng.uniform(0,.8)),'smoothing':[0.,.02,.05][i%3],
                'focalGamma':([0.,0.,1.,2.][(i//3)%4] if kind=='mlp' else 0.),
                'learningRate':float(10**rng.uniform(-3.5,-2.1)),'batchSize':[32,64,128][(i//2)%3],
                'maxEpochs':250,'minEpochs':30,'patience':30,'minDelta':.0001,'schedule':['constant','cosine'][i%2],
                'trial':len(cfgs),'phase':'broad'}
            cfgs.append(cfg)
    for _ in range(24):
        cfgs.append({'family':'rbf','centers':int(rng.choice([64,128,256,512])),
            'gamma':float(10**rng.uniform(-.3,1.8)),'l2':float(10**rng.uniform(-5,-.5)),
            'weightPower':float(rng.uniform(0,.8)),'trial':len(cfgs),'phase':'broad'})
    for k in [3,5,9,15]:
        for temp in [10,30,70]:cfgs.append({'family':'knn','neighbors':k,'temperature':temp,'trial':len(cfgs),'phase':'broad'})
    return cfgs
def local_configurations(trials,stage,start):
    rng=np.random.default_rng(20261104+stage);result=[]
    for kind,count in [('mlp',18),('powerset',6),('rbf',12)]:
        parents=sorted([q for q in trials if q['config']['family']==kind],key=rank)[:4]
        for i in range(count):
            cfg=dict(parents[i%len(parents)]['config']);cfg['l2']=float(10**np.clip(np.log10(cfg['l2'])+rng.normal(0,.5/stage),-6,-.3))
            cfg['weightPower']=float(np.clip(cfg['weightPower']+rng.normal(0,.12/stage),0,1))
            if kind=='rbf':cfg['gamma']=float(10**np.clip(np.log10(cfg['gamma'])+rng.normal(0,.25/stage),-.6,2))
            else:
                cfg['learningRate']=float(10**np.clip(np.log10(cfg['learningRate'])+rng.normal(0,.25/stage),-3.8,-1.8))
                cfg['maxEpochs']=350
            cfg.update(trial=start+len(result),phase=f'local-{stage}');result.append(cfg)
    return result
def export_model(model,cfg,cal,th,rows,ph,seed):
    return {'schemaVersion':1,'role':'experimental-meaning-architecture','categories':t.CATEGORIES,'inputDimension':512,
        'labelPolicy':'original-v1','configuration':cfg,'model':a.serializable({k:v for k,v in model.items() if k!='decoderData'}),'calibration':cal,'thresholds':th.tolist(),
        'provenance':{'trainIds':[r['id'] for r in rows],'fitSeed':seed,'protocolFileSha256':ph,'testUsedForSelection':False,'productionActivated':False}}
def artifact_probabilities(artifact,x):
    if artifact['model']['family']=='ensemble':
        return np.mean([artifact_probabilities(member,x) for member in artifact['model']['members']],axis=0)
    return m.d.calibrate(a.probabilities(a.restore(artifact['model']),x),artifact['calibration'])
def select(workers):
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen experiment already exists.')
    OUT.mkdir(parents=True,exist_ok=True);FIXTURE.mkdir(parents=True,exist_ok=True)
    parts,encoded,dh,eh=m.load_partitions(['train','validation']);rows,x,y=parts['train'];vrows,xv,yv=parts['validation']
    w=m.sample_weights(rows);core=np.flatnonzero(m.scoring_mask(rows));groups=np.array([r['groupId'] for r in rows]);folds=[]
    for aa,bb in t.group_folds(y[core],groups[core],20261104,count=4):
        tr=np.flatnonzero(np.isin(groups,groups[core[aa]]));va=np.flatnonzero(np.isin(groups,groups[core[bb]]))
        assert not set(groups[tr])&set(groups[va]);folds.append((tr,va))
    cfgs=configurations();protocol={'schemaVersion':1,'date':'2026-11-01','target':'>0.90 exact label-set accuracy: every membership correct per meaning',
        'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'labelPolicy':'original-v1','labelsChanged':False,'dropout':False,'batchNorm':False,
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'baseline':BASELINE,'baselineSha256':digest(ROOT/BASELINE),
        'trainingRows':len(rows),'originalTrainingMeanings':len(core),'validationCount':len(vrows),
        'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
        'folds':[{'trainIds':[rows[i]['id'] for i in tr],'validationIds':[rows[i]['id'] for i in va]} for tr,va in folds],
        'initialConfigurations':cfgs,'localStages':2,'localConfigurationsPerStage':36,'fitSeeds':SEEDS,'exportSeed':7919,
        'search':'132 broad configurations, 36 local, then 36 narrower local. Four grouped folds. Best per family plus top three overall repeat three seeds. No seed selection.',
        'stopping':'Within each outer training portion, select epoch on separate grouped inner monitor originals, then refit entire training portion. No outer/validation/test early stopping.',
        'finalistBudget':'Before tests, repeat finalist MLPs with maxEpochs700 to check budget; use this fixed final budget for all finalist seeds. Search budgets remain in history.',
        'calibration':'For CV assessment, fit calibration/thresholds on a separate training-inner monitor, never outer-fold targets. For full final fits, calibrate/threshold on original-meaning OOF only. Two coordinate passes over fixed .2..8 grid for per-class thresholds.',
        'selection':'Rank three-seed mean reused-validation exact match, then macro F1 and BCE; calibration/threshold variants compared before test. Ensembles of top three family finalists or three seeds of best family are also eligible before test. No automatic registry update.',
        'independentProbabilitiesRetained':True,'powerset':'Softmax across all64 fixed label sets; return six marginal membership probabilities. No top-class collapse and no MAP-set decoding.',
        'tests':['retired-original-120-v1','retired-new-48-v1'],'freshBlindConfirmation':False,
        'testUse':'One regression evaluation after selection freezes. No test-target tuning or changing labels to match predictions.',
        'historical89_94':'Three-seed mean micro precision on reused48 validation, dropout0 L2.0106707, exact69.44%; not 89.94% exact accuracy.',
        'sources':{'runner':digest(Path(__file__)),'trainer':digest(ROOT/'scripts/lib/meaning_architectures.py')},
        'environment':{'python':platform.python_version(),'numpy':np.__version__,'machine':platform.machine()},'workers':workers}
    write(OUT/'protocol.json',protocol);ph=digest(OUT/'protocol.json');start=time.monotonic();setup(rows,x,y,w,folds,core);trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=(rows,x,y,w,folds,core)) as pool:
        for i,q in enumerate(pool.map(cv_task,[(c,SEEDS[0]) for c in cfgs]),1):
            trials.append(q)
            if i%12==0:print('Broad',i,'/132','bestExact',round(min(trials,key=rank)['cv']['exactMatch'],4),flush=True)
        for stage in [1,2]:
            new=local_configurations(trials,stage,len(cfgs));cfgs+=new
            for i,q in enumerate(pool.map(cv_task,[(c,SEEDS[0]) for c in new]),1):
                trials.append(q)
                if i%12==0:print('Local',stage,i,'/36','bestExact',round(min(trials,key=rank)['cv']['exactMatch'],4),flush=True)
        families=sorted({family(q['config']) for q in trials});final=[]
        for f in families:final.append(min([q for q in trials if family(q['config'])==f],key=rank)['config'])
        for q in sorted(trials,key=rank)[:3]:
            if q['config']['trial'] not in [c['trial'] for c in final]:final.append(q['config'])
        final=[{**c,'searchMaxEpochs':c.get('maxEpochs'),'maxEpochs':700,'phase':'confirmation'} if c['family'] in ['mlp','powerset'] else {**c,'phase':'confirmation'} for c in final]
        repeated=list(pool.map(cv_task,[(c,seed) for c in final for seed in SEEDS]));trials+=repeated
    write(OUT/'trials.json.gz',[public(q) for q in trials]);write(OUT/'oof-predictions.json.gz',{'ids':[rows[i]['id'] for i in core],'runs':[{'trial':q['config']['trial'],'phase':q['config']['phase'],'seed':q['seed'],'probabilities':q['oof'],'outerCalibrated':q['outerCalibrated'],'foldDecoderData':q['foldDecoderData']} for q in trials]})
    records=[];seed_cache={};yy=y[core]
    for cfg in final:
        runs=[q for q in repeated if q['config']['trial']==cfg['trial']];seeds=[]
        for q in runs:
            seed=q['seed'];p=np.array(q['oof']);cal=m.d.fit_calibration(yy,p,'temperature-global-bias');cp=m.d.calibrate(p,cal)
            model=a.fit(rows,x,y,w,cfg,seed,20261104);vp=m.d.calibrate(a.probabilities(model,xv),cal);variants={}
            for decoder in ['global','per-class']:
                th=thresholds(yy,cp,decoder);variants[decoder]={'thresholds':th.tolist(),'validation':metrics(yv,vp,th),
                    'cv':q['nestedCV'][decoder],'oofTuning':metrics(yy,cp,th)}
            seeds.append({'seed':seed,'variants':variants,'optimizer':model['optimizer'],
                'train':metrics(yy,m.d.calibrate(a.probabilities(model,x[core]),cal),np.array(variants['global']['thresholds']))})
            seed_cache[(cfg['trial'],seed)]={'model':model,'cal':cal,'oof':cp,'val':vp,'config':cfg,'run':q}
        means={mode:average([z['variants'][mode]['validation'] for z in seeds]) for mode in ['global','per-class']}
        decoder=min(means,key=lambda k:(-means[k]['exactMatch'],-means[k]['macroF1'],means[k]['bce'],k!='global'))
        artifacts=[]
        for seed in SEEDS:
            cache=seed_cache[(cfg['trial'],seed)];q=next(z for z in seeds if z['seed']==seed)
            th=np.array(q['variants'][decoder]['thresholds']);artifact=export_model(cache['model'],cfg,cache['cal'],th,rows,ph,seed)
            path=FIXTURE/f"candidate-{cfg['trial']}-seed-{seed}.json.gz";write(path,artifact)
            artifacts.append({**q,'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':q['variants'][decoder]['validation'],'cv':q['variants'][decoder]['cv']})
        records.append({'id':f"trial-{cfg['trial']}",'config':cfg,'family':family(cfg),'decoder':decoder,'validationMean':means[decoder],
            'decoderComparisons':means,'cvMean':average([z['cv'] for z in artifacts]),'models':artifacts})
        print('Finalist',cfg['trial'],family(cfg),'widths',cfg.get('widths'),'decoder',decoder,'valExact',round(means[decoder]['exactMatch'],4),flush=True)
    ordering=lambda r:(-r['validationMean']['exactMatch'],-r['validationMean']['macroF1'],r['validationMean']['bce'],r['id'])
    members=[];seen=set()
    for r in sorted(records,key=ordering):
        if r['family'] not in seen:members.append(r);seen.add(r['family'])
        if len(members)==3:break
    best=min(records,key=ordering)
    ensembles=[('three-families',[(r,SEEDS[0]) for r in members]),('three-seeds',[(best,seed) for seed in SEEDS])]
    for name,parts in ensembles:
        p=np.mean([seed_cache[(r['config']['trial'],seed)]['oof'] for r,seed in parts],axis=0)
        vp=np.mean([seed_cache[(r['config']['trial'],seed)]['val'] for r,seed in parts],axis=0)
        variants={mode:{'thresholds':thresholds(yy,p,mode).tolist()} for mode in ['global','per-class']}
        runs=[seed_cache[(r['config']['trial'],seed)]['run'] for r,seed in parts]
        outerp=np.mean([np.array(q['outerCalibrated']) for q in runs],axis=0)
        nested_thresholds={mode:np.zeros_like(outerp) for mode in variants}
        for fold in range(4):
            decoders=[q['foldDecoderData'][fold] for q in runs]
            assert all(z['ids']==decoders[0]['ids'] and z['outerIndices']==decoders[0]['outerIndices'] for z in decoders)
            ip=np.mean([np.array(z['probabilities']) for z in decoders],axis=0);iy=np.array(decoders[0]['targets'])
            for mode in variants:nested_thresholds[mode][decoders[0]['outerIndices']]=thresholds(iy,ip,mode)
        for mode,z in variants.items():
            z['validation']=metrics(yv,vp,np.array(z['thresholds']));z['cv']=metrics(yy,outerp,nested_thresholds[mode]);z['oofTuning']=metrics(yy,p,np.array(z['thresholds']))
        decoder=min(variants,key=lambda k:(-variants[k]['validation']['exactMatch'],-variants[k]['validation']['macroF1'],variants[k]['validation']['bce'],k!='global'))
        item=variants[decoder];models=[read(ROOT/next(q['artifact'] for q in r['models'] if q['seed']==seed)) for r,seed in parts]
        artifact={'schemaVersion':1,'role':'experimental-meaning-architecture','categories':t.CATEGORIES,'inputDimension':512,'labelPolicy':'original-v1',
            'configuration':{'family':'ensemble','name':name},'model':{'family':'ensemble','members':models},'thresholds':item['thresholds'],
            'calibration':{'method':'none'},'provenance':{'trainIds':[r['id'] for r in rows],'protocolFileSha256':ph,'testUsedForSelection':False,'productionActivated':False}}
        path=FIXTURE/f'ensemble-{name}.json.gz';write(path,artifact)
        records.append({'id':name,'family':'ensemble','config':artifact['configuration'],'decoder':decoder,'validationMean':item['validation'],
            'cvMean':item['cv'],'decoderComparisons':variants,'models':[{'seed':7919,'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':item['validation'],'cv':item['cv']}]})
    chosen=min(records,key=ordering);fixed=next(z for z in chosen['models'] if z['seed']==SEEDS[0]);path=FIXTURE/'classifier-experimental-selected.json.gz';path.write_bytes((ROOT/fixed['artifact']).read_bytes())
    selection={'schemaVersion':1,'target':protocol['target'],'targetMetric':'exactMatch','decisionFrozenBeforeTest':True,'testUsedForSelection':False,
        'protocolFileSha256':ph,'datasetFileSha256':dh,'embeddingsFileSha256':eh,'configurationCount':len(cfgs),'cvRuns':len(trials),
        'seeds':SEEDS,'exportSeed':7919,'finalists':records,'selectedId':chosen['id'],'selectedFamily':chosen['family'],
        'selectedArtifact':str(path.relative_to(ROOT)),'selectedArtifactSha256':digest(path),'selectedValidationMean':chosen['validationMean'],
        'selectedCVMean':chosen['cvMean'],'validationTargetMet':chosen['validationMean']['exactMatch']>.9,
        'cvTargetMet':chosen['cvMean']['exactMatch']>.9,'registryUpdated':False,'freshIndependentConfirmationRequired':True,
        'baseline':BASELINE,'baselineSha256':digest(ROOT/BASELINE),'elapsedSeconds':time.monotonic()-start,
        'limitation':'CV/validation used for adaptive selection. No >90% generalization claim without fresh independent confirmation.'}
    write(OUT/'selection.json',selection);print(json.dumps({k:selection[k] for k in ['configurationCount','cvRuns','selectedId','selectedFamily','selectedValidationMean','selectedCVMean','elapsedSeconds']},indent=2),flush=True)

def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Fixed test evaluation already exists.')
    s=read(OUT/'selection.json');p=read(OUT/'protocol.json')
    assert s['protocolFileSha256']==digest(OUT/'protocol.json') and p['sources']['runner']==digest(Path(__file__)) and p['sources']['trainer']==digest(ROOT/'scripts/lib/meaning_architectures.py')
    assert s['decisionFrozenBeforeTest'] and not s['testUsedForSelection']
    paths={'selected':s['selectedArtifact']}
    for f in sorted({r['family'] for r in s['finalists']}):
        q=min([r for r in s['finalists'] if r['family']==f],key=lambda r:(-r['validationMean']['exactMatch'],-r['validationMean']['macroF1'],r['validationMean']['bce'],r['id']))
        paths[f]=next(z['artifact'] for z in q['models'] if z['seed']==SEEDS[0])
    models={k:read(ROOT/v) for k,v in paths.items()};baseline=read(ROOT/BASELINE)
    original89=read(ROOT/'tests/fixtures/meaning-taxonomy/dropout/classifier-candidate.json')
    cohorts={}
    for name,fixture in [('retired-original-120-v1',ROOT/'tests/fixtures/meaning-taxonomy/expanded-1000'),('retired-new-48-v1',m.FIXTURE)]:
        data=read(fixture/'dataset.json');encoded=read(fixture/'embeddings.json.gz');assert encoded['datasetFileSha256']==digest(fixture/'dataset.json')
        vs={r['id']:r['vector'] for r in encoded['rows']};rows=[r for r in data['items'] if r['split']=='test'];ids={r['id'] for r in rows}
        x=np.array([vs[r['id']] for r in rows]);y=np.array([r['targets'] for r in rows]);probs={};results={}
        for k,model in models.items():
            assert not ids&set(model['provenance']['trainIds']);pp=artifact_probabilities(model,x);probs[k]=pp;results[k]=metrics(y,pp,np.array(model['thresholds']))
        for k,model in [('previous72_5',baseline),('historical89_94PrecisionRun',original89)]:
            assert not ids&set(model['provenance']['trainIds']);pp=m.probabilities(model,x);probs[k]=pp;results[k]=metrics(y,pp,np.full(6,model['decisionThreshold']))
        cohorts[name]={'count':len(rows),'datasetFileSha256':digest(fixture/'dataset.json'),'metrics':results,
            'selectedTargetMet':results['selected']['exactMatch']>.9,'selectedRegressionGate':m.promotion_gate(results['selected'],results['previous72_5']),
            'predictions':[{'id':r['id'],'word':r['word'],'targets':r['targets'],'probabilities':{k:pp[i].tolist() for k,pp in probs.items()}} for i,r in enumerate(rows)]}
    assert cohorts['retired-original-120-v1']['metrics']['previous72_5']['exactMatch']==.725
    report={'schemaVersion':1,'targetMetric':'exactMatch','targetStrictlyGreaterThan':.9,'labelPolicy':'original-v1','labelsChanged':False,
        'selectionFileSha256':digest(OUT/'selection.json'),'protocolFileSha256':digest(OUT/'protocol.json'),
        'testUsedForSelection':False,'freshBlindConfirmation':False,'registryUpdated':False,'productionActivated':False,
        'targetMetOnBothRegressionCohorts':all(c['selectedTargetMet'] for c in cohorts.values()),
        'models':{k:{'artifact':v,'artifactFileSha256':digest(ROOT/v)} for k,v in paths.items()},
        'frozenComparators':{'previous72_5':BASELINE,'historical89_94PrecisionRun':'tests/fixtures/meaning-taxonomy/dropout/classifier-candidate.json'},
        'cohorts':cohorts,'freshIndependentConfirmationRequired':True,
        'limitations':['Reused CV/validation and historically exposed tests do not establish fresh generalization.',
            'Hamming accuracy and precision are not exact label-set accuracy. No score above90 in a different metric satisfies this target.',
            'No post-test candidate reselection, new thresholds or label corrections. No guarantee any tested architecture will reach90 exact accuracy.']}
    write(OUT/'report.json',report)
    print(json.dumps({name:{k:{z:v[z] for z in ['exactMatch','macroF1','microPrecision','microRecall']} for k,v in c['metrics'].items()} for name,c in cohorts.items()},indent=2),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('--workers must be positive')
    if args.phase=='select':select(args.workers)
    else:evaluate()

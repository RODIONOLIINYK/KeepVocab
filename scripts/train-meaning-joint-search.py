#!/usr/bin/env python3
"""Research follow-up: probabilistic chains, pairwise CRFs, exact joint MAP.

Original labels remain frozen. Retired tests are opened once after selection.
Six probability outputs remain available even when a joint MAP set is scored.
"""
import argparse
import concurrent.futures
import gzip
import importlib.util
import json
import multiprocessing
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    s=importlib.util.spec_from_file_location(name,ROOT/path);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
m=module('joint_metrics','scripts/train-meaning-regularization.py');j=module('joint_models','scripts/lib/meaning_joint.py')
np,t=m.np,m.t
OUT=ROOT/'docs/meaning-taxonomy-training/joint-label-search';FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/joint-label-search'
PRIOR=ROOT/'docs/meaning-taxonomy-training/exact-accuracy-search/selection.json'
BASELINE='tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json'
SEEDS=[7919,104729,130363];DATA=None
def read(p):return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
def write(p,v):
    if p.suffix=='.gz':p.write_bytes(gzip.compress(json.dumps(v,separators=(',',':')).encode(),compresslevel=9,mtime=0))
    else:t.write_json(p,v)
def digest(p):return t.digest(p.read_bytes())
def score(y,joint,decoder):
    p=joint@j.PATTERNS;pred=j.PATTERNS[joint.argmax(axis=1)].astype(bool) if decoder=='map' else p>=.5
    value=m.r.expanded_metrics(y,p,.5);tp=fp=fn=0;per={}
    for k,c in enumerate(t.CATEGORIES):
        hit=int(np.sum(pred[:,k]&(y[:,k]==1)));extra=int(np.sum(pred[:,k]&(y[:,k]==0)));miss=int(np.sum(~pred[:,k]&(y[:,k]==1)))
        per[c]={**value['perClass'][c],'tp':hit,'fp':extra,'fn':miss,'predictedPositive':hit+extra,
            'precision':hit/max(1,hit+extra),'recall':hit/max(1,hit+miss),'f1':2*hit/max(1,2*hit+extra+miss)}
        tp+=hit;fp+=extra;fn+=miss
    codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
    value.update(exactMatch=float(np.all(pred==y,axis=1).mean()),macroF1=float(np.mean([v['f1'] for v in per.values()])),
        macroPrecision=float(np.mean([v['precision'] for v in per.values()])),macroRecall=float(np.mean([v['recall'] for v in per.values()])),
        microPrecision=tp/max(1,tp+fp),microRecall=tp/max(1,tp+fn),microF1=2*tp/max(1,2*tp+fp+fn),
        hammingAccuracy=1-(fp+fn)/y.size,tp=tp,fp=fp,fn=fn,perClass=per,decoder=decoder,
        jointNLL=float(-np.mean(np.log(np.clip(joint[np.arange(len(y)),codes],1e-12,1)))))
    value.pop('threshold',None);return value
def average(values):
    return {**{k:float(np.mean([v[k] for v in values])) for k in ['exactMatch','macroF1','microPrecision','microRecall','bce','brier','jointNLL']},
        'exactMatchStandardDeviation':float(np.std([v['exactMatch'] for v in values],ddof=1))}
def setup(rows,x,y,w,core,folds):
    global DATA
    DATA=rows,x,y,w,core,folds
def cv_task(task):
    cfg,seed=task;rows,x,y,w,core,folds=DATA;lookup={int(ix):i for i,ix in enumerate(core)};joint=np.zeros((len(core),64));opts=[];covered=[]
    for tr,va in folds:
        model=j.fit([rows[i] for i in tr],x[tr],y[tr],w[tr],cfg,seed)
        ids=[int(i) for i in va if int(i) in lookup];joint[[lookup[i] for i in ids]]=j.joint_probabilities(model,x[ids]);covered+=ids;opts.append(model['optimizer'])
    assert sorted(covered)==sorted(core.tolist());assert len(covered)==len(set(covered));np.testing.assert_allclose(joint.sum(axis=1),1,atol=1e-12)
    return {'config':cfg,'seed':seed,'cv':{d:score(y[core],joint,d) for d in ['map','marginal']},'optimizers':opts,'joint':joint.tolist()}
def rank(q):return(-q['cv']['map']['exactMatch'],-q['cv']['map']['macroF1'],q['cv']['map']['jointNLL'],q['config']['trial'])
def make_configs():
    rng=np.random.default_rng(20261105);cfgs=[]
    for family in ['crf','pcc']:
        for i in range(24):
            cfgs.append({'family':family,'features':'linear' if i%2==0 else 'rbf','preprocess':'standardize' if i%3 else 'scaled',
                'centers':int(rng.choice([128,256])),'gamma':float(10**rng.uniform(-.2,1.4)),
                'l2':float(10**rng.uniform(-5,-1)),'linkL2':float(10**rng.uniform(-4,-.3)),
                'coupled':True,'labelScale':float(rng.choice([.5,1,2,4])),
                'order':rng.permutation(6).tolist(),'trial':len(cfgs),'phase':'broad'})
    return cfgs
def artifact_joint(artifact,x):
    if artifact['model']['family']=='prior-powerset':
        model=j.a.restore(artifact['model']['raw']);xx=(x-model['mean'])/model['scale']
        return j.a.softmax(j.a.forward(model['layers'],xx,model['activation'])[0][-1])
    return j.joint_probabilities(j.restore(artifact['model']),x)
def export(model,cfg,decoder,rows,ph,seed):
    return {'schemaVersion':1,'role':'experimental-joint-meaning-classifier','inputDimension':512,'categories':t.CATEGORIES,'labelPolicy':'original-v1',
        'model':j.a.serializable(model),'configuration':cfg,'decoder':decoder,'probabilityOutput':'six marginals plus optional64 joint probabilities',
        'provenance':{'trainIds':[r['id'] for r in rows],'protocolFileSha256':ph,'fitSeed':seed,'testUsedForSelection':False,'productionActivated':False}}
def select(workers):
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen outputs already exist.')
    OUT.mkdir(parents=True,exist_ok=True);FIXTURE.mkdir(parents=True,exist_ok=True)
    parts,_,dh,eh=m.load_partitions(['train','validation']);rows,x,y=parts['train'];vrows,xv,yv=parts['validation'];w=m.sample_weights(rows);core=np.flatnonzero(m.scoring_mask(rows));groups=np.array([r['groupId'] for r in rows]);folds=[]
    for aa,bb in t.group_folds(y[core],groups[core],20261105,count=4):
        tr=np.flatnonzero(np.isin(groups,groups[core[aa]]));va=np.flatnonzero(np.isin(groups,groups[core[bb]]));assert not set(groups[tr])&set(groups[va]);folds.append((tr,va))
    cfgs=make_configs();p={'schemaVersion':1,'date':'2026-11-01','target':'>90% exact label-set accuracy','primaryMetric':'exactMatch','labelPolicy':'original-v1','labelsChanged':False,
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'baseline':BASELINE,'baselineSha256':digest(ROOT/BASELINE),
        'sources':{'runner':digest(Path(__file__)),'trainer':digest(ROOT/'scripts/lib/meaning_joint.py'),'priorSelection':digest(PRIOR)},
        'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
        'folds':[{'trainIds':[rows[i]['id'] for i in tr],'validationIds':[rows[i]['id'] for i in va]} for tr,va in folds],
        'initialConfigs':cfgs,'localConfigs':24,'matchedIndependentControls':6,'seeds':SEEDS,'exportSeed':7919,
        'search':'48 broad +24 local joint models +6 matched independent CRF controls. Best two per joint family and matched controls repeat three seeds.',
        'optimization':'Exact joint NLL for pairwise CRF, logistic conditional NLL for PCC, family weights, weight-only L2; L-BFGS-B cap2500. No dropout, early stopping or test calibration.',
        'decoding':'Compare exact MAP over all64 label sets with marginal>=.5, before tests. Always retain full six marginal probabilities. No threshold fitting.',
        'selection':'Rank three-seed mean validation exact accuracy, then macro F1 and joint NLL. Prior three powerset finalists also compare MAP/marginal with unchanged weights. Fixed seed7919 exported.',
        'freshBlindConfirmation':False,'testUsedForSelection':False,'registryUpdated':False,
        'research':[{'url':'https://icml.cc/Conferences/2010/papers/589.pdf','use':'PCC and subset-zero-one MAP rule; no promised90% score.'},
            {'url':'https://pmc.ncbi.nlm.nih.gov/articles/PMC4410807/','use':'Pairwise label-dependency model motivation. This experiment uses exact likelihood, not that paper\'s pseudolikelihood structure learner.'},
            {'url':'https://www.nature.com/articles/s41586-024-08328-6','use':'TabPFN considered as small-data reference; not benchmarked or integrated in this run.'}]}
    write(OUT/'protocol.json',p);ph=digest(OUT/'protocol.json');start=time.monotonic();setup(rows,x,y,w,core,folds);trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=(rows,x,y,w,core,folds)) as pool:
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in cfgs]),1):
            trials.append(q)
            if i%8==0:print('Broad',i,'/48','bestMAP',min(trials,key=rank)['cv']['map']['exactMatch'],flush=True)
        rng=np.random.default_rng(20261106);local=[]
        for family in ['crf','pcc']:
            parents=sorted([q for q in trials if q['config']['family']==family],key=rank)[:3]
            for i in range(12):
                c=dict(parents[i%3]['config']);c['l2']=float(10**np.clip(np.log10(c['l2'])+rng.normal(0,.5),-6,-.4));c['linkL2']=float(10**np.clip(np.log10(c['linkL2'])+rng.normal(0,.5),-5,.5))
                if c['features']=='rbf':c['gamma']=float(10**np.clip(np.log10(c['gamma'])+rng.normal(0,.25),-.6,1.8))
                c.update(trial=len(cfgs)+len(local),phase='local');local.append(c)
        cfgs+=local
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in local]),1):
            trials.append(q)
            if i%8==0:print('Local',i,'/24',flush=True)
        topcrf=sorted([q for q in trials if q['config']['family']=='crf'],key=rank)[:6];controls=[]
        for q in topcrf:controls.append({**q['config'],'coupled':False,'matchedTrial':q['config']['trial'],'trial':len(cfgs)+len(controls),'phase':'independent-control'})
        cfgs+=controls;trials+=list(pool.map(cv_task,[(c,7919) for c in controls]))
        final=[]
        for family in ['crf','pcc']:
            final+=[q['config'] for q in sorted([q for q in trials if q['config']['family']==family and q['config']['coupled']],key=rank)[:2]]
        for c in list(final):
            if c['family']=='crf':
                control=next(q for q in controls if q['matchedTrial']==c['trial']);final.append(control)
        trials+=list(pool.map(cv_task,[(c,seed) for c in final for seed in SEEDS[1:]]))
    write(OUT/'trials.json.gz',[{k:v for k,v in q.items() if k!='joint'} for q in trials]);write(OUT/'oof-joint.json.gz',{'ids':[rows[i]['id'] for i in core],'runs':[{'trial':q['config']['trial'],'seed':q['seed'],'joint':q['joint']} for q in trials]})
    records=[]
    for cfg in final:
        runs=[q for q in trials if q['config']['trial']==cfg['trial']];models=[]
        for seed in SEEDS:
            model=j.fit(rows,x,y,w,cfg,seed);vp=j.joint_probabilities(model,xv);run=next(q for q in runs if q['seed']==seed)
            models.append({'seed':seed,'model':model,'validation':{d:score(yv,vp,d) for d in ['map','marginal']},'cv':run['cv']})
        means={d:average([q['validation'][d] for q in models]) for d in ['map','marginal']};decoder=min(means,key=lambda d:(-means[d]['exactMatch'],-means[d]['macroF1'],means[d]['jointNLL'],d!='map'))
        saved=[]
        for q in models:
            path=FIXTURE/f"candidate-{cfg['trial']}-seed-{q['seed']}.json.gz";write(path,export(q['model'],cfg,decoder,rows,ph,q['seed']))
            saved.append({'seed':q['seed'],'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':q['validation'][decoder],
                'decoderComparisons':q['validation'],'cv':q['cv'][decoder],'optimizer':q['model']['optimizer']})
        records.append({'id':f"trial-{cfg['trial']}",'config':cfg,'decoder':decoder,'models':saved,'validationMean':means[decoder],'decoderComparisons':means,'cvMean':average([q['cv'] for q in saved])})
        print('Finalist',cfg['trial'],cfg['family'],'coupled',cfg['coupled'],'decoder',decoder,'valExact',means[decoder]['exactMatch'],flush=True)
    prior=read(PRIOR)
    for record in [q for q in prior['finalists'] if q['family']=='powerset']:
        models=[]
        for q in record['models']:
            old=read(ROOT/q['artifact']);raw=j.a.restore(old['model']);z=(xv-raw['mean'])/raw['scale'];joint=j.a.softmax(j.a.forward(raw['layers'],z,raw['activation'])[0][-1])
            models.append({'seed':q['seed'],'raw':old['model'],'sourceArtifact':q['artifact'],'sourceSha256':digest(ROOT/q['artifact']),'scores':{d:score(yv,joint,d) for d in ['map','marginal']}})
        means={d:average([q['scores'][d] for q in models]) for d in ['map','marginal']};decoder=min(means,key=lambda d:(-means[d]['exactMatch'],-means[d]['macroF1'],means[d]['jointNLL'],d!='map'))
        saved=[]
        for q in models:
            model={'family':'prior-powerset','raw':q['raw']};cfg={'family':'prior-powerset','sourceTrial':record['config']['trial']};path=FIXTURE/f"prior-{record['config']['trial']}-seed-{q['seed']}.json.gz"
            artifact=export(model,cfg,decoder,rows,ph,q['seed']);artifact['provenance'].update(sourceArtifact=q['sourceArtifact'],sourceArtifactSha256=q['sourceSha256']);write(path,artifact)
            saved.append({'seed':q['seed'],'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':q['scores'][decoder],'decoderComparisons':q['scores']})
        records.append({'id':f"prior-{record['config']['trial']}",'config':cfg,'decoder':decoder,'models':saved,'validationMean':means[decoder],'decoderComparisons':means,'cvMean':None})
    chosen=min(records,key=lambda q:(-q['validationMean']['exactMatch'],-q['validationMean']['macroF1'],q['validationMean']['jointNLL'],q['id']))
    fixed=next(q for q in chosen['models'] if q['seed']==7919);path=FIXTURE/'classifier-experimental-selected.json.gz';path.write_bytes((ROOT/fixed['artifact']).read_bytes())
    s={'schemaVersion':1,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'decisionFrozenBeforeTest':True,'testUsedForSelection':False,
        'protocolFileSha256':ph,'datasetFileSha256':dh,'embeddingsFileSha256':eh,'configurationCount':len(cfgs),'cvRuns':len(trials),'finalists':records,
        'selectedId':chosen['id'],'selectedDecoder':chosen['decoder'],'selectedValidationMean':chosen['validationMean'],'selectedCVMean':chosen['cvMean'],
        'selectedArtifact':str(path.relative_to(ROOT)),'selectedArtifactSha256':digest(path),'exportSeed':7919,'seeds':SEEDS,'registryUpdated':False,
        'freshIndependentConfirmationRequired':True,'elapsedSeconds':time.monotonic()-start}
    write(OUT/'selection.json',s);print(json.dumps({k:s[k] for k in ['configurationCount','cvRuns','selectedId','selectedDecoder','selectedValidationMean','elapsedSeconds']},indent=2),flush=True)
def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Fixed test report already exists.')
    s=read(OUT/'selection.json');p=read(OUT/'protocol.json');assert s['protocolFileSha256']==digest(OUT/'protocol.json')
    assert p['sources']['runner']==digest(Path(__file__)) and p['sources']['trainer']==digest(ROOT/'scripts/lib/meaning_joint.py')
    paths={'selected':s['selectedArtifact']}
    for family in ['crf','pcc','prior-powerset']:
        q=min([q for q in s['finalists'] if q['config']['family']==family and q['config'].get('coupled',True)],key=lambda q:(-q['validationMean']['exactMatch'],-q['validationMean']['macroF1'],q['validationMean']['jointNLL'],q['id']))
        paths[family]=next(q['artifact'] for q in q['models'] if q['seed']==7919)
    models={k:read(ROOT/v) for k,v in paths.items()};baseline=read(ROOT/BASELINE);cohorts={}
    for name,fixture in [('original120',ROOT/'tests/fixtures/meaning-taxonomy/expanded-1000'),('other48',m.FIXTURE)]:
        data=read(fixture/'dataset.json');encoded=read(fixture/'embeddings.json.gz');assert encoded['datasetFileSha256']==digest(fixture/'dataset.json')
        vectors={q['id']:q['vector'] for q in encoded['rows']};rows=[q for q in data['items'] if q['split']=='test'];x=np.array([vectors[q['id']] for q in rows]);y=np.array([q['targets'] for q in rows]);results={};predictions={}
        for k,model in models.items():
            assert not {q['id'] for q in rows}&set(model['provenance']['trainIds']);joint=artifact_joint(model,x)
            results[k]={'chosen':score(y,joint,model['decoder']),'map':score(y,joint,'map'),'marginal':score(y,joint,'marginal')}
            predictions[k]={'joint':joint.tolist(),'marginals':(joint@j.PATTERNS).tolist()}
        bp=m.probabilities(baseline,x);bm=m.r.expanded_metrics(y,bp,baseline['decisionThreshold'])
        cohorts[name]={'count':len(rows),'metrics':results,'baseline':bm,'targetMet':results['selected']['chosen']['exactMatch']>.9,
            'rows':[{'id':q['id'],'targets':q['targets']} for q in rows],'predictions':predictions}
    assert cohorts['original120']['baseline']['exactMatch']==.725
    r={'schemaVersion':1,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'selectionFileSha256':digest(OUT/'selection.json'),
        'testUsedForSelection':False,'registryUpdated':False,'freshBlindConfirmation':False,'productionActivated':False,
        'targetMetOnBothRegressionCohorts':all(q['targetMet'] for q in cohorts.values()),
        'models':{k:{'artifact':v,'artifactFileSha256':digest(ROOT/v)} for k,v in paths.items()},'cohorts':cohorts,
        'limitations':['Historically exposed CV/validation/tests; no fresh generalization proof.','MAP is a label-set decision; all six marginals remain available.','No post-test reselection or label changes.']}
    write(OUT/'report.json',r);print(json.dumps({k:{name:{d:round(z['exactMatch'],4) for d,z in v.items()} for name,v in c['metrics'].items()} for k,c in cohorts.items()},indent=2),flush=True)
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('workers must be positive')
    select(args.workers) if args.phase=='select' else evaluate()

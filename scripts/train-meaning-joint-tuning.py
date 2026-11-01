#!/usr/bin/env python3
"""Original-policy refinement without increasing the compact joint head size.

Group-nested calibration, train-only reweighting, diagonal regularization,
auxiliary label loss and compact ensembles. Frozen retired tests are checks.
"""
import argparse,concurrent.futures,gzip,importlib.util,json,multiprocessing,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    s=importlib.util.spec_from_file_location(name,ROOT/path);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
h=module('joint_tuning_experiment_helpers','scripts/train-meaning-joint-search.py')
u=module('joint_tuning_optimizer','scripts/lib/meaning_joint_tuning.py')
m,j,np,t=h.m,u.j,u.np,u.t
OUT=ROOT/'docs/meaning-taxonomy-training/joint-tuning';FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/joint-tuning'
SEEDS=[7919,104729,130363];DATA=None
def read(p):return h.read(p)
def write(p,v):h.write(p,v)
def digest(p):return h.digest(p)
def average(values):
    return {**h.average(values),'perClass':{c:{'f1':float(np.mean([v['perClass'][c]['f1'] for v in values]))} for c in t.CATEGORIES}}
def setup(rows,x,y,w,core,folds):
    global DATA
    DATA=rows,x,y,w,core,folds
def modes(cfg):return u.CALIBRATIONS if cfg['family']=='pcc' or cfg['couplingMode']=='all' else u.CALIBRATIONS[:3]
def rank_metric(v):return(-v['exactMatch'],-v['macroF1'],v['bce'])
def cv_task(task):
    cfg,seed=task;rows,x,y,w,core,folds=DATA;lookup={int(ix):k for k,ix in enumerate(core)}
    raw=np.zeros((len(core),64));assessed={mode:np.zeros_like(raw) for mode in modes(cfg)};opts=[];decoders=[];covered=[]
    for fold,(tr,va) in enumerate(folds):
        inner_rows=[rows[i] for i in tr];aa,bb=j.a.d.inner_split(inner_rows,y[tr],20261106+fold)
        warm=u.fit([inner_rows[i] for i in aa],x[tr[aa]],y[tr[aa]],w[tr[aa]],cfg,seed)
        monitor=u.log_joint(warm,x[tr[bb]])
        model=u.fit(inner_rows,x[tr],y[tr],w[tr],cfg,seed)
        ix=[int(i) for i in va if int(i) in lookup];dest=[lookup[i] for i in ix];raw[dest]=u.log_joint(model,x[ix]);covered+=ix
        cals={}
        for mode in assessed:
            cal=u.fit_calibration(y[tr[bb]],monitor,mode,.1);assessed[mode][dest]=u.calibrate(raw[dest],cal);cals[mode]=cal
        decoders.append({'monitorIds':[rows[tr[i]]['id'] for i in bb],'innerTrainIds':[rows[tr[i]]['id'] for i in aa],
            'outerScoreIndices':dest,'calibrations':cals})
        opts.append({'full':model['optimizer'],'inner':warm['optimizer']})
    assert sorted(covered)==sorted(core.tolist()) and len(covered)==len(set(covered))
    metrics={mode:h.score(y[core],p,'map') for mode,p in assessed.items()}
    # Fixed before search: assessment outcomes never choose a decoder per config.
    best='unary'
    return {'config':cfg,'seed':seed,'cv':metrics,'searchCalibration':best,'searchMetric':metrics[best],
        'optimizers':opts,'decoderFits':decoders,'oofLogJoint':raw.tolist()}
def converged(run):
    return all(r['success'] for fold in run['optimizers'] for stage in ['full','inner'] for r in fold[stage]) and all(d['calibrations']['unary'].get('optimizerSuccess',True) for d in run['decoderFits'])
def rank(run):return(not converged(run),*rank_metric(run['searchMetric']),run['config']['trial'])
def options(cfg):
    return [('none',.1),('temperature',.1)]+[(mode,penalty) for mode in modes(cfg) if mode not in ['none','temperature'] for penalty in [.01,.1,1.]]
def make_configs():
    prior=read(ROOT/'docs/meaning-taxonomy-training/joint-label-search/selection.json')
    crf=dict(next(q['config'] for q in prior['finalists'] if q['id']==prior['selectedId']))
    pcc=dict(min([q for q in prior['finalists'] if q['config']['family']=='pcc'],key=lambda q:rank_metric(q['validationMean']))['config'])
    defaults={'stateL2Factor':1.,'relationL2Factor':1.,'stateLinkFactor':1.,'relationLinkFactor':1.,
        'auxBCE':0.,'positivePower':0.,'couplingMode':'all','weightMode':'none','weightPower':0.,'weightCap':3.}
    configs=[{**crf,**defaults,'trial':0,'phase':'previous-crf-control'},
        {**pcc,**defaults,'trial':1,'phase':'previous-pcc-control'}]
    rng=np.random.default_rng(20261106)
    for i in range(63):
        configs.append({**crf,**defaults,'l2':float(10**rng.uniform(-3,-.2)),
            'linkL2':float(10**rng.uniform(-5,-.1)),'stateL2Factor':float(10**rng.uniform(-1.7,.5)),
            'relationL2Factor':float(10**rng.uniform(-2,.5)),'stateLinkFactor':float(10**rng.uniform(-.5,1.5)),
            'relationLinkFactor':float(10**rng.uniform(-1,2)),'auxBCE':[0.,.25,.5,1.][i%4],
            'positivePower':[0.,.5,1.][i%3],'couplingMode':['all','all','no-relation','nonnegative'][i%4],
            'preprocess':['standardize','standardize','scaled'][i%3],
            'weightMode':['none','label','set'][i%3],'weightPower':float(rng.uniform(.15,.8)),
            'trial':len(configs),'phase':'broad'})
    for i in range(15):
        configs.append({**pcc,**defaults,'features':'linear' if i%2 else 'rbf','centers':128,
            'l2':float(10**rng.uniform(-5,-.1)),'labelScale':float(10**rng.uniform(-.5,.8)),
            'gamma':float(10**rng.uniform(-.2,1.5)),'order':rng.permutation(6).tolist(),
            'weightMode':['none','label','set'][i%3],'weightPower':float(rng.uniform(.15,.8)),
            'trial':len(configs),'phase':'broad'})
    assert len(configs)==80
    return configs
def local_configs(trials,start):
    result=[];rng=np.random.default_rng(20261107)
    for family,count in [('crf',32),('pcc',16)]:
        parents=sorted([q for q in trials if q['config']['family']==family],key=rank)[:4]
        for i in range(count):
            c=dict(parents[i%4]['config'])
            for key in ['l2','linkL2','stateL2Factor','relationL2Factor','stateLinkFactor','relationLinkFactor']:
                c[key]=float(10**np.clip(np.log10(c[key])+rng.normal(0,.35),-6,2))
            c['weightPower']=float(np.clip(c['weightPower']+rng.normal(0,.12),0,1))
            if family=='pcc':c['gamma']=float(10**np.clip(np.log10(c['gamma'])+rng.normal(0,.2),-.5,2))
            c.update(trial=start+len(result),phase='local');result.append(c)
    return result
def clean(q):return {k:v for k,v in q.items() if k!='oofLogJoint'}
def tensor_count(artifact):
    if artifact['kind']=='probability-ensemble':return sum(tensor_count(a) for a in artifact['members'])
    model=artifact['model'];f=model['features'];n=len(f['mean'])*2
    if 'centers' in f:n+=len(f['centers'])*512
    if model['family']=='crf':n+=len(model['weights'])*6+21
    else:n+=sum(len(z['weights'])+1 for z in model['chain'])
    return n
def export(model,cfg,cal,rows,ph,seed):
    folded,flag=u.fold_calibration(model,cal)
    return {'schemaVersion':1,'role':'experimental-joint-tuning','kind':'single','inputDimension':512,'categories':t.CATEGORIES,
        'labelPolicy':'original-v1','configuration':cfg,'model':j.a.serializable(folded),'calibration':cal,'calibrationFolded':flag,
        'provenance':{'trainIds':[r['id'] for r in rows],'fitSeed':seed,'protocolFileSha256':ph,'testUsedForSelection':False,'productionActivated':False}}
def predict(artifact,x):
    if artifact['kind']=='probability-ensemble':return np.mean([predict(v,x) for v in artifact['members']],axis=0)
    model=j.restore(artifact['model'])
    return j.joint_probabilities(model,x) if artifact['calibrationFolded'] else u.calibrated_model_joint(model,x,artifact['calibration'])
def select(workers):
    if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen outputs exist.')
    OUT.mkdir(parents=True,exist_ok=True);FIXTURE.mkdir(parents=True,exist_ok=True)
    parts,_,dh,eh=m.load_partitions(['train','validation']);rows,x,y=parts['train'];vrows,xv,yv=parts['validation'];w=m.sample_weights(rows)
    core=np.flatnonzero(m.scoring_mask(rows));groups=np.array([r['groupId'] for r in rows]);folds=[]
    for aa,bb in t.group_folds(y[core],groups[core],20261106,count=4):
        tr=np.flatnonzero(np.isin(groups,groups[core[aa]]));va=np.flatnonzero(np.isin(groups,groups[core[bb]]));assert not set(groups[tr])&set(groups[va]);folds.append((tr,va))
    baseline=read(ROOT/h.BASELINE);baseline_val=m.r.expanded_metrics(yv,m.probabilities(baseline,xv),baseline['decisionThreshold'])
    configs=make_configs();protocol={'schemaVersion':1,'date':'2026-11-01','primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'labelPolicy':'original-v1','labelsChanged':False,
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'baseline':h.BASELINE,'baselineSha256':digest(ROOT/h.BASELINE),
        'previousCRF':str((ROOT/'tests/fixtures/meaning-taxonomy/joint-label-search/classifier-experimental-selected.json.gz').relative_to(ROOT)),
        'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
        'folds':[{'trainIds':[rows[i]['id'] for i in tr],'validationIds':[rows[i]['id'] for i in va]} for tr,va in folds],
        'initialConfigs':configs,'localCount':48,'seeds':SEEDS,'exportSeed':7919,'workers':workers,
        'search':'80 broad/control configs +48 narrower configs, ranked by fixed unary-calibrated nested CV with penalty.1. Other CV calibration modes are diagnostic. Converged fits rank ahead of incomplete fits. Same compact CRF/PCC forms; no hidden layers, dropout, encoder/label changes.',
        'weighting':'Loss weights learned from training portion only; source/paraphrase unit base weights stay shared. Preprocessing always uses base family weights, not loss-reweighted data.',
        'calibration':'For each outer fold fit calibrators on a separate grouped inner monitor, then assess outer fold. Final calibrators fit original-meaning OOF only. Compare none/temperature/unary/pairwise, penalties .01/.1/1 in finalist validation. Constrained CRFs omit pairwise-offset calibration.',
        'calibrationMath':'Use exact finite log joint probabilities, never clipping tiny state probabilities before calibration. CRF temperature/unary/pairwise adjustments fold into existing coefficients.',
        'selection':'Top two CRFs, best linear/RBF PCCs, controls0/1 repeat three seeds. Choose mean-validation exact then F1/BCE among candidates passing mean and fixed-seed all-metric reference margins. If none pass, retain highest exact experimental candidate and record ineligible. Prefer smallest tensors within .005 exact/.005 F1/.003 BCE of best eligible.',
        'ensembles':'Uniform joint-probability mixture and coefficient-average of up to3 validation-ranked linear CRFs, fixed seed7919. Eligible before tests; parameter average folds to one CRF.',
        'promotion':'No automatic registry or production changes; old120/other48 are historically exposed regression checks. Fresh independent confirmation remains required.',
        'margins':{'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05},
        'sources':{'runner':digest(Path(__file__)),'trainer':digest(ROOT/'scripts/lib/meaning_joint_tuning.py')},'testUsedForSelection':False}
    write(OUT/'protocol.json',protocol);ph=digest(OUT/'protocol.json');start=time.monotonic();setup(rows,x,y,w,core,folds);trials=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=(rows,x,y,w,core,folds)) as pool:
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in configs]),1):
            trials.append(q)
            if i%8==0:print('Broad',i,'/80','bestExact',min(trials,key=rank)['searchMetric']['exactMatch'],flush=True)
        local=local_configs(trials,len(configs));configs+=local
        for i,q in enumerate(pool.map(cv_task,[(c,7919) for c in local]),1):
            trials.append(q)
            if i%8==0:print('Local',i,'/48','bestExact',min(trials,key=rank)['searchMetric']['exactMatch'],flush=True)
        final=[q['config'] for q in sorted([q for q in trials if q['config']['family']=='crf'],key=rank)[:2]]
        for feature in ['linear','rbf']:
            final.append(min([q for q in trials if q['config']['family']=='pcc' and q['config']['features']==feature],key=rank)['config'])
        for c in configs[:2]:
            if c['trial'] not in [v['trial'] for v in final]:final.append(c)
        trials+=list(pool.map(cv_task,[(c,seed) for c in final for seed in SEEDS[1:]]))
    write(OUT/'trials.json.gz',[clean(q) for q in trials])
    # Keep compact OOF assessment evidence for every search, full log joints for finalists.
    summary=[]
    for q in trials:
        lp=np.array(q['oofLogJoint']);p=np.exp(lp);codes=(y[core]*(2**np.arange(6))).sum(axis=1).astype(int)
        summary.append({'trial':q['config']['trial'],'seed':q['seed'],'marginals':(p@j.PATTERNS).tolist(),'mapCodes':p.argmax(axis=1).tolist(),'trueJointProbability':p[np.arange(len(core)),codes].tolist()})
    write(OUT/'search-oof-summary.json.gz',{'ids':[rows[i]['id'] for i in core],'runs':summary})
    write(OUT/'finalist-oof.json.gz',{'ids':[rows[i]['id'] for i in core],'runs':[{'trial':q['config']['trial'],'seed':q['seed'],'logJoint':q['oofLogJoint']} for q in trials if q['config']['trial'] in [c['trial'] for c in final]]})
    records=[];cache={}
    for cfg in final:
        runs=[q for q in trials if q['config']['trial']==cfg['trial']];seed_fits=[]
        for seed in SEEDS:
            run=next(q for q in runs if q['seed']==seed);model=u.fit(rows,x,y,w,cfg,seed);all_options={}
            for mode,penalty in options(cfg):
                key=f'{mode}:{penalty}';cal=u.fit_calibration(y[core],np.array(run['oofLogJoint']),mode,penalty)
                vp=u.calibrated_model_joint(model,xv,cal);all_options[key]={'calibration':cal,'validation':h.score(yv,vp,'map')}
            seed_fits.append({'seed':seed,'model':model,'options':all_options,'run':run})
        means={k:average([q['options'][k]['validation'] for q in seed_fits]) for k in seed_fits[0]['options']}
        valid=[];optimization_ok=all(r['success'] for q in seed_fits for r in q['model']['optimizer']) and all(converged(q['run']) for q in seed_fits)
        for key,mean in means.items():
            fixed=next(q for q in seed_fits if q['seed']==7919)['options'][key]['validation']
            calibration_ok=all(q['options'][key]['calibration'].get('optimizerSuccess',True) for q in seed_fits)
            if optimization_ok and calibration_ok and m.promotion_gate(mean,baseline_val)['passed'] and m.promotion_gate(fixed,baseline_val)['passed']:valid.append(key)
        key=min(valid or list(means),key=lambda k:(*rank_metric(means[k]),options(cfg).index(tuple([k.split(':')[0],float(k.split(':')[1])]))))
        saved=[]
        for q in seed_fits:
            option=q['options'][key];artifact=export(q['model'],cfg,option['calibration'],rows,ph,q['seed'])
            path=FIXTURE/f"candidate-{cfg['trial']}-seed-{q['seed']}.json.gz";write(path,artifact);cache[(cfg['trial'],q['seed'])]=artifact
            saved.append({'seed':q['seed'],'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':option['validation'],
                'optimizer':q['model']['optimizer'],'calibration':option['calibration'],'calibrationFolded':artifact['calibrationFolded'],
                'outerCVAtCalibrationPenalty0_1':q['run']['cv'].get(key.split(':')[0]),'oofTuning':h.score(y[core],u.calibrate(np.array(q['run']['oofLogJoint']),option['calibration']),'map')})
        records.append({'id':f"trial-{cfg['trial']}",'config':cfg,'calibrationChoice':key,'calibrationComparisons':means,'allOptimizerFitsConverged':optimization_ok,
            'validationMean':means[key],'validationEligible':bool(valid),'models':saved,'tensorCount':tensor_count(cache[(cfg['trial'],7919)])})
        print('Finalist',cfg['trial'],cfg['family'],cfg['features'],'calibration',key,'valExact',means[key]['exactMatch'],'eligible',bool(valid),flush=True)
    ordering=lambda r:(*rank_metric(r['validationMean']),r['tensorCount'],r['id'])
    linear=[r for r in sorted(records,key=ordering) if r['config']['family']=='crf' and r['config']['features']=='linear' and r['allOptimizerFitsConverged']][:3]
    if len(linear)>=2:
        members=[cache[(r['config']['trial'],7919)] for r in linear];member_ids=[r['id'] for r in linear]
        joint=np.mean([predict(a,xv) for a in members],axis=0)
        base={'schemaVersion':1,'role':'experimental-joint-tuning','inputDimension':512,'categories':t.CATEGORIES,'labelPolicy':'original-v1',
            'provenance':{'trainIds':[r['id'] for r in rows],'fitSeed':7919,'protocolFileSha256':ph,'testUsedForSelection':False,'productionActivated':False},'memberIds':member_ids}
        candidates=[('probability-mixture',{**base,'kind':'probability-ensemble','members':members},joint)]
        models=[j.restore(a['model']) for a in members];averaged=u.average_linear_crfs(models)
        expected=j.a.softmax(np.mean([u.log_joint(v,xv) for v in models],axis=0))
        np.testing.assert_allclose(j.joint_probabilities(averaged,xv),expected,atol=1e-11)
        avg_artifact={**base,'kind':'single','configuration':{'family':'crf','features':'linear','method':'coefficient-average'},'model':j.a.serializable(averaged),
            'calibration':{'method':'none'},'calibrationFolded':True}
        candidates.append(('coefficient-average',avg_artifact,j.joint_probabilities(averaged,xv)))
        for name,artifact,vp in candidates:
            path=FIXTURE/f'{name}.json.gz';write(path,artifact);metric=h.score(yv,vp,'map');eligible=m.promotion_gate(metric,baseline_val)['passed']
            records.append({'id':name,'config':{'family':'ensemble','method':name},'validationMean':metric,'validationEligible':eligible,'tensorCount':tensor_count(artifact),
                'models':[{'seed':7919,'artifact':str(path.relative_to(ROOT)),'artifactFileSha256':digest(path),'validation':metric}]})
    eligible=[r for r in records if r['validationEligible']];best=min(eligible or records,key=ordering)
    near=[r for r in (eligible or records) if r['validationMean']['exactMatch']>=best['validationMean']['exactMatch']-.005 and r['validationMean']['macroF1']>=best['validationMean']['macroF1']-.005 and r['validationMean']['bce']<=best['validationMean']['bce']+.003]
    selected=min(near,key=lambda r:(r['tensorCount'],*rank_metric(r['validationMean']),r['id']))
    fixed=next(q for q in selected['models'] if q['seed']==7919);path=FIXTURE/'classifier-experimental-selected.json.gz';path.write_bytes((ROOT/fixed['artifact']).read_bytes())
    selection={'schemaVersion':1,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'decisionFrozenBeforeTest':True,'testUsedForSelection':False,
        'protocolFileSha256':ph,'datasetFileSha256':dh,'embeddingsFileSha256':eh,'configurationCount':len(configs),'cvRuns':len(trials),'seeds':SEEDS,'exportSeed':7919,
        'finalists':records,'selectedId':selected['id'],'selectedArtifact':str(path.relative_to(ROOT)),'selectedArtifactSha256':digest(path),
        'selectedValidationMean':selected['validationMean'],'selectedValidationEligible':selected['validationEligible'],'unconstrainedBestValidationId':min(records,key=ordering)['id'],
        'baselineValidation':baseline_val,'registryUpdated':False,'freshIndependentConfirmationRequired':True,'elapsedSeconds':time.monotonic()-start}
    write(OUT/'selection.json',selection);print(json.dumps({k:selection[k] for k in ['configurationCount','cvRuns','selectedId','selectedValidationMean','selectedValidationEligible','elapsedSeconds']},indent=2),flush=True)
def evaluate():
    if (OUT/'report.json').exists():raise RuntimeError('Fixed regression report already exists.')
    s=read(OUT/'selection.json');p=read(OUT/'protocol.json');assert s['protocolFileSha256']==digest(OUT/'protocol.json')
    assert p['sources']['runner']==digest(Path(__file__)) and p['sources']['trainer']==digest(ROOT/'scripts/lib/meaning_joint_tuning.py')
    paths={'selected':s['selectedArtifact']}
    for family in ['crf','pcc']:
        r=min([r for r in s['finalists'] if r['config']['family']==family],key=lambda r:rank_metric(r['validationMean']))
        paths['tuned-'+family]=next(z['artifact'] for z in r['models'] if z['seed']==7919)
    for name in ['probability-mixture','coefficient-average']:
        if any(r['id']==name for r in s['finalists']):paths[name]=next(r['models'][0]['artifact'] for r in s['finalists'] if r['id']==name)
    artifacts={k:read(ROOT/v) for k,v in paths.items()};old=read(ROOT/'docs/meaning-taxonomy-training/joint-label-search/report.json')
    old_crf=read(ROOT/old['models']['selected']['artifact']);old_pcc=read(ROOT/old['models']['pcc']['artifact']);reference=read(ROOT/h.BASELINE);cohorts={}
    for name,folder in [('original120','expanded-1000'),('other48','regularized-expansion')]:
        fixture=ROOT/f'tests/fixtures/meaning-taxonomy/{folder}';data=read(fixture/'dataset.json');encoded=read(fixture/'embeddings.json.gz');assert encoded['datasetFileSha256']==digest(fixture/'dataset.json')
        vecs={r['id']:r['vector'] for r in encoded['rows']};rows=[r for r in data['items'] if r['split']=='test'];x=np.array([vecs[r['id']] for r in rows]);y=np.array([r['targets'] for r in rows]);probs={};results={}
        for key,artifact in artifacts.items():
            assert not set(artifact['provenance']['trainIds'])&{r['id'] for r in rows}
            joint=predict(artifact,x);probs[key]=joint;results[key]=h.score(y,joint,'map')
        for key,artifact in [('previous-crf',old_crf),('previous-pcc',old_pcc)]:
            joint=h.artifact_joint(artifact,x);probs[key]=joint;results[key]=h.score(y,joint,artifact['decoder'])
        baseline=m.r.expanded_metrics(y,m.probabilities(reference,x),reference['decisionThreshold'])
        cohorts[name]={'count':len(rows),'metrics':results,'reference':baseline,'selectedRegressionGate':m.promotion_gate(results['selected'],baseline),
            'selectedVsPreviousCRFGate':m.promotion_gate(results['selected'],results['previous-crf']),
            'targetMet':results['selected']['exactMatch']>.9,'rows':[{'id':r['id'],'targets':r['targets']} for r in rows],
            'predictions':{k:{'joint':v.tolist(),'marginals':(v@j.PATTERNS).tolist()} for k,v in probs.items()}}
    assert cohorts['original120']['reference']['exactMatch']==.725
    report={'schemaVersion':1,'primaryMetric':'exactMatch','targetStrictlyGreaterThan':.9,'selectionFileSha256':digest(OUT/'selection.json'),
        'testUsedForSelection':False,'freshBlindConfirmation':False,'registryUpdated':False,'productionActivated':False,
        'models':{k:{'artifact':v,'artifactFileSha256':digest(ROOT/v)} for k,v in paths.items()},
        'comparators':{'previous-crf':old['models']['selected'],'previous-pcc':old['models']['pcc'],'reference':h.BASELINE},
        'cohorts':cohorts,'targetMetOnBothRegressionCohorts':all(c['targetMet'] for c in cohorts.values()),
        'limitations':['Architecture/calibration variants selected on reused CV/validation; selected scores are adaptive.','Both tests have historical exposure. Fresh independent confirmation is still required.','No labels, encoder, splits or selected candidate changed after tests. No automatic activation.']}
    write(OUT/'report.json',report);print(json.dumps({k:{name:{z:round(v[z],4) for z in ['exactMatch','macroF1','microPrecision','microRecall']} for name,v in c['metrics'].items()} for k,c in cohorts.items()},indent=2),flush=True)
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
    if args.workers<1:ap.error('workers must be positive')
    select(args.workers) if args.phase=='select' else evaluate()

#!/usr/bin/env python3
"""Policy-v2 paired training/calibration search, then frozen fresh confirmation."""
import argparse
import concurrent.futures
import gzip
import importlib.util
import json
import multiprocessing
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
m=module('policy_v2_helpers','scripts/train-meaning-regularization.py');t,np=m.t,m.np
FIXTURE=ROOT/'tests/fixtures/meaning-taxonomy/policy-v2';OUT=ROOT/'docs/meaning-taxonomy-training/policy-v2'
m.FIXTURE=FIXTURE
SEEDS=[7919,104729,130363];DATA=None
def read(p):return json.loads(p.read_bytes())
def write(p,v):t.write_json(p,v)
def digest(p):return t.digest(p.read_bytes())

def setup(rows,x,y,weights,folds,core):
 global DATA
 DATA=rows,x,y,weights,folds,core

def run_cv(task):
 cfg,seed=task;rows,x,y,weights,folds,core=DATA
 if cfg.get('dataScope')=='source-only':
  eligible=np.asarray([r['sourceRecord']['file'].endswith('regularized-expansion/dataset.json') for r in rows])
 else:eligible=np.ones(len(rows),dtype=bool)
 scored=core[eligible[core]];lookup={int(ix):i for i,ix in enumerate(scored)}
 p=np.zeros((len(scored),6));opts=[];covered=[]
 for tr,va in folds:
  tr=tr[eligible[tr]];va=va[eligible[va]]
  fitted=m.reg.fit(x[tr],y[tr],cfg,seed=seed,sample_weight=weights[tr])
  ix=[int(i) for i in va if int(i) in lookup]
  p[[lookup[i] for i in ix]]=t.predict(fitted,x[ix]);covered+=ix;opts.append(fitted['optimizer'])
 assert sorted(covered)==sorted(scored.tolist()) and len(covered)==len(set(covered))
 metric=m.best_threshold(y[scored],p)
 return {'config':cfg,'seed':seed,'cv':metric,'optimizers':opts,'scoredIndices':scored.tolist(),'oof':p.tolist()}

def rank(q):return (-q['cv']['macroF1'],q['cv']['bce'],q['config']['trial'])
def avg(values):
 keys=['macroF1','exactMatch','microPrecision','microRecall','macroPrecision','macroRecall','bce','brier','microF1','macroAveragePrecision']
 return {**{k:float(np.mean([v[k] for v in values])) for k in keys},
  'macroF1StandardDeviation':float(np.std([v['macroF1'] for v in values],ddof=1)),
  'perClass':{c:{k:float(np.mean([v['perClass'][c][k] for v in values])) for k in ['f1','precision','recall']} for c in t.CATEGORIES}}
def strip(q):return {k:v for k,v in q.items() if k not in ['oof','scoredIndices']}

def select(workers):
 if (OUT/'selection.json').exists() or (OUT/'report.json').exists():raise RuntimeError('Frozen selection/report already exists.')
 subprocess.run(['node','scripts/audit-meaning-policy-v2.mjs'],cwd=ROOT,check=True,capture_output=True)
 parts,encoded,dh,eh=m.load_partitions(['train','validation']);rows,x,y=parts['train'];vrows,xv,yv=parts['validation']
 assert len(vrows)==60
 weights=m.sample_weights(rows);core=np.flatnonzero(m.scoring_mask(rows));groups=np.asarray([r['groupId'] for r in rows]);folds=[]
 for a,b in t.group_folds(y[core],groups[core],20261102,count=4):
  tr=np.flatnonzero(np.isin(groups,groups[core[a]]));va=np.flatnonzero(np.isin(groups,groups[core[b]]))
  assert not set(groups[tr])&set(groups[va]);folds.append((tr,va))
 registry=read(m.CURRENT_REGISTRY);current=read(ROOT/registry['artifact'])
 assert digest(ROOT/registry['artifact'])==registry['artifactFileSha256']
 oldlinear=read(ROOT/'tests/fixtures/meaning-taxonomy/regularized-expansion/candidate-0-l2-52.json')
 policyhash=digest(FIXTURE/'POLICY.md')
 protocol={'schemaVersion':1,'date':'2026-11-01','annotationPolicyVersion':'v2','policyFileSha256':policyhash,
  'datasetFileSha256':dh,'embeddingsFileSha256':eh,'currentClassifier':registry,'labelsFrozenBeforeFitting':True,
  'trainingRows':len(rows),'trainingMeaningUnits':len(core),'validationRows':60,'freshTestRows':120,
  'trainIds':[r['id'] for r in rows],'validationIds':[r['id'] for r in vrows],
  'foldSeed':20261102,'fitSeeds':SEEDS,'exportSeed':7919,'workers':workers,
  'folds':[{'trainIds':[rows[i]['id'] for i in a],'validationIds':[rows[i]['id'] for i in b]} for a,b in folds],
  'search':'48 broad random configurations + 24 local configurations + four fixed all-data controls, plus one fixed source-only control; L2 and positive weighting, identical search spaces for linear and32. No dropout.',
  'space':{'architectures':[0,32],'l2Log10':[-6,-.4],'weightPower':[0,1],'preprocess':['scaled','standardize'],'center':True,'broadMaxIterations':600,'localMaxIterations':800},
  'convergenceConfirmation':'All finalist configs and all three seeds repeat their four OOF fits and full fit with maxIterations=3000 before calibration/validation selection. Search caps remain in the trial history. This budget is fixed before fresh test access.',
  'scoring':'Original meanings scored once; paraphrases share source unit weight and group. Four grouped training-only OOF folds; thresholds and calibration fit from OOF only.',
  'calibration':'Compare none, temperature-global-bias and temperature-class-bias. Choose the simplest method within .002 mean validation BCE and .001 mean Brier of the best mean-BCE method. Refit no calibrator on validation/test.',
  'selection':'Two best CV configs per architecture plus fixed current32 source-only v2 control repeat over three seeds. Rank mean validation macroF1, then BCE. Prefer linear when all predeclared practical margins pass. No best-seed selection.',
  'controls':'Old source-only targets v1 versus v2, same rows/inputs/current32 hyperparameters and frozen current calibration/threshold; then all-v2 data. Controls preserve their exact fit scopes. Both v2 source-only and all-data fixed32 are eligible before test.',
  'replacementMargins':{'macroF1':.01,'exactMatch':.02,'microPrecision':.02,'microRecall':.02,'bce':.01,'brier':.003,'perClassF1':.05},
  'confirmation':'Fresh120 v2 gold labels after architecture/calibration/threshold/seed frozen. Compare all models on identical meanings and targets, never percentages from old cohorts/labels.',
  'limitations':['AI-reviewed project ontology, not independently verified human-expert truth.','Category definitions were refined; a new-policy gain is not a causal estimate of correcting factual label errors.','Fresh holdout is stratified for coverage, not natural app prevalence.'],
  'sourceFiles':{'runner':digest(Path(__file__)),'regularizationTrainer':digest(ROOT/'scripts/lib/meaning_regularization.py')}}
 OUT.mkdir(parents=True,exist_ok=True);write(OUT/'protocol.json',protocol);ph=digest(OUT/'protocol.json');started=time.monotonic()
 fixed_keys=['hidden','preprocess','center','l2','weightPower']
 fixed32={k:current['hyperparameters'][k] for k in fixed_keys};fixedlinear={k:oldlinear['hyperparameters'][k] for k in fixed_keys}
 configs=[{**cfg,'l1':0.,'dataScope':'all','maxIterations':800,'phase':'control','trial':i} for i,cfg in enumerate([
  {**fixedlinear,'l2':0.},{**fixed32,'l2':0.},fixedlinear,fixed32])]
 rng=np.random.default_rng(20261102)
 for h in [0,32]:
  for _ in range(24):configs.append({'hidden':h,'preprocess':str(rng.choice(['standardize','scaled'])),'center':True,
   'l1':0.,'l2':float(10**rng.uniform(-6,-.4)),'weightPower':float(rng.uniform(0,1)),
   'dataScope':'all','maxIterations':600,'phase':'broad','trial':len(configs)})
 trials=[];setup(rows,x,y,weights,folds,core)
 with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=(rows,x,y,weights,folds,core)) as pool:
  for i,q in enumerate(pool.map(run_cv,[(c,SEEDS[0]) for c in configs]),1):
   trials.append(q)
   if i%8==0:print('Broad/control',i,'/52',flush=True)
  write(OUT/'broad-trials.json',[strip(q) for q in trials]);local=[]
  for h in [0,32]:
   parents=sorted([q for q in trials if q['config']['hidden']==h],key=rank)[:4]
   for _ in range(12):
    parent=parents[int(rng.integers(len(parents)))]['config']
    local.append({**parent,'l2':float(10**np.clip(np.log10(max(parent['l2'],1e-6))+rng.normal(0,.5),-7,-.1)),
     'weightPower':float(np.clip(parent['weightPower']+rng.normal(0,.15),0,1)),
     'maxIterations':800,'phase':'local','trial':len(configs)+len(local)})
  configs+=local
  for i,q in enumerate(pool.map(run_cv,[(c,SEEDS[0]) for c in local]),1):
   trials.append(q)
   if i%8==0:print('Local',i,'/24',flush=True)
  finalist_configs=[]
  for h in [0,32]:finalist_configs+=[q['config'] for q in sorted([q for q in trials if q['config']['hidden']==h],key=rank)[:2]]
  # Include the fixed v2 controls before confirmation, not as post-test substitutes.
  if not any(q['trial']==3 for q in finalist_configs):finalist_configs.append(configs[3])
  sourcecfg={**configs[3],'dataScope':'source-only','phase':'label-control','trial':len(configs)}
  finalist_configs.append(sourcecfg)
  finalist_configs=[{**c,'searchMaxIterations':c['maxIterations'],'maxIterations':3000,'phase':'convergence-confirmation'} for c in finalist_configs]
  extra=[(c,seed) for c in finalist_configs for seed in SEEDS]
  trials+=list(pool.map(run_cv,extra))
 write(OUT/'trials.json',[strip(q) for q in trials])
 store={'categories':t.CATEGORIES,'runs':[{'trial':q['config']['trial'],'phase':q['config']['phase'],'seed':q['seed'],
  'ids':[rows[i]['id'] for i in q['scoredIndices']],'probabilities':q['oof']} for q in trials]}
 (OUT/'oof-predictions.json.gz').write_bytes(gzip.compress(json.dumps(store,separators=(',',':')).encode(),compresslevel=9,mtime=0))
 finalists=[]
 methods=['none','temperature-global-bias','temperature-class-bias']
 for cfg in finalist_configs:
  runs=[q for q in trials if q['config']['trial']==cfg['trial'] and q['config']['phase']=='convergence-confirmation'];assert sorted(q['seed'] for q in runs)==sorted(SEEDS)
  eligible=np.asarray([cfg['dataScope']=='all' or r['sourceRecord']['file'].endswith('regularized-expansion/dataset.json') for r in rows])
  ix=np.flatnonzero(eligible);fitids=[rows[i]['id'] for i in ix];seed_models=[]
  for seed in SEEDS:
   run=next(q for q in runs if q['seed']==seed);yy=y[run['scoredIndices']];oof=np.asarray(run['oof'])
   fitted=m.reg.fit(x[ix],y[ix],cfg,seed=seed,sample_weight=weights[ix]);rawv=t.predict(fitted,xv)
   methods_result={}
   for method in methods:
    cal=m.d.fit_calibration(yy,oof,method);cp=m.d.calibrate(oof,cal);threshold=m.best_threshold(yy,cp)['threshold']
    vp=m.d.calibrate(rawv,cal)
    methods_result[method]={'calibration':cal,'threshold':threshold,'validation':m.r.expanded_metrics(yv,vp,threshold),
     'oof':m.r.expanded_metrics(yy,cp,threshold)}
   seed_models.append({'seed':seed,'model':fitted,'methods':methods_result})
  means={method:avg([q['methods'][method]['validation'] for q in seed_models]) for method in methods}
  best=min(methods,key=lambda method:means[method]['bce'])
  chosen=next(method for method in methods if means[method]['bce']<=means[best]['bce']+.002 and means[method]['brier']<=means[best]['brier']+.001)
  records=[]
  for q in seed_models:
   z=q['methods'][chosen];fitted=q['model'];name=f"candidate-{cfg['trial']}-seed-{q['seed']}.json"
   artifact=m.export_model(fitted,cfg,z['threshold'],z['calibration'],encoded,{'annotationPolicyVersion':'v2','policyFileSha256':policyhash,
    'datasetFileSha256':dh,'embeddingsFileSha256':eh,'protocolFileSha256':ph,'trainIds':fitids,'validationIds':[r['id'] for r in vrows],
    'testUsedForSelection':False,'legacyEvaluationUsedForSelection':False,'fitSeed':q['seed'],'regularization':fitted['regularization']})
   artifact.update(annotationPolicyVersion='v2',annotationPolicyFileSha256=policyhash)
   write(FIXTURE/name,artifact)
   train_core=[i for i in ix if rows[i].get('kind')!='paraphrase']
   records.append({'seed':q['seed'],'artifact':name,'artifactFileSha256':digest(FIXTURE/name),'optimizer':fitted['optimizer'],
    'regularization':fitted['regularization'],'validation':z['validation'],'oof':z['oof'],
    'trainOriginalMetrics':m.r.expanded_metrics(y[train_core],m.probabilities(artifact,x[train_core]),z['threshold'])})
  finalists.append({'config':cfg,'calibrationMethod':chosen,'calibrationComparisons':means,
   'validationMean':means[chosen],'cvMean':avg([q['methods'][chosen]['oof'] for q in seed_models]),'models':records})
  print('Finalist',cfg['trial'],'hidden',cfg['hidden'],'scope',cfg['dataScope'],'calibration',chosen,'validationF1',means[chosen]['macroF1'],flush=True)
 bests={h:min([q for q in finalists if q['config']['hidden']==h],key=lambda q:(-q['validationMean']['macroF1'],q['validationMean']['bce'])) for h in [0,32]}
 equivalence=m.equivalent_linear(bests[0]['validationMean'],bests[32]['validationMean'])
 selected=bests[0] if equivalence['passed'] else bests[32]
 fixed=next(q for q in selected['models'] if q['seed']==SEEDS[0]);candidate_path=FIXTURE/'classifier-selected.json';candidate_path.write_bytes((FIXTURE/fixed['artifact']).read_bytes())
 baseline_val=m.r.expanded_metrics(yv,m.probabilities(current,xv),current['decisionThreshold'])
 validation_gate={'mean':m.promotion_gate(selected['validationMean'],baseline_val),'fixedSeed':m.promotion_gate(fixed['validation'],baseline_val)}
 # Causal label/data controls use one identical frozen scoring transform.
 source_ix=np.asarray([i for i,r in enumerate(rows) if r['sourceRecord']['file'].endswith('regularized-expansion/dataset.json')])
 old=read(ROOT/'tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json');oldbyid={r['id']:r for r in old['items']}
 oldy=np.asarray([oldbyid[rows[i]['id']]['targets'] for i in source_ix]);controls={}
 for label,ids,targets in [('source-v1-labels',source_ix,oldy),('source-v2-labels',source_ix,y[source_ix]),('all-v2-labels',np.arange(len(rows)),y)]:
  fitted=m.reg.fit(x[ids],targets,fixed32,seed=7919,sample_weight=weights[ids])
  a=m.export_model(fitted,fixed32,current['decisionThreshold'],current['calibration'],encoded,
   {'control':label,'trainedLabelPolicy':'v1' if label=='source-v1-labels' else 'v2','trainIds':[rows[i]['id'] for i in ids],
    'datasetFileSha256':dh,'protocolFileSha256':ph,'testUsedForSelection':False})
  path=FIXTURE/f'control-{label}.json';write(path,a)
  controls[label]={'artifact':path.name,'artifactFileSha256':digest(path),'trainRows':len(ids),
   'validation':m.r.expanded_metrics(yv,m.probabilities(a,xv),a['decisionThreshold']),'optimizer':fitted['optimizer']}
 selection={'schemaVersion':1,'annotationPolicyVersion':'v2','policyFileSha256':policyhash,'protocolFileSha256':ph,
  'datasetFileSha256':dh,'embeddingsFileSha256':eh,'currentClassifier':registry,'configurationCount':len(configs)+1,
  'searchedConfigurationCount':len(configs),'sourceOnlyControlCount':1,
  'decisionFrozenBeforeTest':True,'testUsedForSelection':False,'exportSeed':7919,'seeds':SEEDS,
  'finalists':finalists,'linearPracticalEquivalence':equivalence,'bestLinearTrial':bests[0]['config']['trial'],
  'best32Trial':bests[32]['config']['trial'],'selectedArchitecture':'linear' if selected['config']['hidden']==0 else '32',
  'selected':{'config':selected['config'],'calibrationMethod':selected['calibrationMethod'],'validationMean':selected['validationMean'],
   'fixedSeedValidation':fixed['validation'],'artifact':str(candidate_path.relative_to(ROOT)),'artifactFileSha256':digest(candidate_path)},
  'validationPromotionGate':validation_gate,'selectedOptimizerConverged':next(q for q in selected['models'] if q['seed']==7919)['optimizer']['success'],
  'eligibleBeforeTest':all(v['passed'] for v in validation_gate.values()) and all(q['optimizer']['success'] for q in selected['models']),
  'baselineValidation':baseline_val,'controls':controls,'elapsedSeconds':time.monotonic()-started}
 write(OUT/'selection.json',selection);print(json.dumps({'selected':selection['selected']['config'],'architecture':selection['selectedArchitecture'],'eligibleBeforeTest':selection['eligibleBeforeTest'],'testEvaluated':False},indent=2),flush=True)

def evaluate():
 if (OUT/'report.json').exists():raise RuntimeError('Fresh test report already exists.')
 sel=read(OUT/'selection.json');protocol=read(OUT/'protocol.json')
 assert sel['decisionFrozenBeforeTest'] and not sel['testUsedForSelection'] and sel['protocolFileSha256']==digest(OUT/'protocol.json')
 parts,_,dh,eh=m.load_partitions(['test']);assert dh==sel['datasetFileSha256'] and eh==sel['embeddingsFileSha256']
 rows,x,y=parts['test'];assert len(rows)==120
 cp=ROOT/sel['selected']['artifact'];assert digest(cp)==sel['selected']['artifactFileSha256'];selected=read(cp)
 reg=sel['currentClassifier'];assert digest(ROOT/reg['artifact'])==reg['artifactFileSha256'];current=read(ROOT/reg['artifact'])
 models={'selected':selected,'previousV1Head':current}
 for name,trial in [('linear',sel['bestLinearTrial']),('32',sel['best32Trial'])]:
  record=next(q for q in sel['finalists'] if q['config']['trial']==trial);a=next(q for q in record['models'] if q['seed']==7919)
  path=FIXTURE/a['artifact'];assert digest(path)==a['artifactFileSha256'];models[name]=read(path)
 for name,record in sel['controls'].items():
  path=FIXTURE/record['artifact'];assert digest(path)==record['artifactFileSha256'];models[name]=read(path)
 p={name:m.probabilities(a,x) for name,a in models.items()}
 for a in models.values():assert not set(a['provenance']['trainIds'])&{r['id'] for r in rows}
 results={name:m.r.expanded_metrics(y,p[name],a['decisionThreshold']) for name,a in models.items()}
 gate=m.promotion_gate(results['selected'],results['previousV1Head']);promote=sel['eligibleBeforeTest'] and gate['passed']
 report={'schemaVersion':1,'annotationPolicyVersion':'v2','freshTestCount':120,
  'selectionFileSha256':digest(OUT/'selection.json'),'protocolFileSha256':digest(OUT/'protocol.json'),
  'datasetFileSha256':dh,'embeddingsFileSha256':eh,'testUsedForArchitectureHyperparameterCalibrationOrSeedSelection':False,
  'results':results,'selectedArchitecture':sel['selectedArchitecture'],'promotionGate':{'validationPassed':sel['eligibleBeforeTest'],'freshTest':gate,'passed':promote},
  'groupBootstrapSelectedVsPrevious':t.bootstrap_comparison(y,p['selected'],p['previousV1Head'],np.asarray([r['groupId'] for r in rows]),selected['decisionThreshold'],baseline_threshold=current['decisionThreshold']),
  'productionPersonalizerChanged':False,'limitations':protocol['limitations']}
 write(OUT/'report.json',report)
 write(OUT/'test-predictions.json',{'categories':t.CATEGORIES,'annotationPolicyVersion':'v2','rows':[{'id':r['id'],'word':r['word'],'targets':r['targets'],
  'probabilities':{name:values[i].tolist() for name,values in p.items()}} for i,r in enumerate(rows)]})
 if promote:
  write(m.CURRENT_REGISTRY,{'schemaVersion':1,'role':'current-meaning-category-classifier','modelType':selected['modelType'],
   'annotationPolicyVersion':'v2','policyFileSha256':sel['policyFileSha256'],'artifact':sel['selected']['artifact'],
   'artifactFileSha256':sel['selected']['artifactFileSha256'],'selection':str((OUT/'selection.json').relative_to(ROOT)),
   'confirmation':str((OUT/'report.json').relative_to(ROOT)),'productionPersonalizerChanged':False})
 print(json.dumps({'promotedOffline':promote,'selectedArchitecture':sel['selectedArchitecture'],'results':results,'gate':gate},indent=2),flush=True)

if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--phase',choices=['select','evaluate'],required=True);ap.add_argument('--workers',type=int,default=6);args=ap.parse_args()
 if args.workers<1:ap.error('--workers must be positive')
 if args.phase=='select':select(args.workers)
 else:evaluate()

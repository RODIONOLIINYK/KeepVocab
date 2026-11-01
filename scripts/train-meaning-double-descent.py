#!/usr/bin/env python3
"""Predeclared capacity diagnostics beyond interpolation; no test evaluation."""
import argparse,concurrent.futures,hashlib,importlib.util,multiprocessing,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('capacity_runner',ROOT/'scripts/train-meaning-structured.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
s,np=r.s,r.np
OUT=r.OUT/'double-descent';DATA=None
WIDTHS=[1,2,4,8,16,32,64,128,256,512,1024]
def setup(rows,x,y,w,core,xv,yv):
    global DATA
    DATA=rows,x,y,w,core,xv,yv
def train(x,y,w,cfg,seed,epochs,observe=None,interval=25):
    xx,features=s.feature_fit(x,w,cfg);params=s.initialize(xx,y,w,cfg,seed);theta=s.pack(params,xx.shape[1],cfg)
    first=np.zeros_like(theta);second=np.zeros_like(theta);rng=np.random.default_rng(seed+17011);step=0;trace=[];average_weight=float(w.mean())
    def model():return {'family':'structured','config':cfg,'features':features,'params':s.unpack(theta,xx.shape[1],cfg)}
    if observe:trace.append(observe(model(),0))
    for epoch in range(1,epochs+1):
        batches=np.array_split(rng.permutation(len(y)),max(1,int(np.ceil(len(y)/cfg['batchSize']))))
        for ix in batches:
            _,g=s.objective(theta,xx[ix],y[ix],w[ix],cfg,len(ix)*average_weight);norm=np.linalg.norm(g);g*=min(1.,5/max(float(norm),1e-12))
            step+=1;first=.9*first+.1*g;second=.999*second+.001*g*g
            theta-=cfg['learningRate']*(first/(1-.9**step))/(np.sqrt(second/(1-.999**step))+1e-8)
            if not np.isfinite(theta).all():raise ValueError('Nonfinite diagnostic fit.')
        if observe and (epoch%interval==0 or epoch==epochs):trace.append(observe(model(),epoch))
    return model(),trace,theta
def run(task):
    width,l2,seed,epochs=task;rows,x,y,w,core,xv,yv=DATA
    cfg={'family':'neural-global','width':width,'context':False,'residual':False,'activation':'tanh','l2':l2,'edgeL2':l2,'pairL2':l2,
        'preprocess':'standardize','pca':0,'whiten':False,'learningRate':.003,'batchSize':64,'maxEpochs':epochs,'patience':30}
    def observe(model,epoch):
        trainlog=s.model_log_joint(model,x);train=r.h.score(y[core],np.exp(trainlog[core]),'map');val=r.h.score(yv,np.exp(s.model_log_joint(model,xv)),'map')
        codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
        return {'epoch':epoch,'train':{k:train[k] for k in ['exactMatch','macroF1','microPrecision','microRecall','bce','brier','jointNLL']},
            'validation':{k:val[k] for k in ['exactMatch','macroF1','microPrecision','microRecall','bce','brier','jointNLL']},
            'allTrainingRowsExact':float(np.all(s.P[trainlog.argmax(axis=1)]==y,axis=1).mean()),
            'weightedTrainingJointNLL':float(-np.average(trainlog[np.arange(len(y)),codes],weights=w))}
    start=time.monotonic();model,trace,theta=train(x,y,w,cfg,seed,epochs,observe)
    count=len(theta);output={'width':width,'l2':l2,'seed':seed,'epochs':epochs,'parameterCount':count,'parametersPerOriginalMeaning':count/len(core),
        'parametersPerTrainingRow':count/len(rows),'parameterArraySHA256':hashlib.sha256(theta.astype('<f8').tobytes()).hexdigest(),
        'trace':trace,'elapsedSeconds':time.monotonic()-start,'trainingInterpolated':trace[-1]['allTrainingRowsExact']==1.}
    if width==max(WIDTHS) and seed==7919:
        path=OUT/f'wide-L2-{l2}-seed-{seed}.json.gz';r.write(path,{'role':'capacity-diagnostic-only','model':s.serializable(model),'trainIds':[q['id'] for q in rows]})
        output['diagnosticArtifact']=str(path.relative_to(ROOT));output['diagnosticArtifactFileSha256']=r.digest(path)
    return output
def main(workers,epochs):
    if (OUT/'protocol.json').exists():raise RuntimeError('Capacity protocol already frozen.')
    OUT.mkdir(parents=True,exist_ok=True)
    parts,_,dh,eh=r.m.load_partitions(['train','validation']);rows,x,y=parts['train'];vr,xv,yv=parts['validation'];w=r.m.sample_weights(rows);core=np.flatnonzero(r.m.scoring_mask(rows))
    tasks=[(width,l2,seed,epochs) for width in WIDTHS for l2 in [0.,.001] for seed in r.SEEDS]
    protocol={'schemaVersion':1,'request':'Test capacity around ten parameters per meaning and well beyond, examining double descent.',
        'labelPolicy':'original-v1','labelsChanged':False,'datasetFileSha256':dh,'embeddingsFileSha256':eh,
        'trainIds':[q['id'] for q in rows],'validationIds':[q['id'] for q in vr],'trainingRows':len(rows),'originalTrainingMeanings':len(core),
        'widths':WIDTHS,'l2':[0.,.001],'seeds':r.SEEDS,'epochs':epochs,'workers':workers,'configurationSeedFits':len(tasks),
        'model':'512 -> width tanh ->6 unary scores plus15 global pairwise couplings. Exact64-state joint NLL, no dropout.',
        'fixedControls':'Training-only standardized features; Adam LR.003,batch64,clip norm5; shared seeds and sample order. No early stopping, calibration, thresholds, or test evaluation.',
        'counts':'519*width+21 learned coefficients, excluding1024 preprocessing statistics. Report ratios against890 fitted rows and750 original meaning units.',
        'interpolation':'Every one of890 fitting rows has the complete label set correct at the fixed final epoch. Also retain joint NLL, since zero classification error is not zero loss.',
        'interpretation':'Look for a held-out error rise near observed interpolation then decline at higher capacity; report seed ranges and loss curves. A finite adaptive reused-validation experiment cannot prove the theory or estimate fresh generalization.',
        'testUsed':False,'usedForModelSelection':False,'productionActivated':False,'reusedValidation':True,
        'sources':{'runner':r.digest(Path(__file__)),'trainer':r.digest(ROOT/'scripts/lib/meaning_structured.py')},
        'research':'https://arxiv.org/abs/1812.11118'}
    r.write(OUT/'protocol.json',protocol);setup(rows,x,y,w,core,xv,yv);results=[];start=time.monotonic()
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,mp_context=multiprocessing.get_context('spawn'),initializer=setup,initargs=DATA) as pool:
        for i,q in enumerate(pool.map(run,tasks),1):
            results.append(q)
            print(i,'/',len(tasks),'width',q['width'],'L2',q['l2'],'seed',q['seed'],'train',round(q['trace'][-1]['train']['exactMatch'],4),'val',round(q['trace'][-1]['validation']['exactMatch'],4),flush=True)
    # Diagnose conflicting identical frozen input vectors without changing labels.
    buckets={}
    for i,v in enumerate(x):buckets.setdefault(v.tobytes(),[]).append(i)
    conflicts=[{'ids':[rows[i]['id'] for i in ids],'targets':[y[i].tolist() for i in ids]} for ids in buckets.values() if len({tuple(y[i]) for i in ids})>1]
    r.write(OUT/'results.json.gz',{'protocolFileSha256':r.digest(OUT/'protocol.json'),'testUsed':False,'usedForModelSelection':False,
        'elapsedSeconds':time.monotonic()-start,'conflictingIdenticalTrainingVectors':conflicts,'runs':results})
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--workers',type=int,default=6);ap.add_argument('--epochs',type=int,default=1000);args=ap.parse_args()
    if min(args.workers,args.epochs)<1:ap.error('Positive worker and epoch counts required.')
    main(args.workers,args.epochs)

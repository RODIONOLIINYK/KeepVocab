#!/usr/bin/env python3
"""Check all-zero matrix initialization invariance; not a capacity benchmark."""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('zero_init_runner',ROOT/'scripts/train-meaning-structured.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
s,np=r.s,r.np
def check(x,y,w,cfg,seed,steps=20):
    xx,f=s.feature_fit(x,w,cfg);params=s.initialize(xx,y,w,cfg,seed)
    for key in params:
        if key.endswith('Weight'):params[key][:]=0.
    theta=s.pack(params,xx.shape[1],cfg);initial=theta.copy();history=[]
    # Zero-gradient invariance holds for Adam/SGD/etc.; full-batch GD makes the check explicit.
    for step in range(steps):
        _,g=s.objective(theta,xx,y,w,cfg);gradient=s.unpack(g,xx.shape[1],cfg)
        norms={k:float(np.max(np.abs(gradient[k]))) for k in ['hiddenWeight','hiddenBias','outputWeight']}
        assert all(v==0. for v in norms.values());theta-=.003*g;history.append(norms)
    fitted={'family':'structured','config':cfg,'features':f,'params':s.unpack(theta,xx.shape[1],cfg)}
    log=s.model_log_joint(fitted,x);variation=float(np.max(np.abs(log-log[:1])))
    assert variation==0.
    # A zero output matrix alone permits the output gradient to learn from random hidden features.
    other=s.initialize(xx,y,w,cfg,seed);other['outputWeight'][:]=0.;q=s.pack(other,xx.shape[1],cfg)
    _,g0=s.objective(q,xx,y,w,cfg);g0p=s.unpack(g0,xx.shape[1],cfg);q-=.003*g0
    _,g1=s.objective(q,xx,y,w,cfg);g1p=s.unpack(g1,xx.shape[1],cfg)
    return fitted,{'width':cfg['width'],'seed':seed,'steps':steps,'allZeroMatrices':True,'outputBiasInitialization':'training label log-odds',
        'allHiddenAndOutputWeightGradientsZero':all(all(v==0. for v in z.values()) for z in history),
        'inputLogProbabilityVariation':variation,'nonMatrixParameterMaxChange':float(np.max(np.abs(theta-initial))),
        'randomHiddenZeroOutputControl':{'firstOutputWeightGradientMax':float(np.max(np.abs(g0p['outputWeight']))),
            'firstHiddenWeightGradientMax':float(np.max(np.abs(g0p['hiddenWeight']))),
            'secondHiddenWeightGradientMax':float(np.max(np.abs(g1p['hiddenWeight'])))}}
def main():
    path=r.OUT/'zero-initialization.json'
    if path.exists():raise RuntimeError('Initialization evidence already exists.')
    parts,_,dh,eh=r.m.load_partitions(['train','validation']);rows,x,y=parts['train'];vr,xv,yv=parts['validation'];w=r.m.sample_weights(rows);runs=[]
    for width in [16,32,1024]:
        for seed in r.SEEDS:
            cfg={**r.make_configs()[0],'width':width,'l2':0.,'pairL2':0.}
            model,result=check(x,y,w,cfg,seed);lp=s.model_log_joint(model,xv);result['validationInputLogProbabilityVariation']=float(np.max(np.abs(lp-lp[:1])));assert result['validationInputLogProbabilityVariation']==0.
            runs.append(result)
    r.write(path,{'schemaVersion':1,'purpose':'Gradient/invariance check, not an accuracy comparison or double-descent sweep.',
        'sourceSha256':r.digest(Path(__file__)),'trainerSha256':r.digest(ROOT/'scripts/lib/meaning_structured.py'),
        'datasetFileSha256':dh,'embeddingsFileSha256':eh,'trainIds':[q['id'] for q in rows],'validationIds':[q['id'] for q in vr],
        'testUsed':False,'usedForModelSelection':False,'labelChanges':False,'runs':runs,
        'conclusion':'Both zero matrices keep tanh hidden activations and hidden/output matrix gradients zero, so the network cannot learn dependence on input. Random hidden plus zero output can begin learning after output weights move.'})
    print({'runs':len(runs),'allZeroGradientInvariancePassed':all(q['allHiddenAndOutputWeightGradientsZero'] for q in runs),'output':str(path)})
if __name__=='__main__':main()

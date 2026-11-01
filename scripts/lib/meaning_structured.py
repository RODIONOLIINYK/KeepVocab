"""Shared nonlinear/conditional CRFs and an RBF-SVM reference; text only.

Joint heads enumerate64 label sets and retain six marginals. Residual models
warm-start from a linear CRF fitted on their own training portion, never from
a full-data artifact. PCA, SVM calibration and stopping are training-only.
"""
import importlib.util,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('structured_joint_helpers',ROOT/'scripts/lib/meaning_joint_tuning.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
j,np,t=u.j,u.np,u.t
sys.path.insert(0,str(ROOT/'work/meaning-structured-python'))
P,Q=j.PATTERNS,j.PAIR_PATTERNS

def feature_fit(x,weights,cfg):
    mean,scale=j.a.preprocessing(x,weights,cfg['preprocess']);z=(x-mean)/scale
    projection=None;project_scale=None
    dimension=cfg.get('pca',0)
    if dimension:
        cov=(z.T*weights)@z/weights.sum();values,vectors=np.linalg.eigh(cov);order=np.argsort(-values)[:min(dimension,x.shape[1])]
        projection=vectors[:,order];project_scale=np.sqrt(np.maximum(values[order],1e-8)) if cfg.get('whiten') else np.ones(len(order))
        z=z@projection/project_scale
    return z,{'mean':mean,'scale':scale,'projection':projection,'projectScale':project_scale,'fitScope':'training rows with base family weights'}
def transform(features,x):
    z=(x-features['mean'])/features['scale']
    return z if features['projection'] is None else z@features['projection']/features['projectScale']

def shapes(d,cfg):
    h=cfg['width'];outputs=21 if cfg['context'] else 6
    result=([('hiddenWeight',(d,h)),('hiddenBias',(h,)),('outputWeight',(h,outputs)),('outputBias',(outputs,))]
            if h else [('outputWeight',(d,outputs)),('outputBias',(outputs,))])
    if cfg.get('residual'):result.append(('skipWeight',(d,6)))
    if not cfg['context']:result.append(('couplings',(15,)))
    return result
def pack(params,d,cfg):return np.concatenate([params[k].ravel() for k,_ in shapes(d,cfg)])
def unpack(theta,d,cfg):
    result={};offset=0
    for key,shape in shapes(d,cfg):
        size=int(np.prod(shape));result[key]=theta[offset:offset+size].reshape(shape);offset+=size
    assert offset==len(theta)
    return result
def forward(params,x,cfg):
    z=x@params['hiddenWeight']+params['hiddenBias'] if cfg['width'] else None
    hidden=j.a.activate(z,cfg['activation']) if cfg['width'] else x
    scores=hidden@params['outputWeight']+params['outputBias']
    if cfg.get('residual'):scores[:,:6]+=x@params['skipWeight']
    logits=scores[:,:6]@P.T+(scores[:,6:]@Q.T if cfg['context'] else params['couplings']@Q.T)
    return logits,hidden,z
def objective(theta,x,y,weights,cfg,normalizer=None):
    params=unpack(theta,x.shape[1],cfg);logits,hidden,z=forward(params,x,cfg)
    logp=logits-logits.max(axis=1,keepdims=True);logp-=np.log(np.exp(logp).sum(axis=1,keepdims=True));joint=np.exp(logp)
    codes=(y*(2**np.arange(6))).sum(axis=1).astype(int);denom=float(weights.sum()) if normalizer is None else normalizer
    loss=float(-np.sum(weights*logp[np.arange(len(y)),codes])/denom)
    delta=joint.copy();delta[np.arange(len(y)),codes]-=1;delta*=weights[:,None]/denom
    ds=np.c_[delta@P,delta@Q] if cfg['context'] else delta@P
    gradients={'outputWeight':hidden.T@ds,'outputBias':ds.sum(axis=0)}
    if cfg['width']:
        dh=(ds@params['outputWeight'].T)*j.a.activation_gradient(z,hidden,cfg['activation'])
        gradients.update(hiddenWeight=x.T@dh,hiddenBias=dh.sum(axis=0))
    if cfg.get('residual'):gradients['skipWeight']=x.T@ds[:,:6]
    if not cfg['context']:gradients['couplings']=(delta@Q).sum(axis=0)
    for key,value in params.items():
        penalty=np.zeros_like(value)
        if key.endswith('Weight'):
            penalty[:]=cfg['l2']
            if key=='outputWeight' and cfg['context']:penalty[:,6:]=cfg['edgeL2']
        if key=='couplings':penalty[:]=cfg['pairL2']
        if key=='outputBias' and cfg['context']:penalty[6:]=cfg['pairL2']
        loss+=float(np.sum(penalty*value*value))/2;gradients[key]+=penalty*value
    return loss,pack(gradients,x.shape[1],cfg)

def initialize(x,y,weights,cfg,seed,return_status=False):
    rng=np.random.default_rng(seed);params={}
    for key,shape in shapes(x.shape[1],cfg):
        params[key]=rng.normal(0,np.sqrt(2/sum(shape)),shape) if len(shape)==2 else np.zeros(shape)
    p=np.clip(np.average(y,axis=0,weights=weights),1e-4,1-1e-4);params['outputBias'][:6]=np.log(p/(1-p))
    status=None
    if cfg.get('residual'):
        base_cfg={**cfg,'width':0,'context':False,'residual':False,'l2':.16930515417195477,'pairL2':.00014529930324199482}
        base=initialize(x,y,weights,base_cfg,seed);theta=pack(base,x.shape[1],base_cfg)
        fitted=t.minimize(objective,theta,args=(x,y,weights,base_cfg),jac=True,method='L-BFGS-B',options={'maxiter':2000,'ftol':1e-11,'gtol':1e-7})
        status={'success':bool(fitted.success),'iterations':int(fitted.nit),'fitScope':'only current fit training rows; no frozen full-data weights'}
        base=unpack(fitted.x,x.shape[1],base_cfg)
        params['skipWeight']=base['outputWeight'].copy();params['outputBias']=base['outputBias'].copy();params['couplings']=base['couplings'].copy()
        params['outputWeight'][:]=0.
    return (params,status) if return_status else params

def model_log_joint(model,x):
    z=transform(model['features'],x)
    if model['family']=='svm':
        logits=svm_margins_transformed(model,z)*np.exp(np.array(model['platt']['logSlopes']))+np.array(model['platt']['offsets'])
        scores=logits@P.T
    else:scores=forward(model['params'],z,model['config'])[0]
    scores=scores-scores.max(axis=1,keepdims=True)
    return scores-np.log(np.exp(scores).sum(axis=1,keepdims=True))
def fit_neural(x,y,weights,cfg,seed,monitor=None,epochs=None,scoring_mask=None,diagnostic_monitor=None):
    if (monitor is None)==(epochs is None):raise ValueError('Provide exactly one monitor or epoch count.')
    if diagnostic_monitor is not None and (monitor is not None or epochs is None):raise ValueError('Diagnostic monitor requires a fixed-epoch replay.')
    observed=monitor if monitor is not None else diagnostic_monitor
    xx,features=feature_fit(x,weights,cfg);params,warmstart=initialize(xx,y,weights,cfg,seed,True);theta=pack(params,xx.shape[1],cfg)
    scoremask=np.ones(len(y),dtype=bool) if scoring_mask is None else np.asarray(scoring_mask,dtype=bool)
    def curve_point(parameters,iteration):
        current={'family':'structured','config':cfg,'features':features,'params':unpack(parameters,xx.shape[1],cfg)}
        trainlog=model_log_joint(current,x[scoremask]);trainy=y[scoremask];codes=(trainy*(2**np.arange(6))).sum(axis=1).astype(int)
        item={'step':iteration,'trainJointNLL':float(-np.mean(trainlog[np.arange(len(codes)),codes])),
            'trainExact':float(np.all(P[trainlog.argmax(axis=1)]==trainy,axis=1).mean()),'trainingOriginalCount':int(scoremask.sum())}
        if observed is not None:
            val=model_log_joint(current,observed[0]);codes=(observed[1]*(2**np.arange(6))).sum(axis=1).astype(int)
            item.update(monitorJointNLL=float(-np.mean(val[np.arange(len(codes)),codes])),
                monitorExact=float(np.all(P[val.argmax(axis=1)]==observed[1],axis=1).mean()),monitorCount=len(codes))
        return item
    if not cfg['width']:
        trace=[];iteration=0
        def callback(parameters):
            nonlocal iteration
            iteration+=1
            if iteration%5==0:trace.append(curve_point(parameters,iteration))
        result=t.minimize(objective,theta,args=(xx,y,weights,cfg),jac=True,method='L-BFGS-B',callback=callback,options={'maxiter':3000,'ftol':1e-11,'gtol':1e-7,'maxfun':9000})
        trace.append(curve_point(result.x,int(result.nit)))
        return {'family':'structured','config':cfg,'features':features,'params':unpack(result.x,xx.shape[1],cfg),
            'optimizer':{'algorithm':'L-BFGS-B','success':bool(result.success),'iterations':int(result.nit),'loss':float(result.fun),'monitorTrace':trace,'monitorUsedForStopping':False,'warmStart':warmstart}}
    limit=int(epochs if epochs is not None else cfg['maxEpochs']);order_rng=np.random.default_rng(seed+17011)
    first=np.zeros_like(theta);second=np.zeros_like(theta);step=0;trace=[];best_loss=float('inf');best_epoch=0;best=None
    if diagnostic_monitor is not None:trace.append(curve_point(theta,0))
    frozen=np.zeros_like(theta,dtype=bool);offset=0
    for key,shape in shapes(xx.shape[1],cfg):
        count=int(np.prod(shape))
        if key=='skipWeight' and cfg.get('freezeLinear'):frozen[offset:offset+count]=True
        offset+=count
    average_weight=float(weights.mean())
    for epoch in range(1,limit+1):
        batches=np.array_split(order_rng.permutation(len(y)),max(1,int(np.ceil(len(y)/cfg['batchSize']))))
        for ix in batches:
            _,gradient=objective(theta,xx[ix],y[ix],weights[ix],cfg,len(ix)*average_weight);gradient[frozen]=0
            norm=np.linalg.norm(gradient);gradient*=min(1.,5/max(float(norm),1e-12))
            step+=1;first=.9*first+.1*gradient;second=.999*second+.001*gradient*gradient
            theta-=cfg['learningRate']*(first/(1-.9**step))/(np.sqrt(second/(1-.999**step))+1e-8)
            if not np.isfinite(theta).all():raise ValueError('Nonfinite neural fit.')
        if observed is not None and (diagnostic_monitor is not None or epoch%5==0 or epoch==limit):
            item=curve_point(theta,epoch);item['epoch']=epoch;trace.append(item);loss=item['monitorJointNLL']
            if monitor is not None:
                if loss<best_loss-.0001:best_loss,best_epoch,best=loss,epoch,theta.copy()
                if epoch>=30 and epoch-best_epoch>=cfg['patience']:break
    if monitor is not None:theta=best
    else:best_epoch=limit
    return {'family':'structured','config':cfg,'features':features,'params':unpack(theta,xx.shape[1],cfg),
        'optimizer':{'algorithm':'Adam weight-only L2','selectedEpoch':best_epoch,'epochsExecuted':epoch,'steps':step,
            'earlyStopping':monitor is not None,'stoppedAtEpochLimit':epoch==limit,'monitorTrace':trace,'diagnosticMonitor':diagnostic_monitor is not None,'warmStart':warmstart}}

def svm_margins_transformed(model,z):
    distances=np.maximum(0,np.sum(z*z,axis=1)[:,None]+np.sum(model['supportVectors']**2,axis=1)[None,:]-2*z@model['supportVectors'].T)
    return np.exp(-model['gamma']*distances)@model['coefficients']+model['bias']
def svm_margins(model,x):return svm_margins_transformed(model,transform(model['features'],x))
def fit_svm(x,y,weights,cfg):
    from sklearn.svm import SVC
    xx,features=feature_fit(x,weights,cfg);variance=float(np.average(np.average(xx*xx,axis=0,weights=weights)))
    gamma=cfg['gammaFactor']/max(1e-8,xx.shape[1]*variance);heads=[];support=[]
    for c in range(6):
        p=float(np.average(y[:,c],weights=weights));balanced={0:1/(2*max(1-p,1e-6)),1:1/(2*max(p,1e-6))} if cfg['balanced'] else None
        clf=SVC(C=cfg['C'],gamma=gamma,kernel='rbf',probability=False,class_weight=balanced,tol=1e-4,cache_size=128,max_iter=100000)
        clf.fit(xx,y[:,c].astype(int),sample_weight=weights);heads.append(clf);support.extend(clf.support_.tolist())
    ids=np.array(sorted(set(support)));lookup={int(ix):i for i,ix in enumerate(ids)};coeff=np.zeros((len(ids),6));bias=np.array([h.intercept_[0] for h in heads])
    for c,head in enumerate(heads):
        for ix,value in zip(head.support_,head.dual_coef_[0]):coeff[lookup[int(ix)],c]=value
    model={'family':'svm','config':cfg,'features':features,'supportVectors':xx[ids],'coefficients':coeff,'bias':bias,'gamma':gamma,
        'platt':{'logSlopes':[0.]*6,'offsets':[0.]*6},'optimizer':{'algorithm':'six RBF SVCs, no internal probability CV','allConverged':all(h.fit_status_==0 for h in heads),
            'supportVectorCount':len(ids),'iterations':[h.n_iter_.tolist() for h in heads]}}
    np.testing.assert_allclose(svm_margins_transformed(model,xx),np.c_[*[h.decision_function(xx) for h in heads]],atol=1e-8)
    return model
def platt_objective(params,margins,y,penalty):
    slopes=np.exp(params[:6]);z=margins*slopes+params[6:];delta=(t.sigmoid(z)-y)/y.size
    loss=float(np.mean(np.logaddexp(0,z)-y*z))+penalty*float(params@params)/2
    return loss,np.r_[(delta*margins*slopes).sum(axis=0),delta.sum(axis=0)]+penalty*params
def fit_platt(margins,y):
    result=t.minimize(platt_objective,np.zeros(12),args=(margins,y,.001),jac=True,method='L-BFGS-B',bounds=[(-3,3)]*6+[(-4,4)]*6,
        options={'maxiter':600,'gtol':1e-7,'ftol':1e-11})
    return {'logSlopes':result.x[:6].tolist(),'offsets':result.x[6:].tolist(),'fitRows':len(y),'success':bool(result.success),'fitScope':'training-only monitor/OOF margins'}

def fit_inner(rows,x,y,weights,cfg,seed=7919,split_seed=20261108):
    tr,va=j.a.d.inner_split(rows,y,split_seed)
    if cfg['family']=='svm':
        warm=fit_svm(x[tr],y[tr],weights[tr],cfg);monitor_margins=svm_margins(warm,x[va]);platt=fit_platt(monitor_margins,y[va]);warm['platt']=platt
        model=fit_svm(x,y,weights,cfg);model['platt']=platt
        model['optimizer']['innerSVM']=warm['optimizer'];model['optimizer']['plattSuccess']=platt['success']
    else:
        original=np.array([r.get('kind')!='paraphrase' for r in rows])
        warm=fit_neural(x[tr],y[tr],weights[tr],cfg,seed,monitor=(x[va],y[va]),scoring_mask=original[tr])
        epochs=warm['optimizer'].get('selectedEpoch',1)
        model=fit_neural(x,y,weights,cfg,seed,epochs=epochs,scoring_mask=original)
        model['optimizer']['innerStop']=warm['optimizer']
    model['innerDecoder']={'ids':[rows[i]['id'] for i in va],'trainingIds':[rows[i]['id'] for i in tr],
        'targets':y[va],'logJoint':model_log_joint(warm,x[va]),'trainingRows':len(tr)}
    return model

def serializable(model):return j.a.serializable(model)
def restore(value):
    model=dict(value);features=dict(model['features'])
    for k in ['mean','scale','projection','projectScale']:
        if features.get(k) is not None:features[k]=np.array(features[k])
    model['features']=features
    if model['family']=='svm':
        for k in ['supportVectors','coefficients','bias']:model[k]=np.array(model[k])
    else:model['params']={k:np.array(v) for k,v in model['params'].items()}
    return model

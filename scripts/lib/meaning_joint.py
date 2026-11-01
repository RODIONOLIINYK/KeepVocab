"""Six-label joint models with exact enumeration of all 64 assignments.

PCC uses logistic conditionals; pairwise CRF uses exact joint likelihood.
Both return full joint probabilities and six marginals. MAP chooses a label
set for exact-match scoring; it never replaces the six routing probabilities.
"""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('joint_architecture_helpers',ROOT/'scripts/lib/meaning_architectures.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
np,t=a.np,a.t
PATTERNS=a.PATTERNS
PAIRS=[(i,j) for i in range(6) for j in range(i+1,6)]
PAIR_PATTERNS=np.array([PATTERNS[:,i]*PATTERNS[:,j] for i,j in PAIRS]).T

def crf_unpack(theta,dimension,coupled=True):
    count=dimension*6
    return theta[:count].reshape(dimension,6),theta[count:count+6],theta[count+6:] if coupled else np.zeros(15)

def crf_objective(theta,x,y,weights,l2,link_l2,coupled=True):
    w,b,j=crf_unpack(theta,x.shape[1],coupled)
    logits=(x@w+b)@PATTERNS.T+j@PAIR_PATTERNS.T
    joint=a.softmax(logits);codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
    logp=logits-logits.max(axis=1,keepdims=True);logp-=np.log(np.exp(logp).sum(axis=1,keepdims=True))
    loss=float(-np.sum(weights*logp[np.arange(len(y)),codes])/weights.sum())+l2*float(np.sum(w*w))/2
    delta=(joint@PATTERNS-y)*weights[:,None]/weights.sum()
    gradient=np.r_[(x.T@delta+l2*w).ravel(),delta.sum(axis=0)]
    if coupled:
        actual=np.array([y[:,i]*y[:,j] for i,j in PAIRS]).T
        gj=((joint@PAIR_PATTERNS-actual)*weights[:,None]).sum(axis=0)/weights.sum()+link_l2*j
        gradient=np.r_[gradient,gj];loss+=link_l2*float(j@j)/2
    return loss,gradient

def binary_objective(theta,x,y,weights,l2):
    z=x@theta[:-1]+theta[-1];delta=(t.sigmoid(z)-y)*weights/weights.sum()
    loss=float(np.sum(weights*(np.logaddexp(0,z)-y*z))/weights.sum())+l2*float(theta[:-1]@theta[:-1])/2
    return loss,np.r_[x.T@delta+l2*theta[:-1],delta.sum()]

def feature_fit(rows,x,weights,cfg,seed):
    transform={'kind':cfg['features']}
    if cfg['features']=='rbf':
        core=np.array([i for i,r in enumerate(rows) if r.get('kind')!='paraphrase'])
        ids=np.random.default_rng(seed).permutation(core)[:min(cfg['centers'],len(core))]
        centers=x[ids];xx=np.exp(-cfg['gamma']*np.maximum(0,2-2*x@centers.T))
        transform.update(centers=centers,gamma=cfg['gamma'],centerIds=[rows[i]['id'] for i in ids])
    else:xx=x
    mean,scale=a.preprocessing(xx,weights,cfg['preprocess']);transform.update(mean=mean,scale=scale)
    return (xx-mean)/scale,transform

def transform(model,x):
    f=model['features'];xx=x
    if f['kind']=='rbf':xx=np.exp(-f['gamma']*np.maximum(0,2-2*x@f['centers'].T))
    return (xx-f['mean'])/f['scale']

def fit(rows,x,y,weights,cfg,seed=7919):
    xx,features=feature_fit(rows,x,weights,cfg,seed)
    if cfg['family']=='crf':
        prevalence=np.clip(np.average(y,axis=0,weights=weights),1e-4,1-1e-4)
        theta=np.r_[np.zeros(xx.shape[1]*6),np.log(prevalence/(1-prevalence)),np.zeros(15) if cfg['coupled'] else np.array([])]
        result=t.minimize(crf_objective,theta,args=(xx,y,weights,cfg['l2'],cfg['linkL2'],cfg['coupled']),jac=True,method='L-BFGS-B',
            options={'maxiter':2500,'maxfun':7500,'ftol':1e-11,'gtol':1e-7,'maxls':30})
        w,b,j=crf_unpack(result.x,xx.shape[1],cfg['coupled'])
        params={'weights':w,'bias':b,'couplings':j}
        opts=[{'success':bool(result.success),'iterations':int(result.nit),'loss':float(result.fun),'message':str(result.message)}]
    else:
        opts=[];chain=[];order=cfg['order']
        for step,label in enumerate(order):
            extra=y[:,order[:step]]*cfg['labelScale'];z=np.c_[xx,extra];p=np.clip(np.average(y[:,label],weights=weights),1e-4,1-1e-4)
            theta=np.r_[np.zeros(z.shape[1]),np.log(p/(1-p))]
            result=t.minimize(binary_objective,theta,args=(z,y[:,label],weights,cfg['l2']),jac=True,method='L-BFGS-B',
                options={'maxiter':2500,'maxfun':7500,'ftol':1e-11,'gtol':1e-7,'maxls':30})
            chain.append({'weights':result.x[:-1],'bias':float(result.x[-1])})
            opts.append({'success':bool(result.success),'iterations':int(result.nit),'loss':float(result.fun),'message':str(result.message)})
        params={'chain':chain,'order':order,'labelScale':cfg['labelScale']}
    return {'family':cfg['family'],'features':features,**params,'optimizer':opts}

def joint_probabilities(model,x):
    xx=transform(model,x)
    if model['family']=='crf':return a.softmax((xx@model['weights']+model['bias'])@PATTERNS.T+model['couplings']@PAIR_PATTERNS.T)
    logp=np.zeros((len(x),64));order=model['order']
    for step,label in enumerate(order):
        head=model['chain'][step];w=head['weights'];base=xx@w[:xx.shape[1]]+head['bias']
        extras=(PATTERNS[:,order[:step]]*model['labelScale'])@w[xx.shape[1]:]
        logits=base[:,None]+extras[None,:]
        logp+=PATTERNS[None,:,label]*logits-np.logaddexp(0,logits)
    return a.softmax(logp)

def restore(value):
    model=dict(value);f=dict(model['features'])
    for key in ['mean','scale','centers']:
        if key in f:f[key]=np.array(f[key])
    model['features']=f
    if model['family']=='crf':
        for k in ['weights','bias','couplings']:model[k]=np.array(model[k])
    else:model['chain']=[{**q,'weights':np.array(q['weights'])} for q in model['chain']]
    return model

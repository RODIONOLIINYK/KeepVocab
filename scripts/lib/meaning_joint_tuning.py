"""Fixed-size joint heads: loss weighting, diagonal L2 and joint calibration.

No hidden layers or label changes. CRF calibration folds into existing unary
and pairwise coefficients; all six marginal probabilities remain available.
"""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('joint_tuning_helpers',ROOT/'scripts/lib/meaning_joint.py')
j=importlib.util.module_from_spec(spec);spec.loader.exec_module(j)
np,t=j.np,j.t
PATTERNS,PAIR_PATTERNS=j.PATTERNS,j.PAIR_PATTERNS

def loss_weights(y,base,cfg):
    mode=cfg.get('weightMode','none');power=cfg.get('weightPower',0.)
    if mode=='set':
        codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
        counts=np.bincount(codes,weights=base,minlength=64)
        factor=(base.sum()/np.count_nonzero(counts)/np.maximum(counts[codes],1))**power
    elif mode=='label':
        prevalence=np.maximum(np.average(y,axis=0,weights=base),1e-6)
        rarity=(prevalence.mean()/prevalence)**power
        factor=np.sum(y*rarity,axis=1)/np.maximum(1,y.sum(axis=1))
    else:factor=np.ones(len(y))
    return base*np.clip(factor,.5,cfg.get('weightCap',3.))

def penalties(cfg):
    unary=np.full(6,cfg['l2']);unary[3]*=cfg.get('stateL2Factor',1.);unary[4]*=cfg.get('relationL2Factor',1.)
    pair=np.full(15,cfg['linkL2'])
    for k,(a,b) in enumerate(j.PAIRS):
        if 4 in (a,b):pair[k]*=cfg.get('relationLinkFactor',1.)
        if 3 in (a,b):pair[k]*=cfg.get('stateLinkFactor',1.)
    return unary,pair

def objective(theta,x,y,weights,unary_l2,pair_l2,aux,positive):
    w,b,couplings=j.crf_unpack(theta,x.shape[1],True)
    logits=(x@w+b)@PATTERNS.T+couplings@PAIR_PATTERNS.T
    joint=j.a.softmax(logits);codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
    logp=logits-logits.max(axis=1,keepdims=True);logp-=np.log(np.exp(logp).sum(axis=1,keepdims=True))
    loss=float(-np.sum(weights*logp[np.arange(len(y)),codes])/weights.sum())
    delta=joint.copy();delta[np.arange(len(y)),codes]-=1;delta*=weights[:,None]/weights.sum()
    if aux:
        cells=weights[:,None]*(1+y*(positive-1));normalizer=cells.sum()
        # Exact label-event likelihood, stable even for extremely small marginals.
        for c in range(6):
            allowed=PATTERNS[None,:,c]==y[:,None,c]
            masked=np.where(allowed,logp,-np.inf);maximum=masked.max(axis=1,keepdims=True)
            event=np.exp(masked-maximum);mass=event.sum(axis=1,keepdims=True);event/=mass
            loss-=aux*float(np.sum(cells[:,c]*(maximum[:,0]+np.log(mass[:,0])))/normalizer)
            delta+=aux*cells[:,c,None]*(joint-event)/normalizer
    du=delta@PATTERNS
    loss+=float(np.sum(w*w*unary_l2))/2+float(np.sum(couplings*couplings*pair_l2))/2
    grad=np.r_[(x.T@du+w*unary_l2).ravel(),du.sum(axis=0),(delta@PAIR_PATTERNS).sum(axis=0)+pair_l2*couplings]
    return loss,grad

def fit(rows,x,y,base_weights,cfg,seed=7919):
    # Preprocessing uses base family weights, independent of loss reweighting.
    xx,features=j.feature_fit(rows,x,base_weights,cfg,seed)
    weights=loss_weights(y,base_weights,cfg);positive=j.a.d.class_weights(y,base_weights,cfg.get('positivePower',0.))
    optimizers=[]
    if cfg['family']=='pcc':
        chain=[];order=cfg['order']
        for step,label in enumerate(order):
            z=np.c_[xx,y[:,order[:step]]*cfg['labelScale']]
            p=np.clip(np.average(y[:,label],weights=weights),1e-4,1-1e-4)
            theta=np.r_[np.zeros(z.shape[1]),np.log(p/(1-p))]
            result=t.minimize(j.binary_objective,theta,args=(z,y[:,label],weights,cfg['l2']),jac=True,method='L-BFGS-B',
                options={'maxiter':3000,'maxfun':9000,'ftol':1e-11,'gtol':1e-7,'maxls':30})
            chain.append({'weights':result.x[:-1],'bias':float(result.x[-1])});optimizers.append(result)
        model={'family':'pcc','features':features,'chain':chain,'order':order,'labelScale':cfg['labelScale']}
    else:
        prevalence=np.clip(np.average(y,axis=0,weights=weights),1e-4,1-1e-4)
        theta=np.r_[np.zeros(xx.shape[1]*6),np.log(prevalence/(1-prevalence)),np.zeros(15)]
        ul,pl=penalties(cfg);bounds=[(None,None)]*len(theta)
        for k,(a,b) in enumerate(j.PAIRS):
            if cfg.get('couplingMode')=='no-relation' and 4 in (a,b):bounds[xx.shape[1]*6+6+k]=(0,0)
            elif cfg.get('couplingMode')=='nonnegative':bounds[xx.shape[1]*6+6+k]=(0,None)
        result=t.minimize(objective,theta,args=(xx,y,weights,ul,pl,cfg.get('auxBCE',0.),positive),jac=True,method='L-BFGS-B',bounds=bounds,
            options={'maxiter':3000,'maxfun':9000,'ftol':1e-11,'gtol':1e-7,'maxls':30})
        w,b,couplings=j.crf_unpack(result.x,xx.shape[1],True)
        model={'family':'crf','features':features,'weights':w,'bias':b,'couplings':couplings};optimizers.append(result)
    if not all(np.isfinite(r.x).all() and np.isfinite(r.fun) for r in optimizers):raise ValueError('Nonfinite fit.')
    model['optimizer']=[{'success':bool(r.success),'message':str(r.message),'iterations':int(r.nit),'loss':float(r.fun)} for r in optimizers]
    model['trainingWeights']={'mode':cfg.get('weightMode','none'),'power':cfg.get('weightPower',0.),
        'baseFamilyWeightSum':float(base_weights.sum()),'lossWeightSum':float(weights.sum()),'preprocessingUsesBaseWeights':True}
    return model

CALIBRATIONS=['none','temperature','unary','pairwise']
def calibration_design(mode):
    return np.zeros((64,0)) if mode in ['none','temperature'] else PATTERNS if mode=='unary' else np.c_[PATTERNS,PAIR_PATTERNS]

def calibration_objective(params,logjoint,codes,design,penalty):
    inverse=np.exp(-params[0]);z=logjoint*inverse
    if design.shape[1]:z+=design@params[1:]
    p=j.a.softmax(z);logp=z-z.max(axis=1,keepdims=True);logp-=np.log(np.exp(logp).sum(axis=1,keepdims=True))
    loss=float(-np.mean(logp[np.arange(len(codes)),codes]))+penalty*float(params@params)/2
    delta=p.copy();delta[np.arange(len(codes)),codes]-=1;delta/=len(codes)
    gradient=np.r_[np.sum(delta*(-logjoint*inverse)),delta.sum(axis=0)@design]+penalty*params
    return loss,gradient

def fit_calibration(y,logjoint,mode,penalty=.1):
    if mode=='none':return {'method':'none','temperature':1.,'unaryOffsets':[0.]*6,'pairOffsets':[0.]*15,'fitRows':0}
    design=calibration_design(mode);codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
    result=t.minimize(calibration_objective,np.zeros(1+design.shape[1]),args=(logjoint,codes,design,penalty),
        jac=True,method='L-BFGS-B',bounds=[(-2,2)]+[(-2,2)]*design.shape[1],options={'maxiter':600,'gtol':1e-7,'ftol':1e-11})
    unary=result.x[1:7] if design.shape[1] else np.zeros(6);pairs=result.x[7:] if design.shape[1]==21 else np.zeros(15)
    return {'method':mode,'temperature':float(np.exp(result.x[0])),'unaryOffsets':unary.tolist(),'pairOffsets':pairs.tolist(),
        'fitRows':len(y),'penalty':penalty,'optimizerSuccess':bool(result.success),'fitScope':'training-only predictions; no outer/validation/test targets'}

def log_joint(model,x):
    xx=j.transform(model,x)
    if model['family']=='crf':z=(xx@model['weights']+model['bias'])@PATTERNS.T+model['couplings']@PAIR_PATTERNS.T
    else:
        z=np.zeros((len(x),64));order=model['order']
        for step,label in enumerate(order):
            h=model['chain'][step];base=xx@h['weights'][:xx.shape[1]]+h['bias']
            extra=(PATTERNS[:,order[:step]]*model['labelScale'])@h['weights'][xx.shape[1]:]
            logits=base[:,None]+extra[None,:];z+=PATTERNS[None,:,label]*logits-np.logaddexp(0,logits)
    z=z-z.max(axis=1,keepdims=True)
    return z-np.log(np.exp(z).sum(axis=1,keepdims=True))

def calibrate(logjoint,cal):
    logits=logjoint/cal['temperature']+PATTERNS@np.array(cal['unaryOffsets'])+PAIR_PATTERNS@np.array(cal['pairOffsets'])
    return j.a.softmax(logits)

def fold_calibration(model,cal):
    if model['family']!='crf' or cal['method']=='none':return model,False
    folded={**model,'weights':model['weights']/cal['temperature'],
        'bias':model['bias']/cal['temperature']+np.array(cal['unaryOffsets']),
        'couplings':model['couplings']/cal['temperature']+np.array(cal['pairOffsets'])}
    return folded,True

def calibrated_model_joint(model,x,cal):
    if model['family']=='crf':
        # Work on raw energies so extreme probabilities are not clipped.
        folded,_=fold_calibration(model,cal)
        return j.joint_probabilities(folded,x)
    return calibrate(log_joint(model,x),cal)

def average_linear_crfs(models):
    if not models or any(m['family']!='crf' or m['features']['kind']!='linear' for m in models):raise ValueError('Expected linear CRFs.')
    raw_weights=[m['weights']/m['features']['scale'][:,None] for m in models]
    raw_biases=[m['bias']-m['features']['mean']@w for m,w in zip(models,raw_weights)]
    dimension=models[0]['weights'].shape[0]
    return {'family':'crf','features':{'kind':'linear','mean':np.zeros(dimension),'scale':np.ones(dimension)},
        'weights':np.mean(raw_weights,axis=0),'bias':np.mean(raw_biases,axis=0),
        'couplings':np.mean([m['couplings'] for m in models],axis=0),
        'optimizer':[{'method':'coefficient-average in raw embedding coordinates','fitPerformed':False}]}

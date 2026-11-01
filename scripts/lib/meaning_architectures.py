"""Experimental text-only architectures. Frozen embeddings; no dropout or BN.

Arbitrary-depth tanh/ReLU/SiLU MLPs, a joint-label softmax whose marginals keep
all six memberships, RBF-feature logistic heads and cosine-weighted neighbors.
Nothing in this module is wired into production inference.
"""
import importlib.util
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('architecture_training_helpers',ROOT/'scripts/lib/meaning_dropout.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
t,np,reg=d.t,d.np,d.reg
PATTERNS=((np.arange(64)[:,None]>>np.arange(6))&1).astype(float)

def activate(x,kind):
    if kind=='tanh':return np.tanh(x)
    if kind=='relu':return np.maximum(x,0)
    if kind=='silu':return x*t.sigmoid(x)
    raise ValueError('Unknown activation.')

def activation_gradient(z,h,kind):
    if kind=='tanh':return 1-h*h
    if kind=='relu':return (z>0).astype(float)
    s=t.sigmoid(z);return s+z*s*(1-s)

def softmax(z):
    q=np.exp(z-z.max(axis=1,keepdims=True));return q/q.sum(axis=1,keepdims=True)

def preprocessing(x,weights,kind):
    mean=np.average(x,axis=0,weights=weights)
    scale=(np.maximum(np.sqrt(np.average((x-mean)**2,axis=0,weights=weights)),.01)
           if kind=='standardize' else np.full(x.shape[1],1/np.sqrt(x.shape[1])))
    return mean,scale

def initialize(x,y,weights,cfg,seed):
    dims=[x.shape[1],*cfg['widths'],64 if cfg['family']=='powerset' else 6]
    rng=np.random.default_rng(seed);layers=[]
    for i,(a,b) in enumerate(zip(dims[:-1],dims[1:])):
        sd=np.sqrt(2/a) if cfg['activation'] in ['relu','silu'] and i<len(dims)-2 else np.sqrt(2/(a+b))
        w=rng.normal(0,sd,size=(a,b));bias=np.zeros(b)
        if i==len(dims)-2:
            if cfg['family']=='powerset':
                codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
                counts=np.bincount(codes,weights=weights,minlength=64)
                bias=np.log(np.maximum(counts/counts.sum(),1e-6))
            else:
                p=np.clip(np.average(y,axis=0,weights=weights),1e-4,1-1e-4);bias=np.log(p/(1-p))
        layers.append((w,bias))
    return layers

def forward(layers,x,activation):
    values=[x];zs=[]
    for i,(w,bias) in enumerate(layers):
        z=values[-1]@w+bias;zs.append(z)
        values.append(activate(z,activation) if i<len(layers)-1 else z)
    return values,zs

def loss_gradient(layers,x,y,weights,cfg,positive,normalizer=None):
    values,zs=forward(layers,x,cfg['activation']);logits=values[-1];smooth=cfg.get('smoothing',0.)
    if cfg['family']=='powerset':
        codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
        targets=np.eye(64)[codes]*(1-smooth)+smooth/64
        probabilities=softmax(logits);denom=float(weights.sum()) if normalizer is None else normalizer
        logp=logits-logits.max(axis=1,keepdims=True)
        logp-=np.log(np.exp(logp).sum(axis=1,keepdims=True))
        loss=float(-np.sum(weights[:,None]*targets*logp)/denom)
        delta=(probabilities-targets)*weights[:,None]/denom
    else:
        targets=y*(1-smooth)+.5*smooth
        cell=weights[:,None]*(1+y*(positive-1));denom=float(cell.sum()) if normalizer is None else normalizer
        p=t.sigmoid(logits);bce=np.logaddexp(0,logits)-targets*logits
        gamma=cfg.get('focalGamma',0.)
        if gamma:
            pt=np.clip(y*p+(1-y)*(1-p),1e-12,1-1e-12)
            factor=(1-pt)**gamma
            loss=float(np.sum(cell*factor*bce)/denom)
            delta=(factor*(p-targets)-bce*gamma*(1-pt)**(gamma-1)*(2*y-1)*p*(1-p))*cell/denom
        else:
            loss=float(np.sum(cell*bce)/denom);delta=(p-targets)*cell/denom
    gradients=[]
    for i in reversed(range(len(layers))):
        w,bias=layers[i];loss+=cfg['l2']*float(np.sum(w*w))/2
        gradients.insert(0,(values[i].T@delta+cfg['l2']*w,delta.sum(axis=0)))
        if i:delta=(delta@w.T)*activation_gradient(zs[i-1],values[i],cfg['activation'])
    return loss,gradients

def probabilities(model,x):
    kind=model['family']
    if kind=='knn':
        similarity=x@model['centers'].T
        k=min(model['neighbors'],len(model['centers']))
        # Stable ties make exported inference portable across NumPy and JS.
        ix=np.argsort(-similarity,axis=1,kind='stable')[:,:k]
        s=np.take_along_axis(similarity,ix,axis=1);q=np.exp(model['temperature']*(s-s.max(axis=1,keepdims=True)))
        q*=model['sampleWeights'][ix];q/=q.sum(axis=1,keepdims=True)
        return np.sum(q[:,:,None]*model['targets'][ix],axis=1)
    if kind=='rbf':
        features=np.exp(-model['gamma']*np.maximum(0,2-2*x@model['centers'].T))
        return t.predict(model['head'],features)
    z=(x-model['mean'])/model['scale'];logits=forward(model['layers'],z,model['activation'])[0][-1]
    return softmax(logits)@PATTERNS if kind=='powerset' else t.sigmoid(logits)

def fit_mlp(x,y,weights,cfg,seed,monitor=None,epochs=None):
    if (monitor is None)==(epochs is None):raise ValueError('Exactly one stopping monitor or fixed epoch count required.')
    if cfg['family'] not in ['mlp','powerset'] or cfg['l2']<0 or cfg['batchSize']<2:raise ValueError('Invalid MLP configuration.')
    mean,scale=preprocessing(x,weights,cfg['preprocess']);xx=np.ascontiguousarray((x-mean)/scale)
    layers=initialize(x,y,weights,cfg,seed);first=[(np.zeros_like(w),np.zeros_like(z)) for w,z in layers];second=[(np.zeros_like(w),np.zeros_like(z)) for w,z in layers]
    positive=d.class_weights(y,weights,cfg['weightPower'])
    fit_weights=weights.copy()
    if cfg['family']=='powerset':
        codes=(y*(2**np.arange(6))).sum(axis=1).astype(int);freq=np.bincount(codes,weights=weights,minlength=64)
        fit_weights*=np.clip((weights.sum()/np.maximum(freq[codes],1)/np.count_nonzero(freq))**cfg['weightPower'],.2,8)
        weight_per_row=float(fit_weights.sum()/len(y))
    else:weight_per_row=float(np.sum(weights[:,None]*(1+y*(positive-1)))/len(y))
    order=np.random.default_rng(seed+17011);step=0;trace=[];best=None;best_epoch=0;best_loss=float('inf')
    limit=int(epochs if epochs is not None else cfg['maxEpochs']);clipped=0
    for epoch in range(1,limit+1):
        batches=np.array_split(order.permutation(len(y)),max(1,int(np.ceil(len(y)/cfg['batchSize']))))
        lr=cfg['learningRate']
        if cfg.get('schedule')=='cosine':lr*=.1+.9*(1+np.cos(np.pi*(epoch-1)/cfg['maxEpochs']))/2
        for ix in batches:
            _,grad=loss_gradient(layers,xx[ix],y[ix],fit_weights[ix],cfg,positive,len(ix)*weight_per_row)
            norm=np.sqrt(sum(float(np.sum(a*a)+np.sum(z*z)) for a,z in grad));factor=min(1.,5/max(norm,1e-12))
            if factor<1:clipped+=1
            step+=1
            for i in range(len(layers)):
                for j in [0,1]:
                    g=grad[i][j]*factor;first[i][j][:]=.9*first[i][j]+.1*g;second[i][j][:]=.999*second[i][j]+.001*g*g
                    layers[i][j][:]-=lr*(first[i][j]/(1-.9**step))/(np.sqrt(second[i][j]/(1-.999**step))+1e-8)
            if not all(np.isfinite(a).all() and np.isfinite(z).all() for a,z in layers):raise ValueError('Non-finite parameters.')
        if monitor is not None and (epoch%5==0 or epoch==limit):
            model={'family':cfg['family'],'mean':mean,'scale':scale,'activation':cfg['activation'],'layers':layers}
            p=np.clip(probabilities(model,monitor[0]),1e-12,1-1e-12)
            loss=float(-np.mean(monitor[1]*np.log(p)+(1-monitor[1])*np.log1p(-p)))
            trace.append({'epoch':epoch,'monitorBCE':loss})
            if loss<best_loss-cfg.get('minDelta',1e-4):
                best_loss,best_epoch=loss,epoch;best=[(w.copy(),z.copy()) for w,z in layers]
            if epoch>=cfg.get('minEpochs',30) and epoch-best_epoch>=cfg.get('patience',30):break
    if monitor is not None:layers=best
    else:best_epoch=limit
    return {'family':cfg['family'],'mean':mean,'scale':scale,'activation':cfg['activation'],'layers':layers,
        'optimizer':{'algorithm':'Adam coupled weight-only L2','selectedEpoch':best_epoch,'epochsExecuted':epoch,
            'earlyStopping':monitor is not None,'steps':step,'gradientClippedSteps':clipped,
            'stoppedAtEpochLimit':epoch==limit,'monitorTrace':trace}}

def fit_simple(rows,x,y,weights,cfg,seed=7919):
    if cfg['family']=='knn':
        return {'family':'knn','centers':x.copy(),'targets':y.copy(),'sampleWeights':weights.copy(),
            'neighbors':cfg['neighbors'],'temperature':cfg['temperature'],'optimizer':{'algorithm':'weighted cosine neighbors','trainingRows':len(y)}}
    if cfg['family']=='rbf':
        # Centers are sampled from original training meanings, never monitors/tests.
        core=np.array([i for i,r in enumerate(rows) if r.get('kind')!='paraphrase'])
        indices=np.random.default_rng(seed).permutation(core)[:min(len(core),cfg['centers'])]
        centers=x[indices].copy();features=np.exp(-cfg['gamma']*np.maximum(0,2-2*x@centers.T))
        config={'hidden':0,'l1':0.,'l2':cfg['l2'],'weightPower':cfg['weightPower'],'center':True,'preprocess':'standardize','maxIterations':2000}
        head=reg.fit(features,y,config,seed,weights)
        return {'family':'rbf','centers':centers,'gamma':cfg['gamma'],'head':head,'optimizer':head['optimizer'],
            'centerIds':[rows[i]['id'] for i in indices]}
    raise ValueError('Expected an RBF or neighbor configuration.')

def fit(rows,x,y,weights,cfg,seed=7919,split_seed=20261104):
    tr,va=d.inner_split(rows,y,split_seed)
    if cfg['family'] in ['knn','rbf']:
        warm=fit_simple([rows[i] for i in tr],x[tr],y[tr],weights[tr],cfg,seed)
        model=fit_simple(rows,x,y,weights,cfg,seed)
        model['decoderData']={'ids':[rows[i]['id'] for i in va],'targets':y[va],
            'probabilities':probabilities(warm,x[va]),'trainingIds':[rows[i]['id'] for i in tr]}
        return model
    warm=fit_mlp(x[tr],y[tr],weights[tr],cfg,seed,monitor=(x[va],y[va]))
    model=fit_mlp(x,y,weights,cfg,seed,epochs=warm['optimizer']['selectedEpoch'])
    model['optimizer']['innerStop']=warm['optimizer'];model['optimizer']['innerMonitorIds']=[rows[i]['id'] for i in va]
    model['optimizer']['innerTrainingRowCount']=len(tr)
    model['decoderData']={'ids':[rows[i]['id'] for i in va],'targets':y[va],
        'probabilities':probabilities(warm,x[va]),'trainingIds':[rows[i]['id'] for i in tr]}
    return model

def serializable(value):
    if isinstance(value,np.ndarray):return value.tolist()
    if isinstance(value,dict):return {k:serializable(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [serializable(v) for v in value]
    return value

def restore(value):
    model=dict(value)
    if model['family'] in ['mlp','powerset']:
        for k in ['mean','scale']:model[k]=np.array(model[k])
        model['layers']=[(np.array(w),np.array(b)) for w,b in model['layers']]
    elif model['family']=='rbf':
        model['centers']=np.array(model['centers']);head=dict(model['head'])
        for k in ['mean','scale']:head[k]=np.array(head[k])
        head['layers']=[(np.array(w),np.array(b)) for w,b in head['layers']];model['head']=head
    else:
        for k in ['centers','targets','sampleWeights']:model[k]=np.array(model[k])
    return model

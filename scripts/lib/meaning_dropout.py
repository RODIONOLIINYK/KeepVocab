"""Weighted multilabel MLP: inverted hidden dropout and coupled-L2 Adam.

Dropout is a training operation only. Exported layers use the existing dense
tanh/sigmoid portable inference implementation without masks or extra weights.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('meaning_regularization_dropout', ROOT / 'scripts/lib/meaning_regularization.py')
reg = importlib.util.module_from_spec(spec); spec.loader.exec_module(reg)
t, np = reg.t, reg.np


def class_weights(y, sample_weight, power):
    prevalence = np.clip(np.average(y, axis=0, weights=sample_weight), 1e-6, 1-1e-6)
    return np.clip(((1-prevalence)/prevalence)**power, .2, 8)


def inverted_mask(rng, shape, rate):
    if not 0 <= rate < 1: raise ValueError('Dropout rate must be in [0, 1).')
    return (rng.random(shape) >= rate).astype(float)/(1-rate)


def objective(theta, x, y, hidden, l2, positive, sample_weight, mask=None, normalizer=None):
    (w1,b1),(w2,b2) = t.unpack(theta,x.shape[1],hidden)
    h = np.tanh(x@w1+b1)
    dropped = h if mask is None else h*mask
    logits = dropped@w2+b2
    weights = sample_weight[:,None]*(1+y*(positive-1))
    normalizer = float(weights.sum()) if normalizer is None else normalizer
    loss = float(np.sum(weights*(np.logaddexp(0,logits)-y*logits))/normalizer)
    loss += l2*float(np.sum(w1*w1)+np.sum(w2*w2))/2
    delta = (t.sigmoid(logits)-y)*weights/normalizer
    gw2 = dropped.T@delta+l2*w2; gb2 = delta.sum(axis=0)
    dh = delta@w2.T
    if mask is not None: dh *= mask
    dh *= 1-h*h
    return loss,np.r_[(x.T@dh+l2*w1).ravel(),dh.sum(axis=0),gw2.ravel(),gb2]


def prepare(x, y, config, seed, sample_weight):
    sample_weight = np.asarray(sample_weight,dtype=float)
    if sample_weight.shape != (len(y),) or not np.isfinite(sample_weight).all() or np.any(sample_weight<=0):
        raise ValueError('Expected finite positive weights, one per training row.')
    if not len(x) or not np.isfinite(x).all() or not np.isin(y,[0,1]).all(): raise ValueError('Invalid training data.')
    if config['hidden'] <= 0 or config['l2'] < 0 or not 0 <= config['dropout'] < 1:
        raise ValueError('Invalid architecture/regularization.')
    mean = np.average(x,axis=0,weights=sample_weight)
    scale = np.maximum(np.sqrt(np.average((x-mean)**2,axis=0,weights=sample_weight)),.01)
    xx = np.ascontiguousarray((x-mean)/scale)
    theta = reg.initial_theta(x,y,config['hidden'],seed,sample_weight)
    positive = class_weights(y,sample_weight,config['weightPower'])
    weight_per_example = float(np.sum(sample_weight[:,None]*(1+y*(positive-1)))/len(y))
    return mean,scale,xx,theta,positive,weight_per_example


def fit(x,y,config,seed=7919,sample_weight=None,monitor=None,epochs=None):
    """Either pick epochs with an inner monitor or refit all rows for fixed epochs.

    An outer CV fold must never be supplied as the monitor. The caller first
    holds out groups from its training portion, selects an epoch, then refits on
    that entire training portion before scoring the untouched outer fold.
    """
    sample_weight = np.ones(len(y)) if sample_weight is None else np.asarray(sample_weight,dtype=float)
    mean,scale,xx,theta,positive,weight_per_example = prepare(x,y,config,seed,sample_weight)
    if epochs is None and monitor is None: raise ValueError('Provide an inner monitor or fixed epoch count.')
    if epochs is not None and monitor is not None: raise ValueError('Fixed refits must not monitor held-out scores.')
    limit = int(epochs if epochs is not None else config.get('maxEpochs',400))
    if limit<1: raise ValueError('At least one epoch is required.')
    order_rng = np.random.default_rng(seed+17011); mask_rng = np.random.default_rng(seed+29009)
    moment = np.zeros_like(theta); variance = np.zeros_like(theta); step = 0
    best_loss = float('inf'); best_epoch = 0; trace = []
    rate = float(config['learningRate']); hidden = int(config['hidden']); batch_size = int(config.get('batchSize',64))
    if rate<=0 or batch_size<1: raise ValueError('Invalid Adam settings.')
    best_theta = theta.copy()
    for epoch in range(1,limit+1):
        order = order_rng.permutation(len(y))
        for start in range(0,len(y),batch_size):
            ix = order[start:start+batch_size]
            mask = inverted_mask(mask_rng,(len(ix),hidden),config['dropout']) if config['dropout'] else None
            loss,gradient = objective(theta,xx[ix],y[ix],hidden,config['l2'],positive,sample_weight[ix],
                                      mask,normalizer=len(ix)*weight_per_example)
            step += 1
            moment = .9*moment+.1*gradient; variance = .999*variance+.001*gradient*gradient
            theta -= rate*(moment/(1-.9**step))/(np.sqrt(variance/(1-.999**step))+1e-8)
            if not np.isfinite(theta).all(): raise ValueError('Non-finite Adam parameters.')
        if monitor is not None and (epoch%5==0 or epoch==limit):
            mx,my = monitor
            model = {'mean':mean,'scale':scale,'layers':t.unpack(theta,x.shape[1],hidden)}
            pp = t.predict(model,mx)
            clipped = np.clip(pp,1e-12,1-1e-12)
            val_loss = float(-np.mean(my*np.log(clipped)+(1-my)*np.log1p(-clipped)))
            trace.append({'epoch':epoch,'unweightedMonitorBCE':val_loss})
            if val_loss < best_loss-config.get('minDelta',1e-4):
                best_loss,best_epoch,best_theta = val_loss,epoch,theta.copy()
            if epoch>=config.get('minEpochs',30) and epoch-best_epoch>=config.get('patience',35): break
    if monitor is not None: theta = best_theta
    else: best_epoch = limit
    fitted = {'mean':mean,'scale':scale,'layers':t.unpack(theta,x.shape[1],hidden),
      'optimizer':{'algorithm':'Adam with coupled weight-only L2','beta1':.9,'beta2':.999,'epsilon':1e-8,
        'epochsExecuted':epoch,'selectedEpoch':best_epoch,'steps':step,'learningRate':rate,'batchSize':batch_size,
        'dropoutRate':config['dropout'],'dropoutAtInference':False,'earlyStopping':monitor is not None,
        'monitorObjective':'unweighted BCE, dropout disabled' if monitor is not None else None,
        'monitorTrace':trace,'stoppedAtEpochLimit':epoch==limit}}
    return fitted


def inner_split(rows,y,seed):
    """Hold out connected original-meaning groups; keep their paraphrases too."""
    core = np.asarray([i for i,r in enumerate(rows) if r.get('kind')!='paraphrase'])
    groups = np.asarray([r['groupId'] for r in rows])
    train,monitor = t.group_folds(y[core],groups[core],seed,count=5)[0]
    training_groups = set(groups[core[train]]); monitor_groups = set(groups[core[monitor]])
    assert not training_groups&monitor_groups
    tr = np.flatnonzero(np.isin(groups,list(training_groups)))
    # Stop on natural originals once each, not on their augmented paraphrases.
    va = core[monitor]
    assert not set(groups[tr])&set(groups[va])
    return tr,va


def fit_with_inner_stop(rows,x,y,weights,config,seed=7919,split_seed=20261101):
    tr,va = inner_split(rows,y,split_seed)
    warm = fit(x[tr],y[tr],config,seed,weights[tr],monitor=(x[va],y[va]))
    epoch = warm['optimizer']['selectedEpoch']
    model = fit(x,y,config,seed,weights,epochs=epoch)
    model['optimizer']['innerStop'] = warm['optimizer']
    model['optimizer']['innerMonitorIds'] = [rows[i]['id'] for i in va]
    model['optimizer']['innerTrainingRowCount'] = len(tr)
    return model

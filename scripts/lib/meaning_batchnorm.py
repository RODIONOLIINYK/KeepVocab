"""Small fixed-embedding MLP with matched Adam and optional hidden BatchNorm.

BN uses training mini-batch statistics and exponential running statistics only.
At inference its affine transform is folded into the preceding dense layer.
No BN runtime, mini-batch dependency or extra mobile parameters are needed.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('normalization_dropout_helpers', ROOT / 'scripts/lib/meaning_dropout.py')
d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
t, np, reg = d.t, d.np, d.reg


def initial(x, y, cfg, seed, weights):
    theta = reg.initial_theta(x, y, cfg['hidden'], seed, weights)
    if cfg['batchNorm']:
        theta = np.r_[theta, np.ones(cfg['hidden']), np.zeros(cfg['hidden'])]
    return theta


def dense_size(dimension, hidden):
    return dimension * hidden + hidden + hidden * 6 + 6


def unpack(theta, dimension, hidden):
    count = dense_size(dimension, hidden)
    return t.unpack(theta[:count], dimension, hidden), theta[count:count+hidden], theta[count+hidden:]


def objective(theta, x, y, cfg, positive, weights, normalizer=None):
    """Training forward/backward; returns batch stats without mutating any state."""
    hidden = cfg['hidden']; (w1, b1), (w2, b2) = unpack(theta, x.shape[1], hidden)[0]
    z = x @ w1 + b1
    stats = None
    if cfg['batchNorm']:
        _, gamma, beta = unpack(theta, x.shape[1], hidden)
        mu, var = z.mean(axis=0), z.var(axis=0)
        inv = 1 / np.sqrt(var + cfg.get('epsilon', 1e-5))
        normalized = (z-mu)*inv
        activation = normalized*gamma+beta
        stats = (mu, var)
    else:
        activation = z
    h = np.tanh(activation); logits = h @ w2 + b2
    cell_weights = weights[:, None]*(1+y*(positive-1))
    denom = float(cell_weights.sum()) if normalizer is None else normalizer
    loss = float(np.sum(cell_weights*(np.logaddexp(0, logits)-y*logits))/denom)
    loss += cfg['l2']*float(np.sum(w1*w1)+np.sum(w2*w2))/2
    delta = (t.sigmoid(logits)-y)*cell_weights/denom
    gw2 = h.T @ delta + cfg['l2']*w2; gb2 = delta.sum(axis=0)
    dh = (delta @ w2.T)*(1-h*h)
    if cfg['batchNorm']:
        ggamma = (dh*normalized).sum(axis=0); gbeta = dh.sum(axis=0)
        dn = dh*gamma
        dh = inv*(dn-dn.mean(axis=0)-normalized*(dn*normalized).mean(axis=0))
    gradient = np.r_[(x.T @ dh+cfg['l2']*w1).ravel(), dh.sum(axis=0), gw2.ravel(), gb2]
    if cfg['batchNorm']:
        gradient = np.r_[gradient, ggamma, gbeta]
    return loss, gradient, stats


def inference_model(theta, mean, scale, cfg, running_mean, running_var):
    layers, gamma, beta = unpack(theta, len(mean), cfg['hidden'])
    layers = [(w.copy(), b.copy()) for w, b in layers]
    if cfg['batchNorm']:
        affine = gamma / np.sqrt(running_var+cfg.get('epsilon', 1e-5))
        w, b = layers[0]
        layers[0] = (w*affine, (b-running_mean)*affine+beta)
    return {'mean':mean.copy(), 'scale':scale.copy(), 'layers':layers}


def fit(x, y, cfg, seed=7919, sample_weight=None, monitor=None, epochs=None):
    if (monitor is None) == (epochs is None):
        raise ValueError('Provide exactly one of inner monitor and fixed epochs.')
    if cfg['hidden'] < 1 or cfg['batchSize'] < 2 or cfg['learningRate'] <= 0 or cfg['l2'] < 0:
        raise ValueError('Invalid training settings.')
    if cfg.get('epsilon',1e-5) <= 0 or not 0 < cfg.get('momentum',.1) <= 1:
        raise ValueError('Invalid BatchNorm settings.')
    weights = np.ones(len(y)) if sample_weight is None else np.asarray(sample_weight, dtype=float)
    if weights.shape != (len(y),) or np.any(weights <= 0) or not np.isfinite(weights).all():
        raise ValueError('Expected finite positive row weights.')
    if len(x) < 2 or not np.isfinite(x).all() or not np.isin(y,[0,1]).all():
        raise ValueError('Invalid training data.')
    mean = np.average(x, axis=0, weights=weights)
    scale = (np.maximum(np.sqrt(np.average((x-mean)**2,axis=0,weights=weights)),.01)
             if cfg['preprocess']=='standardize' else np.full(x.shape[1],1/np.sqrt(x.shape[1])))
    xx = np.ascontiguousarray((x-mean)/scale)
    theta = initial(x,y,cfg,seed,weights)
    positive = d.class_weights(y,weights,cfg['weightPower'])
    weight_per_row = float(np.sum(weights[:,None]*(1+y*(positive-1)))/len(y))
    running_mean = np.zeros(cfg['hidden']); running_var = np.ones(cfg['hidden'])
    order_rng = np.random.default_rng(seed+17011)
    first = np.zeros_like(theta); second = np.zeros_like(theta); step = 0
    best_loss = float('inf'); best_epoch = 0; trace = []
    limit = int(epochs if epochs is not None else cfg['maxEpochs'])
    if limit < 1: raise ValueError('At least one epoch is required.')
    best = None
    for epoch in range(1,limit+1):
        # array_split avoids a singleton tail, for which BN variance is zero.
        count = max(1,min(int(np.ceil(len(y)/cfg['batchSize'])),len(y)//2))
        batches = np.array_split(order_rng.permutation(len(y)), count)
        for ix in batches:
            _, grad, stats = objective(theta,xx[ix],y[ix],cfg,positive,weights[ix],len(ix)*weight_per_row)
            if stats is not None:
                momentum = cfg.get('momentum',.1); mu,var = stats
                running_mean = (1-momentum)*running_mean+momentum*mu
                running_var = (1-momentum)*running_var+momentum*var*len(ix)/(len(ix)-1)
            step += 1; first = .9*first+.1*grad; second = .999*second+.001*grad*grad
            theta -= cfg['learningRate']*(first/(1-.9**step))/(np.sqrt(second/(1-.999**step))+1e-8)
            if not np.isfinite(theta).all(): raise ValueError('Non-finite parameters.')
        if monitor is not None and (epoch%5==0 or epoch==limit):
            model = inference_model(theta,mean,scale,cfg,running_mean,running_var)
            pp = np.clip(t.predict(model,monitor[0]),1e-12,1-1e-12)
            loss = float(-np.mean(monitor[1]*np.log(pp)+(1-monitor[1])*np.log1p(-pp)))
            tp = np.clip(t.predict(model,x),1e-12,1-1e-12)
            train_loss = float(-np.mean(y*np.log(tp)+(1-y)*np.log1p(-tp)))
            trace.append({'epoch':epoch,'monitorBCE':loss,'trainBCE':train_loss})
            if loss < best_loss-cfg.get('minDelta',1e-4):
                best_loss,best_epoch = loss,epoch
                best = theta.copy(),running_mean.copy(),running_var.copy()
            if epoch>=cfg.get('minEpochs',30) and epoch-best_epoch>=cfg.get('patience',30): break
    if monitor is not None:
        theta,running_mean,running_var = best
    else:
        best_epoch = limit
    result = inference_model(theta,mean,scale,cfg,running_mean,running_var)
    result['optimizer'] = {'algorithm':'Adam coupled weight-only L2','batchNorm':cfg['batchNorm'],
        'epochsExecuted':epoch,'selectedEpoch':best_epoch,'steps':step,
        'earlyStopping':monitor is not None,'stoppedAtEpochLimit':epoch==limit,
        'monitorTrace':trace,'batchSize':cfg['batchSize'],'learningRate':cfg['learningRate']}
    result['normalization'] = {'type':'batch' if cfg['batchNorm'] else 'none','foldedIntoDense':cfg['batchNorm'],
        'epsilon':cfg.get('epsilon',1e-5),'momentum':cfg.get('momentum',.1),
        'runningMean':running_mean.tolist() if cfg['batchNorm'] else [],
        'runningVariance':running_var.tolist() if cfg['batchNorm'] else [],
        'statisticsFitScope':'training mini-batches only; no monitor/outer validation/test updates',
        'trainingStatistics':'uniform row mini-batches; row weights affect BCE, not batch moments',
        'gammaBetaPenalized':False}
    return result


def fit_with_inner_stop(rows,x,y,weights,cfg,seed=7919,split_seed=20261103):
    tr,va = d.inner_split(rows,y,split_seed)
    warm = fit(x[tr],y[tr],cfg,seed,weights[tr],monitor=(x[va],y[va]))
    model = fit(x,y,cfg,seed,weights,epochs=warm['optimizer']['selectedEpoch'])
    model['optimizer']['innerStop'] = warm['optimizer']
    model['optimizer']['innerMonitorIds'] = [rows[i]['id'] for i in va]
    model['optimizer']['innerTrainingRowCount'] = len(tr)
    return model

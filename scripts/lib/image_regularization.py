"""Vectorized research fitter: unchanged MLP, optional true L2 and hidden BatchNorm.

The existing application fitter is preserved. Research results are not activated.
Dense-only gradients/updates are checked against it before experiments run.
"""
import base64
import copy
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np

LAYERS = [(1539, 32), (32, 16), (16, 1)]


def read(path):
    path = Path(path)
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (json.dumps(value, default=lambda a: a.tolist() if isinstance(a, np.ndarray) else a.item(), indent=2)+'\n').encode()
    path.write_bytes(gzip.compress(text, mtime=0) if path.suffix == '.gz' else text)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def vector(value):
    if not value.startswith('f32:'):
        raise ValueError('Only current Float32 features accepted')
    return np.frombuffer(base64.b64decode(value[4:]), dtype='<f4')


def load_data(plan):
    manifest, encoded = read(plan['sourceManifest']), read(plan['sourceFeatures'])
    for item in plan['preservation']:
        if digest(item['path']) != item['sha256']:
            raise ValueError('Preserved data changed: '+item['path'])
    events = {}
    for row in encoded['events']:
        events.setdefault(row['decisionId'], []).append(row)
    data = {}
    for c in manifest['cases']:
        pairs = events[c['id']]
        features = {row['context']['imageUrl']: vector(row['features']) for row in pairs}
        features[pairs[0]['context']['preferredUrl']] = vector(pairs[0]['preferredFeatures'])
        image = np.asarray([features[p['url']] for p in c['candidates']], dtype=np.float32)
        meaning = vector(pairs[0]['meaningFeatures'])[:512]
        x = np.concatenate([image[:, :512], np.broadcast_to(meaning, (len(image), 512)), image[:, :512]*meaning, image[:, 512:]], axis=1)
        base = image[:, 512].astype(float)+.6*image[:, 513].astype(float)-.25*np.maximum(0, image[:, 514].astype(float))
        data[c['id']] = {'id': c['id'], 'meaningId': c['meaningId'], 'x': x, 'base': base,
                         'reference': next(i for i, p in enumerate(c['candidates']) if p['id'] == c['feedback']['selected'][0]),
                         'keys': [c['meaningId']+'|'+p['sha256'] for p in c['candidates']]}
    return data, encoded['encoder']


def assemble(data, ids):
    """One forward row per distinct photo AND target meaning, not per pair."""
    unique, xs, bases, galleries = {}, [], [], []
    for cid in ids:
        item = data[cid]
        indices = []
        for i, key in enumerate(item['keys']):
            if key not in unique:
                unique[key] = len(xs); xs.append(item['x'][i]); bases.append(item['base'][i])
            index = unique[key]
            if not np.array_equal(xs[index], item['x'][i]) or bases[index] != item['base'][i]:
                raise ValueError('Conflicting features for a photo/meaning')
            indices.append(index)
        galleries.append({'id': cid, 'meaningId': item['meaningId'], 'indices': indices, 'reference': item['reference']})
    return {'x': np.asarray(xs), 'base': np.asarray(bases), 'galleries': galleries}


class Model:
    def __init__(self, weights, batch_norm=False, epsilon=1e-5, momentum=.1, dtype=np.float32):
        self.dtype, self.batch_norm, self.epsilon, self.momentum = dtype, batch_norm, epsilon, momentum
        self.p, self.running = {}, {}
        offset = 0
        for layer, (nin, nout) in enumerate(LAYERS):
            self.p[f'w{layer}'] = np.asarray(weights[offset:offset+nin*nout], dtype=dtype).reshape(nout, nin).copy()
            self.p[f'b{layer}'] = np.asarray(weights[offset+nin*nout:offset+nin*nout+nout], dtype=dtype).copy()
            offset += nin*nout+nout
            if batch_norm and layer < 2:
                self.p[f'g{layer}'] = np.ones(nout, dtype=dtype)
                self.p[f't{layer}'] = np.zeros(nout, dtype=dtype)
                self.running[f'm{layer}'] = np.zeros(nout, dtype=float)
                self.running[f'v{layer}'] = np.ones(nout, dtype=float)

    def clone(self):
        return copy.deepcopy(self)

    def calibrate_identity(self, x):
        """Train-only stats and gamma/beta give the same initial inference function.

        This controls initial CLIP agreement; gamma and beta remain trainable.
        """
        a = x
        for layer in range(2):
            z = (a.astype(float) @ self.p[f'w{layer}'].astype(float).T+self.p[f'b{layer}']).astype(self.dtype)
            mean, var = z.astype(float).mean(0), z.astype(float).var(0, ddof=1)
            self.running[f'm{layer}'], self.running[f'v{layer}'] = mean, var
            self.p[f'g{layer}'] = np.sqrt(var+self.epsilon).astype(self.dtype)
            self.p[f't{layer}'] = mean.astype(self.dtype)
            a = np.maximum(((z-mean)/np.sqrt(var+self.epsilon)*self.p[f'g{layer}']+self.p[f't{layer}']).astype(self.dtype), 0)

    def forward(self, x, training=False, update=False):
        a, cache = x, []
        for layer in range(3):
            z = (a.astype(float) @ self.p[f'w{layer}'].astype(float).T+self.p[f'b{layer}']).astype(self.dtype)
            item = {'input': a, 'z': z}
            if self.batch_norm and layer < 2:
                if training:
                    mean, var = z.astype(float).mean(0), z.astype(float).var(0)
                    if update:
                        n = len(z)
                        self.running[f'm{layer}'] = (1-self.momentum)*self.running[f'm{layer}']+self.momentum*mean
                        self.running[f'v{layer}'] = (1-self.momentum)*self.running[f'v{layer}']+self.momentum*var*n/(n-1)
                else:
                    mean, var = self.running[f'm{layer}'], self.running[f'v{layer}']
                inv = 1/np.sqrt(var+self.epsilon)
                normalized = (z.astype(float)-mean)*inv
                pre = (normalized*self.p[f'g{layer}']+self.p[f't{layer}']).astype(self.dtype)
                item.update({'normalized': normalized, 'inv': inv})
            else:
                pre = z
            item['pre'] = pre
            a = pre if layer == 2 else np.maximum(pre, 0)
            cache.append(item)
        return a[:, 0].astype(float), cache

    def backward(self, cache, output):
        delta, gradient = np.asarray(output, dtype=self.dtype)[:, None], {}
        for layer in reversed(range(3)):
            item = cache[layer]
            if layer < 2:
                delta = np.where(item['pre'] > 0, delta, 0)
                if self.batch_norm:
                    gradient[f'g{layer}'] = np.sum(delta*item['normalized'], axis=0).astype(self.dtype)
                    gradient[f't{layer}'] = np.sum(delta.astype(float), axis=0).astype(self.dtype)
                    dy = delta*self.p[f'g{layer}']
                    delta = (item['inv']*(dy-dy.mean(0)-item['normalized']*(dy*item['normalized']).mean(0))).astype(self.dtype)
            gradient[f'w{layer}'] = (delta.astype(float).T @ item['input'].astype(float)).astype(self.dtype)
            gradient[f'b{layer}'] = delta.astype(float).sum(0).astype(self.dtype)
            if layer:
                delta = (delta.astype(float) @ self.p[f'w{layer}'].astype(float)).astype(self.dtype)
        return gradient

    def backward_pairs(self, cache, indices, derivatives):
        # Match the production Float32 accumulation order for non-BN controls.
        # Adam can amplify 1e-8 cancellation differences, so a BLAS sum of
        # deduplicated derivatives is not an exact substitute here.
        gradient = {k: np.zeros_like(v) for k, v in self.p.items()}
        for index, derivative in zip(indices, derivatives):
            delta = np.asarray([derivative], dtype=self.dtype)
            for layer in reversed(range(3)):
                item = cache[layer]
                gradient[f'b{layer}'] += delta
                gradient[f'w{layer}'][:] = gradient[f'w{layer}'].astype(float)+np.outer(delta.astype(float), item['input'][index].astype(float))
                if layer:
                    previous = np.zeros(LAYERS[layer][0], dtype=self.dtype)
                    for j, value in enumerate(delta):
                        previous[:] = previous.astype(float)+float(value)*self.p[f'w{layer}'][j].astype(float)
                    delta = np.where(item['input'][index] > 0, previous, 0)
        return gradient

    def regularization(self, strength):
        return .5*strength*sum(float(np.sum(v.astype(float)**2)) for k, v in self.p.items() if k.startswith('w'))

    def gradient(self, batch, strength=0, update=False):
        raw, cache = self.forward(batch['x'], training=self.batch_norm, update=update)
        scores = .5*batch['base']+.5*raw
        derivative, loss, pair_indices, pair_derivatives = np.zeros(len(scores)), 0., [], []
        for gallery in batch['galleries']:
            indices = gallery['indices']; a = indices[gallery['reference']]
            others = [i for j, i in enumerate(indices) if j != gallery['reference']]
            z = 8*(scores[a]-scores[others])
            p = 1/(1+np.exp(-np.clip(z, -30, 30)))
            weight = 1/len(others)/len(batch['galleries'])
            loss -= float(np.log(np.maximum(1e-8, p)).sum())*weight
            error = (p-1)*8*.5*weight
            derivative[a] += error.sum()
            np.add.at(derivative, others, -error)
            for i, value in zip(others, error):
                pair_indices.extend([a, i]); pair_derivatives.extend([value, -value])
        gradients = self.backward(cache, derivative) if self.batch_norm else self.backward_pairs(cache, pair_indices, pair_derivatives)
        for key, value in self.p.items():
            if key.startswith('w'):
                gradients[key] = (gradients[key].astype(float)+strength*value).astype(self.dtype)
        return loss+self.regularization(strength), gradients, cache

    def packed(self, folded=False):
        values = []
        for layer in range(3):
            w, b = self.p[f'w{layer}'], self.p[f'b{layer}']
            if folded and self.batch_norm and layer < 2:
                scale = self.p[f'g{layer}']/np.sqrt(self.running[f'v{layer}']+self.epsilon)
                w = (scale[:, None]*w).astype(np.float32)
                b = ((b-self.running[f'm{layer}'])*scale+self.p[f't{layer}']).astype(np.float32)
            values.extend([w.reshape(-1), b])
        return np.concatenate(values).astype(np.float32)

    def state(self):
        return {'batchNorm': self.batch_norm, 'epsilon': self.epsilon, 'momentum': self.momentum,
                'parameters': self.p, 'running': self.running}


def metrics(model, batch, rows=False):
    raw, _ = model.forward(batch['x'])
    score, details = .5*batch['base']+.5*raw, []
    for gallery in batch['galleries']:
        indices, ref = gallery['indices'], gallery['reference']
        s = score[indices]; other = [i for i in range(len(indices)) if i != ref]
        z = 8*(s[ref]-s[other]); probability = 1/(1+np.exp(-np.clip(z, -30, 30)))
        logits = 8*s; maximum = max(logits)
        details.append({'id': gallery['id'], 'meaningId': gallery['meaningId'],
                        'chosenAt1': int(np.argmax(s) == ref), 'loss': float(-np.log(np.maximum(1e-8, probability)).mean()),
                        'galleryCrossEntropy': float(maximum+np.log(np.exp(logits-maximum).sum())-logits[ref]),
                        'pairwiseAccuracy': float(np.mean(z > 0)), 'brier': float(np.mean((1-probability)**2))})
    result = {key: float(np.mean([r[key] for r in details])) for key in ['loss', 'galleryCrossEntropy', 'pairwiseAccuracy', 'brier']}
    result.update({'choices': len(details), 'chosenAt1': sum(r['chosenAt1'] for r in details),
                   'rankingError': 1-np.mean([r['chosenAt1'] for r in details])})
    if rows:
        result['rows'] = details
    return result


def fit(initial, data, train_ids, validation_ids, recipe, strength, epochs=None, progress=None, snapshot=None):
    """Identical numerical path for full and tiny runs. No patience stopping."""
    model = initial.clone()
    train, validation = assemble(data, train_ids), assemble(data, validation_ids)
    momentum = {k: np.zeros_like(v) for k, v in model.p.items()}
    variance = {k: np.zeros_like(v) for k, v in model.p.items()}
    curve, selected, selected_epoch, best = [], None, 0, None
    step, clipped, max_norm = 0, 0, 0.
    for epoch in range((epochs or recipe['epochs'])+1):
        if epoch:
            rotation = (epoch-1) % len(train_ids)
            ordered, offset = train_ids[rotation:]+train_ids[:rotation], 0
            while offset < len(ordered):
                remaining, size = len(ordered)-offset, recipe['batchSize']
                end = len(ordered) if size < remaining < size+int(np.ceil(size/2)) else min(len(ordered), offset+size)
                batch = assemble(data, ordered[offset:end]); offset = end
                _, gradient, _ = model.gradient(batch, strength, update=True)
                norm = np.sqrt(sum(float(np.sum(g.astype(float)**2)) for g in gradient.values()))
                if not np.isfinite(norm):
                    raise ValueError('Nonfinite gradient')
                max_norm = max(max_norm, norm); scale = min(1, recipe['maximumGradientNorm']/max(norm, 1e-30))
                clipped += int(scale < 1); step += 1
                for key in model.p:
                    g = gradient[key].astype(float)*scale
                    momentum[key] = (.9*momentum[key].astype(float)+.1*g).astype(np.float32)
                    variance[key] = (.999*variance[key].astype(float)+.001*g*g).astype(np.float32)
                    model.p[key] = (model.p[key].astype(float)-recipe['learningRate']*(momentum[key].astype(float)/(1-.9**step))/(np.sqrt(variance[key].astype(float)/(1-.999**step))+1e-8)).astype(np.float32)
        tr, va = metrics(model, train), metrics(model, validation)
        item = {'epoch': epoch, 'train': tr, 'validation': va, 'regularizationPenalty': model.regularization(strength),
                'maximumGradientNorm': max_norm, 'clippedSteps': clipped}
        curve.append(item)
        if best is None or va['chosenAt1'] > best[0] or va['chosenAt1'] == best[0] and va['loss'] < best[1]-1e-12:
            best = (va['chosenAt1'], va['loss']); selected = model.clone(); selected_epoch = epoch
        if snapshot:
            snapshot(epoch, model)
        if progress and epoch % 50 == 0:
            progress(item)
    return {'model': model, 'selected': selected, 'selectedEpoch': selected_epoch, 'curve': curve, 'steps': step,
            'clippedSteps': clipped, 'maximumGradientNorm': max_norm, 'epochsRun': len(curve)-1, 'stoppedBy': 'fixed-epochs'}

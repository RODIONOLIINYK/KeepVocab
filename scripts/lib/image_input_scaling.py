"""Train-fitted MLP input standardization; the frozen CLIP branch is untouched."""
import numpy as np
from .image_regularization import Model, assemble


class ScaledModel(Model):
    def __init__(self, weights, mean, scale, dtype=np.float32):
        super().__init__(weights, batch_norm=False, dtype=dtype)
        self.mean, self.scale = np.asarray(mean, dtype=float), np.asarray(scale, dtype=float)
        original = self.p['w0'].astype(float)
        # Reparameterize so preprocessing does not change the initial function.
        self.p['w0'] = (original*self.scale).astype(dtype)
        self.p['b0'] = (self.p['b0']+original@self.mean).astype(dtype)

    def forward(self, x, training=False, update=False):
        normalized = ((x.astype(float)-self.mean)/self.scale).astype(self.dtype)
        return super().forward(normalized, training, update)

    def packed(self, folded=False):
        if not folded:
            return super().packed()
        model = self.clone()
        raw = self.p['w0'].astype(float)/self.scale
        model.p['w0'] = raw.astype(np.float32)
        model.p['b0'] = (self.p['b0']-raw@self.mean).astype(np.float32)
        return Model.packed(model)

    def state(self):
        return {**super().state(), 'inputNormalization': {'mean': self.mean, 'scale': self.scale}}


def calibration(data, ids, floor=.001):
    x = assemble(data, ids)['x'].astype(float)
    return {'mean': x.mean(0), 'scale': np.maximum(x.std(0), floor), 'minimumStd': floor,
            'fitIds': ids, 'uniqueTrainingPhotoMeanings': len(x),
            'method': 'Per-feature training-only centering and standard deviation; no example-wise normalization.'}


def restore(state):
    norm = state['inputNormalization']
    model = ScaledModel([0]*49825, norm['mean'], norm['scale'])
    model.p = {k: np.asarray(v, dtype=np.float32) for k, v in state['parameters'].items()}
    return model

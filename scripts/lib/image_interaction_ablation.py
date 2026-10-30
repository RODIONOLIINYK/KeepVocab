"""Physically remove the512explicit image×meaning coordinates from the MLP."""
import numpy as np
from .image_regularization import Model

ACTIVE = np.asarray(list(range(1024))+[1536,1537,1538])


class AblatedModel(Model):
    def __init__(self, weights, batch_norm=False, dtype=np.float32):
        super().__init__(weights, batch_norm=batch_norm, dtype=dtype)
        self.p['w0'] = self.p['w0'][:, ACTIVE].copy()

    def forward(self, x, training=False, update=False):
        return super().forward(x[:, ACTIVE], training, update)

    def calibrate_identity(self, x):
        return super().calibrate_identity(x[:, ACTIVE])

    def state(self):
        return {**super().state(), 'inputIndices': ACTIVE.tolist()}

    def packed(self, folded=False):
        if not folded:
            return super().packed()
        # Expand zero columns only for the unchanged runtime scorer. Native
        # training has1027inputs and33441dense parameters.
        compact = super().packed(folded=True)
        w0, b0 = compact[:1027*32].reshape(32,1027), compact[1027*32:1027*32+32]
        expanded=np.zeros((32,1539),dtype=np.float32);expanded[:,ACTIVE]=w0
        return np.concatenate([expanded.reshape(-1),b0,compact[1027*32+32:]])


def restore(state):
    model=AblatedModel([0]*49825,state['batchNorm'])
    model.p={k:np.asarray(v,dtype=np.float32) for k,v in state['parameters'].items()}
    model.running={k:np.asarray(v,dtype=float) for k,v in state['running'].items()}
    model.epsilon,state_momentum=state['epsilon'],state['momentum'];model.momentum=state_momentum
    return model

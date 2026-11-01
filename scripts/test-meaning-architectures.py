#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('architectures',Path(__file__).parent/'lib/meaning_architectures.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
np=a.np

def config(**changes):
    cfg={'family':'mlp','widths':[4,3],'activation':'tanh','l2':.01,'weightPower':.5,
        'smoothing':0.,'focalGamma':0.,'preprocess':'standardize','learningRate':.01,
        'batchSize':16,'maxEpochs':150,'minEpochs':20,'patience':20,'schedule':'constant'}
    return {**cfg,**changes}

class ArchitectureTests(unittest.TestCase):
    def test_numerical_gradients_all_activations_focal_smoothing_and_joint_labels(self):
        rng=np.random.default_rng(401);x=rng.normal(size=(8,3));y=(rng.random((8,6))>.65).astype(float);w=np.linspace(.5,1,8)
        cases=[config(activation=k) for k in ['tanh','relu','silu']]+[config(focalGamma=2.),config(smoothing=.05),config(family='powerset',widths=[3],smoothing=.02)]
        for cfg in cases:
            layers=a.initialize(x,y,w,cfg,7919);positive=a.d.class_weights(y,w,.5)
            # Central differences are undefined at an exact ReLU kink.
            for _,bias in layers:bias[:]+=rng.normal(0,.2,size=bias.shape)
            _,grad=a.loss_gradient(layers,x,y,w,cfg,positive)
            for li,layer in enumerate(layers):
                for j,array in enumerate(layer):
                    for ix in np.ndindex(array.shape):
                        original=array[ix];array[ix]=original+1e-6;plus=a.loss_gradient(layers,x,y,w,cfg,positive)[0]
                        array[ix]=original-1e-6;minus=a.loss_gradient(layers,x,y,w,cfg,positive)[0];array[ix]=original
                        self.assertAlmostEqual((plus-minus)/2e-6,grad[li][j][ix],places=7,msg=str(cfg))

    def test_joint_probabilities_keep_all_six_marginals(self):
        rng=np.random.default_rng(402);joint=a.softmax(rng.normal(size=(9,64)))
        marginals=joint@a.PATTERNS
        for k in range(6):np.testing.assert_allclose(marginals[:,k],joint[:,a.PATTERNS[:,k]==1].sum(axis=1))
        self.assertTrue(((marginals>0)&(marginals<1)).all())

    def test_deep_binary_and_joint_models_overfit_tiny_batch_and_repeat(self):
        rng=np.random.default_rng(403);x=rng.normal(size=(12,6));y=(rng.random((12,6))>.65).astype(float);w=np.ones(12)
        for family in ['mlp','powerset']:
            cfg=config(family=family,widths=[32,16],l2=0.,weightPower=0.,learningRate=.02)
            model=a.fit_mlp(x,y,w,cfg,7919,epochs=400);again=a.fit_mlp(x,y,w,cfg,7919,epochs=400)
            p=a.probabilities(model,x);np.testing.assert_array_equal(p,a.probabilities(again,x))
            self.assertEqual(a.t.metrics(y,p)['exactMatch'],1.)
            restored=a.restore(a.serializable(model));np.testing.assert_array_equal(p,a.probabilities(restored,x))

    def test_neighbors_respect_weights_and_rbf_centers_are_training_originals(self):
        rng=np.random.default_rng(404);x=rng.normal(size=(31,5));x/=np.linalg.norm(x,axis=1,keepdims=True)
        y=(rng.random((31,6))>.7).astype(float);w=np.ones(31);w[[0,30]]=.5
        rows=[{'id':str(i),'groupId':str(i)} for i in range(30)]+[{'id':'para','groupId':'0','kind':'paraphrase'}]
        knn=a.fit(rows,x,y,w,{'family':'knn','neighbors':1,'temperature':30})
        np.testing.assert_array_equal(a.probabilities(knn,x[:1]),y[:1])
        cfg={'family':'rbf','centers':30,'gamma':2.,'l2':.01,'weightPower':.3}
        rbf=a.fit(rows,x,y,w,cfg);self.assertNotIn('para',rbf['centerIds'])
        p=a.probabilities(rbf,x);self.assertTrue(np.isfinite(p).all())
        np.testing.assert_array_equal(p,a.probabilities(a.restore(a.serializable(rbf)),x))

    def test_monitors_do_not_fit_scaling_and_refits_do_not_monitor(self):
        rng=np.random.default_rng(405);x=rng.normal(size=(20,5));y=(rng.random((20,6))>.7).astype(float)
        cfg=config(maxEpochs=10,minEpochs=10,patience=10)
        warm=a.fit_mlp(x,y,np.ones(20),cfg,7919,monitor=(x+100,y))
        np.testing.assert_allclose(warm['mean'],x.mean(axis=0))
        refit=a.fit_mlp(x,y,np.ones(20),cfg,7919,epochs=warm['optimizer']['selectedEpoch'])
        self.assertFalse(refit['optimizer']['earlyStopping'])
        self.assertEqual(refit['optimizer']['selectedEpoch'],warm['optimizer']['selectedEpoch'])

if __name__=='__main__':unittest.main()

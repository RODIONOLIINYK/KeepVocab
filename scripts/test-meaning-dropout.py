#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('dropout',Path(__file__).parent/'lib/meaning_dropout.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
np=d.np

class DropoutTrainingTests(unittest.TestCase):
    def test_masked_gradient_and_zero_dropout_match_existing_objective(self):
        rng=np.random.default_rng(19);x=rng.normal(size=(9,4));y=(rng.random((9,6))>.7).astype(float)
        weights=np.linspace(.5,1,9);theta=d.reg.initial_theta(x,y,3);positive=d.class_weights(y,weights,.6)
        for mask in [None,d.inverted_mask(rng,(9,3),.2),np.zeros((9,3))]:
            loss,g=d.objective(theta,x,y,3,.01,positive,weights,mask)
            for i in range(len(theta)):
                delta=np.zeros_like(theta);delta[i]=1e-6
                estimate=(d.objective(theta+delta,x,y,3,.01,positive,weights,mask)[0]-d.objective(theta-delta,x,y,3,.01,positive,weights,mask)[0])/2e-6
                self.assertAlmostEqual(estimate,g[i],places=7)
            if mask is None:
                old,gg=d.reg.smooth_objective(theta,x,y,3,.01,.6,weights)
                self.assertAlmostEqual(loss,old,places=14);np.testing.assert_allclose(g,gg,atol=1e-14)

    def test_inverted_dropout_preserves_activation_expectation(self):
        mask=d.inverted_mask(np.random.default_rng(6),(100000,3),.2)
        self.assertLess(abs(float(mask.mean())-1),.004)
        self.assertTrue(set(np.unique(mask))=={0,1.25})

    def test_adam_overfits_tiny_batch_and_is_reproducible(self):
        rng=np.random.default_rng(8);x=rng.normal(size=(16,6));y=(rng.random((16,6))>.65).astype(float)
        cfg={'hidden':16,'dropout':0.,'l2':0.,'weightPower':0.,'learningRate':.02,'batchSize':16}
        a=d.fit(x,y,cfg,epochs=250);b=d.fit(x,y,cfg,epochs=250)
        p=d.t.predict(a,x);np.testing.assert_array_equal(p,d.t.predict(b,x))
        self.assertEqual(d.t.metrics(y,p)['exactMatch'],1.)

    def test_inner_monitor_excludes_entire_parent_group_and_augmented_scores(self):
        rng=np.random.default_rng(10);y=(rng.random((40,6))>.7).astype(float)
        rows=[{'id':f'm-{i}','groupId':f'g-{i}'} for i in range(40)]
        rows+=[{'id':'para','groupId':'g-0','kind':'paraphrase'}];y=np.r_[y,y[:1]]
        tr,va=d.inner_split(rows,y,11)
        self.assertNotIn(40,va)
        self.assertFalse({rows[i]['groupId'] for i in tr}&{rows[i]['groupId'] for i in va})
        self.assertEqual(0 in tr,40 in tr)

    def test_stopping_uses_deterministic_inference_and_refit_has_no_monitor(self):
        rng=np.random.default_rng(27);x=rng.normal(size=(30,5));y=(rng.random((30,6))>.6).astype(float)
        cfg={'hidden':8,'dropout':.2,'l2':.01,'weightPower':.5,'learningRate':.005,'maxEpochs':40,'patience':10,'minEpochs':10}
        warm=d.fit(x[:20],y[:20],cfg,monitor=(x[20:],y[20:]))
        epochs=warm['optimizer']['selectedEpoch'];self.assertGreater(epochs,0)
        fit=d.fit(x,y,cfg,epochs=epochs)
        self.assertEqual(fit['optimizer']['epochsExecuted'],epochs)
        self.assertFalse(fit['optimizer']['earlyStopping'])
        p=d.t.predict(fit,x);np.testing.assert_array_equal(p,d.t.predict(fit,x))

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""Numerical and leakage checks for the offline normalization experiment."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('bn',Path(__file__).parent/'lib/meaning_batchnorm.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
np=b.np

def config(**changes):
    return dict(hidden=4,batchNorm=True,l2=.01,weightPower=.6,preprocess='standardize',
                learningRate=.005,batchSize=8,maxEpochs=40,minEpochs=10,patience=10,**changes)

class NormalizationTests(unittest.TestCase):
    def test_finite_difference_gradients_for_bn_and_matched_plain(self):
        rng=np.random.default_rng(311);x=rng.normal(size=(9,3));y=(rng.random((9,6))>.7).astype(float)
        weights=np.linspace(.5,1,9)
        for enabled in [False,True]:
            cfg=config();cfg['batchNorm']=enabled
            theta=b.initial(x,y,cfg,7919,weights);positive=b.d.class_weights(y,weights,.6)
            _,g,_=b.objective(theta,x,y,cfg,positive,weights)
            for i in range(len(theta)):
                dx=np.zeros_like(theta);dx[i]=1e-6
                numerical=(b.objective(theta+dx,x,y,cfg,positive,weights)[0]-b.objective(theta-dx,x,y,cfg,positive,weights)[0])/2e-6
                self.assertAlmostEqual(numerical,g[i],places=7)
            if not enabled:
                old,gg=b.reg.smooth_objective(theta,x,y,4,.01,.6,weights)
                new,_,_=b.objective(theta,x,y,cfg,positive,weights)
                self.assertAlmostEqual(old,new,places=14);np.testing.assert_allclose(g,gg,atol=1e-14)

    def test_folded_inference_matches_explicit_bn_and_is_batch_independent(self):
        rng=np.random.default_rng(312);x=rng.normal(size=(7,5));y=(rng.random((7,6))>.6).astype(float)
        cfg=config();weights=np.ones(7);theta=b.initial(x,y,cfg,7919,weights)
        theta[-8:]=rng.normal(size=8)
        mean=rng.normal(size=5);scale=rng.uniform(.1,2,size=5)
        rm=rng.normal(size=4);rv=rng.uniform(.1,2,size=4)
        model=b.inference_model(theta,mean,scale,cfg,rm,rv)
        ((w1,b1),(w2,b2)),gamma,beta=b.unpack(theta,5,4)
        expected=b.t.sigmoid(np.tanh((((x-mean)/scale)@w1+b1-rm)/np.sqrt(rv+1e-5)*gamma+beta)@w2+b2)
        np.testing.assert_allclose(b.t.predict(model,x),expected,atol=1e-14)
        np.testing.assert_allclose(b.t.predict(model,x[:1]),expected[:1],atol=1e-14)

    def test_tiny_batch_overfits_with_and_without_bn_and_repeats_exactly(self):
        rng=np.random.default_rng(313);x=rng.normal(size=(16,6));y=(rng.random((16,6))>.6).astype(float)
        for enabled in [False,True]:
            cfg=config();cfg.update(hidden=32,batchNorm=enabled,l2=0.,weightPower=0.,learningRate=.02,batchSize=16)
            a=b.fit(x,y,cfg,epochs=350);other=b.fit(x,y,cfg,epochs=350)
            pa=b.t.predict(a,x)
            np.testing.assert_array_equal(pa,b.t.predict(other,x))
            self.assertEqual(b.t.metrics(y,pa)['exactMatch'],1.)

    def test_monitor_never_fits_preprocessing_or_updates_running_statistics(self):
        rng=np.random.default_rng(314);x=rng.normal(size=(20,5));y=(rng.random((20,6))>.6).astype(float)
        cfg=config();cfg.update(maxEpochs=5,minEpochs=5,patience=5)
        monitored=b.fit(x,y,cfg,monitor=(x+100,y))
        fixed=b.fit(x,y,cfg,epochs=5)
        np.testing.assert_array_equal(monitored['normalization']['runningMean'],fixed['normalization']['runningMean'])
        np.testing.assert_array_equal(monitored['normalization']['runningVariance'],fixed['normalization']['runningVariance'])
        np.testing.assert_allclose(monitored['mean'],x.mean(axis=0))

    def test_inner_groups_and_paraphrases_stay_together(self):
        rng=np.random.default_rng(315);x=rng.normal(size=(41,5));y=(rng.random((41,6))>.6).astype(float)
        rows=[{'id':str(i),'groupId':str(i)} for i in range(40)]+[{'id':'para','groupId':'0','kind':'paraphrase'}]
        tr,va=b.d.inner_split(rows,y,20261103)
        self.assertNotIn(40,va);self.assertEqual(0 in tr,40 in tr)
        self.assertFalse({rows[i]['groupId'] for i in tr}&{rows[i]['groupId'] for i in va})

    def test_singleton_tail_is_merged_and_invalid_settings_rejected(self):
        rng=np.random.default_rng(316);x=rng.normal(size=(17,5));y=(rng.random((17,6))>.6).astype(float)
        cfg=config();model=b.fit(x,y,cfg,epochs=2)
        self.assertTrue(np.isfinite(b.t.predict(model,x)).all())
        cfg['batchSize']=2
        tiny=b.fit(x[:3],y[:3],cfg,epochs=2)
        self.assertTrue(np.isfinite(b.t.predict(tiny,x[:3])).all())
        cfg['batchSize']=1
        with self.assertRaises(ValueError):b.fit(x,y,cfg,epochs=2)

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('tuning',Path(__file__).parent/'lib/meaning_joint_tuning.py')
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
np=q.np
class JointTuningTests(unittest.TestCase):
    def data(self,n=36,d=4):
        rng=np.random.default_rng(601);x=rng.normal(size=(n,d));y=(rng.random((n,6))>.7).astype(float);return x,y,np.linspace(.5,1,n)
    def cfg(self,**changes):
        return {'family':'crf','features':'linear','preprocess':'standardize','l2':.03,'linkL2':.01,'couplingMode':'all',
            'stateL2Factor':.3,'relationL2Factor':.1,'relationLinkFactor':3.,'stateLinkFactor':2.,'auxBCE':.5,'positivePower':.5,
            'weightMode':'none','weightPower':0.,'weightCap':3.,'order':[0,1,2,3,4,5],'labelScale':1.,**changes}
    def test_auxiliary_joint_objective_gradient_with_class_specific_penalties(self):
        x,y,w=self.data(8,3);cfg=self.cfg();ul,pl=q.penalties(cfg);theta=np.random.default_rng(602).normal(0,.3,3*6+6+15)
        positive=q.j.a.d.class_weights(y,w,.5)
        for aux in [0.,.5,1.]:
            _,g=q.objective(theta,x,y,w,ul,pl,aux,positive)
            for i in range(len(theta)):
                dx=np.zeros_like(theta);dx[i]=1e-6
                numerical=(q.objective(theta+dx,x,y,w,ul,pl,aux,positive)[0]-q.objective(theta-dx,x,y,w,ul,pl,aux,positive)[0])/2e-6
                self.assertAlmostEqual(numerical,g[i],places=7)
    def test_extreme_auxiliary_scores_stay_finite(self):
        x,y,w=self.data(8,3);theta=np.random.default_rng(603).normal(0,100,3*6+6+15)
        loss,g=q.objective(theta,x,y,w,np.ones(6)*.01,np.ones(15)*.02,1.,np.ones(6))
        self.assertTrue(np.isfinite(loss));self.assertTrue(np.isfinite(g).all())
    def test_calibration_gradients_for_all_parameterizations(self):
        x,y,w=self.data(9,3);logp=np.random.default_rng(604).normal(size=(9,64));logp-=np.log(np.exp(logp).sum(axis=1,keepdims=True))
        codes=(y*(2**np.arange(6))).sum(axis=1).astype(int)
        for mode in q.CALIBRATIONS[1:]:
            design=q.calibration_design(mode);params=np.random.default_rng(605).normal(0,.1,1+design.shape[1]);_,g=q.calibration_objective(params,logp,codes,design,.1)
            for i in range(len(params)):
                dx=np.zeros_like(params);dx[i]=1e-6
                numerical=(q.calibration_objective(params+dx,logp,codes,design,.1)[0]-q.calibration_objective(params-dx,logp,codes,design,.1)[0])/2e-6
                self.assertAlmostEqual(numerical,g[i],places=7)
    def test_folding_matches_exact_log_joint_even_for_tiny_probabilities(self):
        x,y,w=self.data(9,3);rng=np.random.default_rng(606)
        model={'family':'crf','features':{'kind':'linear','mean':np.zeros(3),'scale':np.ones(3)},'weights':rng.normal(0,70,(3,6)),
            'bias':rng.normal(0,30,6),'couplings':rng.normal(0,20,15)}
        cal={'method':'pairwise','temperature':4.,'unaryOffsets':rng.normal(size=6).tolist(),'pairOffsets':rng.normal(size=15).tolist()}
        expected=q.calibrate(q.log_joint(model,x),cal);folded,flag=q.fold_calibration(model,cal)
        self.assertTrue(flag);np.testing.assert_allclose(expected,q.j.joint_probabilities(folded,x),atol=1e-13)
    def test_family_weight_invariance_and_preprocessing_independent_of_loss_weights(self):
        x,y,w=self.data();cfg=self.cfg();cfg['weightMode']='set';cfg['weightPower']=.7
        weights=q.loss_weights(y,w,cfg);xx=np.r_[x,x[:1]];yy=np.r_[y,y[:1]];ww=np.r_[w,w[:1]/2];ww[0]/=2
        weighted=q.loss_weights(yy,ww,cfg);self.assertAlmostEqual(float(weights.sum()),float(weighted.sum()),places=12)
        theta=np.zeros(x.shape[1]*6+6+15);ul,pl=q.penalties(cfg)
        a,ga=q.objective(theta,x,y,weights,ul,pl,.5,np.ones(6));b,gb=q.objective(theta,xx,yy,weighted,ul,pl,.5,np.ones(6))
        self.assertAlmostEqual(a,b,places=12);np.testing.assert_allclose(ga,gb,atol=1e-13)
        rows=[{'id':str(i),'groupId':str(i)} for i in range(len(x))]
        fitted=q.fit(rows,x,y,w,cfg);np.testing.assert_allclose(fitted['features']['mean'],np.average(x,axis=0,weights=w))
    def test_coupling_constraints_and_probability_normalization(self):
        x,y,w=self.data();rows=[{'id':str(i),'groupId':str(i)} for i in range(len(x))]
        for mode in ['no-relation','nonnegative']:
            cfg=self.cfg();cfg['couplingMode']=mode;model=q.fit(rows,x,y,w,cfg)
            if mode=='no-relation':self.assertTrue(all(model['couplings'][k]==0 for k,p in enumerate(q.j.PAIRS) if 4 in p))
            else:self.assertGreaterEqual(float(model['couplings'].min()),0.)
            np.testing.assert_allclose(q.j.joint_probabilities(model,x).sum(axis=1),1,atol=1e-14)
    def test_pcc_exact_log_probabilities_match_previous_inference(self):
        x,y,w=self.data();rows=[{'id':str(i),'groupId':str(i)} for i in range(len(x))]
        cfg=self.cfg();cfg['family']='pcc';model=q.fit(rows,x,y,w,cfg)
        np.testing.assert_allclose(np.exp(q.log_joint(model,x)),q.j.joint_probabilities(model,x),atol=1e-14)
    def test_averaging_different_scalings_matches_geometric_joint_pool(self):
        x,y,w=self.data(9,3);rng=np.random.default_rng(607);models=[]
        for _ in range(3):
            models.append({'family':'crf','features':{'kind':'linear','mean':rng.normal(size=3),'scale':rng.uniform(.1,2,size=3)},
                'weights':rng.normal(size=(3,6)),'bias':rng.normal(size=6),'couplings':rng.normal(size=15)})
        pooled=q.average_linear_crfs(models);expected=q.j.a.softmax(np.mean([q.log_joint(m,x) for m in models],axis=0))
        np.testing.assert_allclose(q.j.joint_probabilities(pooled,x),expected,atol=1e-13)
if __name__=='__main__':unittest.main()

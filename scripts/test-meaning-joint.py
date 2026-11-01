#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('joint',Path(__file__).parent/'lib/meaning_joint.py')
j=importlib.util.module_from_spec(spec);spec.loader.exec_module(j)
np=j.np
class JointTests(unittest.TestCase):
    def test_exact_crf_gradient_and_binary_conditionals(self):
        rng=np.random.default_rng(501);x=rng.normal(size=(9,3));y=(rng.random((9,6))>.7).astype(float);weights=np.linspace(.5,1,9)
        for coupled in [False,True]:
            theta=rng.normal(0,.2,size=3*6+6+(15 if coupled else 0));_,g=j.crf_objective(theta,x,y,weights,.01,.02,coupled)
            for i in range(len(theta)):
                dx=np.zeros_like(theta);dx[i]=1e-6
                num=(j.crf_objective(theta+dx,x,y,weights,.01,.02,coupled)[0]-j.crf_objective(theta-dx,x,y,weights,.01,.02,coupled)[0])/2e-6
                self.assertAlmostEqual(num,g[i],places=7)
        theta=rng.normal(size=4);_,g=j.binary_objective(theta,x,y[:,0],weights,.01)
        for i in range(4):
            dx=np.zeros(4);dx[i]=1e-6
            num=(j.binary_objective(theta+dx,x,y[:,0],weights,.01)[0]-j.binary_objective(theta-dx,x,y[:,0],weights,.01)[0])/2e-6
            self.assertAlmostEqual(num,g[i],places=7)

    def test_joint_normalization_marginals_and_serialized_parity(self):
        rng=np.random.default_rng(502);x=rng.normal(size=(40,5));x/=np.linalg.norm(x,axis=1,keepdims=True);y=(rng.random((40,6))>.7).astype(float);w=np.ones(40)
        rows=[{'id':str(i),'groupId':str(i)} for i in range(40)]
        for family in ['crf','pcc']:
            cfg={'family':family,'features':'linear','preprocess':'standardize','l2':.01,'linkL2':.02,'coupled':True,'order':[5,2,3,1,4,0],'labelScale':2.}
            model=j.fit(rows,x,y,w,cfg);p=j.joint_probabilities(model,x)
            np.testing.assert_allclose(p.sum(axis=1),1,atol=1e-14)
            self.assertTrue(((p@j.PATTERNS>=0)&(p@j.PATTERNS<=1+1e-14)).all())
            np.testing.assert_array_equal(p,j.joint_probabilities(j.restore(j.a.serializable(model)),x))

    def test_map_and_marginal_decisions_can_differ_without_losing_probabilities(self):
        joint=np.zeros((1,64));joint[0,[0,1,2]]=[.35,.25,.4]
        marginal=joint@j.PATTERNS
        self.assertEqual(int(joint.argmax(axis=1)[0]),2)
        self.assertEqual(int(np.sum((marginal[0]>=.5)*(2**np.arange(6)))),0)
        self.assertEqual(marginal.shape,(1,6))

    def test_zero_couplings_reproduce_independent_bernoulli_joint(self):
        rng=np.random.default_rng(503);x=rng.normal(size=(8,3));w=rng.normal(size=(3,6));bias=rng.normal(size=6)
        model={'family':'crf','features':{'kind':'linear','mean':np.zeros(3),'scale':np.ones(3)},'weights':w,'bias':bias,'couplings':np.zeros(15)}
        p=j.t.sigmoid(x@w+bias);expected=np.prod(np.where(j.PATTERNS[None,:,:],p[:,None,:],1-p[:,None,:]),axis=2)
        np.testing.assert_allclose(j.joint_probabilities(model,x),expected,atol=1e-14)

if __name__=='__main__':unittest.main()

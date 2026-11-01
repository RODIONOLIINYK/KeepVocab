#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('structured',Path(__file__).parent/'lib/meaning_structured.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
np=s.np
def config(**changes):
    return {'family':'neural-global','width':4,'context':False,'residual':False,'activation':'tanh','l2':.01,'edgeL2':.03,'pairL2':.02,
        'preprocess':'standardize','pca':0,'whiten':False,'learningRate':.005,'batchSize':16,'maxEpochs':50,'patience':15,**changes}
class StructuredTests(unittest.TestCase):
    def data(self,n=12,d=3):
        rng=np.random.default_rng(701);return rng.normal(size=(n,d)),(rng.random((n,6))>.65).astype(float),np.linspace(.5,1,n)
    def test_gradients_global_context_residual_and_linear(self):
        x,y,w=self.data(8,3);rng=np.random.default_rng(702)
        cases=[config(),config(context=True),config(residual=True),config(width=0,context=True),config(activation='relu')]
        for cfg in cases:
            params={k:rng.normal(0,.2,shape) for k,shape in s.shapes(3,cfg)};theta=s.pack(params,3,cfg);_,g=s.objective(theta,x,y,w,cfg)
            for i in range(len(theta)):
                dx=np.zeros_like(theta);dx[i]=1e-6
                numerical=(s.objective(theta+dx,x,y,w,cfg)[0]-s.objective(theta-dx,x,y,w,cfg)[0])/2e-6
                self.assertAlmostEqual(numerical,g[i],places=7,msg=str(cfg))
    def test_neural_heads_can_fit_tiny_batch_and_repeat(self):
        x,y,w=self.data(12,6)
        for context in [False,True]:
            cfg=config(width=32,context=context,l2=0.,edgeL2=0.,pairL2=0.,learningRate=.02)
            a=s.fit_neural(x,y,w,cfg,7919,epochs=350);b=s.fit_neural(x,y,w,cfg,7919,epochs=350)
            pa=s.model_log_joint(a,x);np.testing.assert_array_equal(pa,s.model_log_joint(b,x))
            self.assertTrue(np.all(s.P[pa.argmax(axis=1)]==y))
    def test_diagnostic_curve_never_changes_fixed_fit_or_preprocessing(self):
        x,y,w=self.data(20,5);cfg=config(width=8)
        a=s.fit_neural(x,y,w,cfg,7919,epochs=8);b=s.fit_neural(x,y,w,cfg,7919,epochs=8,diagnostic_monitor=(x+100,y))
        for key in a['params']:np.testing.assert_array_equal(a['params'][key],b['params'][key])
        np.testing.assert_allclose(b['features']['mean'],np.average(x,axis=0,weights=w));self.assertFalse(b['optimizer']['earlyStopping'])
        self.assertEqual(len(b['optimizer']['monitorTrace']),9)
    def test_training_only_pca_and_roundtrip(self):
        x,y,w=self.data(30,7);cfg=config(width=0,context=True,pca=3)
        model=s.fit_neural(x,y,w,cfg,7919,epochs=1)
        np.testing.assert_allclose(model['features']['mean'],np.average(x,axis=0,weights=w));self.assertEqual(model['features']['projection'].shape,(7,3))
        np.testing.assert_array_equal(s.model_log_joint(model,x),s.model_log_joint(s.restore(s.serializable(model)),x))
    def test_svm_exported_margins_probability_calibration_and_roundtrip(self):
        x,y,w=self.data(32,6);cfg=config(family='svm',C=1.,gammaFactor=1.,balanced=True,pca=3)
        model=s.fit_svm(x,y,w,cfg);margins=s.svm_margins(model,x);model['platt']=s.fit_platt(margins,y)
        self.assertTrue(model['optimizer']['allConverged']);np.testing.assert_allclose(np.exp(s.model_log_joint(model,x)).sum(axis=1),1,atol=1e-13)
        np.testing.assert_array_equal(s.model_log_joint(model,x),s.model_log_joint(s.restore(s.serializable(model)),x))
    def test_platt_gradient(self):
        margins,y,w=self.data(9,6);params=np.random.default_rng(703).normal(0,.2,12);_,g=s.platt_objective(params,margins,y,.001)
        for i in range(12):
            dx=np.zeros(12);dx[i]=1e-6
            numerical=(s.platt_objective(params+dx,margins,y,.001)[0]-s.platt_objective(params-dx,margins,y,.001)[0])/2e-6
            self.assertAlmostEqual(numerical,g[i],places=7)
    def test_inner_groups_and_curve_score_originals_once(self):
        x,y,w=self.data(41,5);rows=[{'id':str(i),'groupId':str(i)} for i in range(40)]+[{'id':'para','groupId':'0','kind':'paraphrase'}]
        w[[0,40]]=.5;cfg=config(width=8,maxEpochs=35,patience=10);model=s.fit_inner(rows,x,y,w,cfg)
        inner=model['innerDecoder'];lookup={r['id']:r for r in rows};monitor={lookup[i]['groupId'] for i in inner['ids']}
        self.assertTrue(all(lookup[i].get('kind')!='paraphrase' for i in inner['ids']));self.assertTrue(all(lookup[i]['groupId'] not in monitor for i in inner['trainingIds']))
        originals=sum(lookup[i].get('kind')!='paraphrase' for i in inner['trainingIds'])
        self.assertTrue(all(q['trainingOriginalCount']==originals for q in model['optimizer']['innerStop']['monitorTrace']))
    def test_joint_calibration_folds_into_shared_context_and_residual_heads(self):
        spec=importlib.util.spec_from_file_location('structured_runner',Path(__file__).parent/'train-meaning-structured.py')
        r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
        x,y,w=self.data(8,3);rng=np.random.default_rng(704)
        cal={'method':'unary','temperature':.8,'unaryOffsets':rng.normal(size=6).tolist(),'pairOffsets':rng.normal(size=15).tolist()}
        for cfg in [config(),config(context=True),config(residual=True)]:
            params={k:rng.normal(0,.2,shape) for k,shape in s.shapes(3,cfg)}
            model={'family':'structured','config':cfg,'features':{'mean':np.zeros(3),'scale':np.ones(3),'projection':None,'projectScale':None},'params':params}
            folded,flag=r.fold_calibration(model,cal);self.assertTrue(flag)
            np.testing.assert_allclose(np.exp(s.model_log_joint(folded,x)),s.u.calibrate(s.model_log_joint(model,x),cal),atol=1e-13)
    def test_fixed_budget_capacity_trainer_matches_verified_adam(self):
        spec=importlib.util.spec_from_file_location('capacity_trainer',Path(__file__).parent/'train-meaning-double-descent.py')
        r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
        x,y,w=self.data(24,6);cfg=config(width=8,batchSize=16)
        a=s.fit_neural(x,y,w,cfg,7919,epochs=8)
        b,trace,theta=r.train(x,y,w,cfg,7919,8,lambda model,epoch:{'epoch':epoch},3)
        for key in a['params']:np.testing.assert_array_equal(a['params'][key],b['params'][key])
        self.assertEqual([q['epoch'] for q in trace],[0,3,6,8])
    def test_all_zero_hidden_and_output_matrices_cannot_learn_inputs(self):
        spec=importlib.util.spec_from_file_location('zero_init',Path(__file__).parent/'check-meaning-zero-init.py')
        r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
        x,y,w=self.data(24,6)
        for activation in ['tanh','relu']:
            model,result=r.check(x,y,w,config(width=8,l2=0.,activation=activation),7919,3)
            self.assertTrue(result['allHiddenAndOutputWeightGradientsZero']);self.assertEqual(result['inputLogProbabilityVariation'],0.)
            control=result['randomHiddenZeroOutputControl'];self.assertGreater(control['firstOutputWeightGradientMax'],0.)
            self.assertEqual(control['firstHiddenWeightGradientMax'],0.);self.assertGreater(control['secondHiddenWeightGradientMax'],0.)
if __name__=='__main__':unittest.main()

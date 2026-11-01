#!/usr/bin/env python3
import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('early_l2',Path(__file__).parent/'train-meaning-early-l2.py')
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
np,s=e.np,e.s
class EarlyL2Tests(unittest.TestCase):
    def data(self):
        rng=np.random.default_rng(423);x=rng.normal(size=(51,6));y=(rng.random((51,6))>.65).astype(float)
        rows=[{'id':str(i),'groupId':str(i),'kind':'original'} for i in range(50)]+[{'id':'para','groupId':'0','kind':'paraphrase'}]
        w=np.ones(51);w[[0,50]]=.5
        cfg={**e.configs()[0],'width':8,'maxEpochs':50,'patience':15}
        return rows,x,y,w,cfg
    def test_declared_search_has_positive_penalties_and_zero_controls(self):
        configs=e.configs();self.assertEqual(len(configs),27)
        self.assertEqual(sum(c['l2']>0 for c in configs),24);self.assertEqual(sum(c['l2']==0 for c in configs),3)
        for c in configs:self.assertEqual(c['l2'],c['pairL2']);self.assertEqual(c['maxEpochs'],1000)
    def test_stopping_groups_never_fit_features_or_weights_and_checkpoint_replays(self):
        rows,x,y,w,cfg=self.data();model=e.fit(rows,x,y,w,cfg,7919);partition=model['fitPartition'];tr=np.array(partition['trainIndices']);va=np.array(partition['monitorIndices'])
        self.assertFalse({rows[i]['groupId'] for i in tr}&{rows[i]['groupId'] for i in va});self.assertTrue(all(rows[i]['kind']!='paraphrase' for i in va))
        np.testing.assert_allclose(model['features']['mean'],np.average(x[tr],axis=0,weights=w[tr]))
        epoch=model['optimizer']['selectedEpoch'];replay=s.fit_neural(x[tr],y[tr],w[tr],cfg,7919,epochs=epoch,diagnostic_monitor=(x+100,y))
        for key in model['params']:np.testing.assert_array_equal(model['params'][key],replay['params'][key])
        chosen=0;best=float('inf')
        for point in model['optimizer']['monitorTrace']:
            if point['monitorJointNLL']<best-.0001:best=point['monitorJointNLL'];chosen=point['step']
        self.assertEqual(epoch,chosen);self.assertGreaterEqual(model['optimizer']['epochsExecuted'],epoch)
    def test_no_stop_control_uses_same_fitting_rows_and_exact_budget(self):
        rows,x,y,w,cfg=self.data();early=e.fit(rows,x,y,w,cfg,7919);fixed=e.fit(rows,x,y,w,cfg,7919,early=False)
        self.assertEqual(early['fitPartition']['trainIds'],fixed['fitPartition']['trainIds']);self.assertEqual(early['fitPartition']['reservedMonitorIds'],fixed['fitPartition']['reservedMonitorIds'])
        self.assertFalse(fixed['optimizer']['earlyStopping']);self.assertEqual(fixed['optimizer']['selectedEpoch'],50);self.assertEqual(fixed['fitPartition']['stoppingIds'],[])
    def test_l2_penalizes_matrices_and_pairs_without_penalizing_biases(self):
        rows,x,y,w,cfg=self.data();cfg={**cfg,'width':8,'l2':0.,'pairL2':0.};params=s.initialize(x,y,w,cfg,7919);params['couplings'][:]=.2;theta=s.pack(params,6,cfg)
        loss0,g0=s.objective(theta,x,y,w,cfg);penalty=.03;loss1,g1=s.objective(theta,x,y,w,{**cfg,'l2':penalty,'pairL2':penalty})
        expected={k:penalty*v if k.endswith('Weight') or k=='couplings' else np.zeros_like(v) for k,v in params.items()}
        np.testing.assert_allclose(g1-g0,s.pack(expected,6,cfg),atol=1e-14)
        self.assertAlmostEqual(loss1-loss0,penalty/2*sum(float(np.sum(v*v)) for k,v in params.items() if k.endswith('Weight') or k=='couplings'))
if __name__=='__main__':unittest.main()

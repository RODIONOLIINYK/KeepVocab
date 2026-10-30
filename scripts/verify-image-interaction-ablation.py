"""Numerical checks on the compact1027input research model."""
import importlib.util
from pathlib import Path
import numpy as np
from lib.image_regularization import read,write,digest,load_data,assemble,Model
from lib.image_interaction_ablation import AblatedModel,ACTIVE

spec=importlib.util.spec_from_file_location('gradient_checks',Path(__file__).with_name('verify-image-regularization.py'));checks=importlib.util.module_from_spec(spec);spec.loader.exec_module(checks)
p=read('docs/image-interaction-ablation-protocol.json');plan=read(p['dataSplit']);data,_=load_data(plan);prepared=read('work/image-regularization/prepared.json.gz');ids=plan['commonIds']+plan['seenExposureIds'];train=assemble(data,ids);batch=assemble(data,ids[:8]);results=[]
for bn in [False,True]:
 m=AblatedModel(prepared['initials']['78123']['weights'],bn)
 if bn:m.calibrate_identity(train['x'])
 original,_=Model(prepared['initials']['78123']['weights']).forward(train['x']);actual,_=m.forward(train['x']);error=float(np.max(np.abs(original-actual)));assert error<2e-6,error
 expanded=m.packed(folded=True);assert len(expanded)==49825;assert not np.any(expanded[:32*1539].reshape(32,1539)[:,1024:1536]);assert len(m.packed())==33441
 for l2 in [0,.0001]:results.append({'batchNorm':bn,'l2':l2,'initialRawScoreError':error,'gradient':checks.finite_difference(m,batch,l2)})
write('work/image-interaction-ablation/preflight.json',{'passed':True,'results':results,'protocolSha256':digest('docs/image-interaction-ablation-protocol.json'),'kernelSha256':digest('scripts/lib/image_interaction_ablation.py'),'baseKernelSha256':digest('scripts/lib/image_regularization.py')})
print({'passed':True,'gradientChecks':sum(len(x['gradient']['checks']) for x in results)})

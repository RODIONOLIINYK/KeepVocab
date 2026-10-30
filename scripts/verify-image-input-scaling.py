"""Training-only checks before the normalized-input study starts."""
import importlib.util
from pathlib import Path
import numpy as np
from lib.image_regularization import read, write, digest, load_data, assemble, Model
from lib.image_input_scaling import ScaledModel, calibration

spec=importlib.util.spec_from_file_location('gradient_checks',Path(__file__).with_name('verify-image-regularization.py'))
checks=importlib.util.module_from_spec(spec);spec.loader.exec_module(checks)
p=read('docs/image-input-scaling-protocol.json');plan=read(p['dataSplit']);data,_=load_data(plan);prepared=read('work/image-regularization/prepared.json.gz');results=[]
for arm in p['arms']:
 ids=plan['commonIds']+plan[arm+'ExposureIds'];norm=calibration(data,ids);model=ScaledModel(prepared['initials']['78123']['weights'],norm['mean'],norm['scale']);raw=Model(prepared['initials']['78123']['weights']);batch=assemble(data,ids[:8]);x=assemble(data,ids)['x'];a,_=model.forward(x);b,_=raw.forward(x);error=float(np.max(np.abs(a-b)));assert error<2e-6,error
 fitted=Model(model.packed(folded=True));z,_=fitted.forward(x);fold_error=float(np.max(np.abs(z-a)));assert fold_error<2e-6,fold_error
 before_mean,before_scale=model.mean.copy(),model.scale.copy();model.forward(batch['x']);assert np.array_equal(before_mean,model.mean) and np.array_equal(before_scale,model.scale)
 for strength in [0,.0001]:results.append({'arm':arm,'strength':strength,'gradient':checks.finite_difference(model,batch,strength)})
 results.append({'arm':arm,'initialRawScoreError':error,'initialFoldError':fold_error,'fitPhotoMeanings':len(x),'minimumScale':float(norm['scale'].min()),'maximumScale':float(norm['scale'].max()),'floorCoordinates':int(np.sum(norm['scale']==.001))})
write('work/image-input-scaling/preflight.json',{'passed':True,'results':results,'protocolSha256':digest('docs/image-input-scaling-protocol.json'),'kernelSha256':digest('scripts/lib/image_input_scaling.py'),'baseKernelSha256':digest('scripts/lib/image_regularization.py')})
print({'passed':True,'gradientChecks':sum(len(x['gradient']['checks']) for x in results if 'gradient'in x)})

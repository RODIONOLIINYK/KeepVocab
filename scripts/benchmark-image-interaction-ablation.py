"""Four-family compact-input ablation; no interaction products and no early stopping."""
import argparse
import hashlib
from pathlib import Path
import time
import numpy as np
from lib.image_regularization import read,write,digest,load_data,assemble,Model,fit,metrics
from lib.image_interaction_ablation import AblatedModel,restore


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--lane',type=int);ap.add_argument('--tiny',action='store_true');ap.add_argument('--aggregate',action='store_true');args=ap.parse_args();root=Path('work/image-interaction-ablation');root.mkdir(exist_ok=True,parents=True)
 protocol=read('docs/image-interaction-ablation-protocol.json');plan=read(protocol['dataSplit']);data,encoder=load_data(plan);prepared=read('work/image-regularization/prepared.json.gz');proof=read(root/'preflight.json')
 source={f:digest(f) for f in ['scripts/lib/image_regularization.py','scripts/lib/image_interaction_ablation.py','scripts/benchmark-image-interaction-ablation.py','docs/image-interaction-ablation-protocol.json',protocol['dataSplit']]}
 if not proof['passed'] or proof['kernelSha256']!=source['scripts/lib/image_interaction_ablation.py'] or proof['baseKernelSha256']!=source['scripts/lib/image_regularization.py']:raise ValueError('Current preflight required')
 provenance={'sourceSha256':source,'parentReportSha256':digest('work/image-regularization/report.json.gz'),'preparedSha256':digest('work/image-regularization/prepared.json.gz'),'encoder':encoder}
 parts={arm:{'train':plan['commonIds']+plan[arm+'ExposureIds'],'validation':plan['validationIds'],'test':plan['testIds']} for arm in protocol['arms']}
 configs=[{'seed':seed,'arm':arm,'family':family,'strength':protocol['l2'] if 'l2'in family else 0,'name':f'{seed}-{arm}-{family}'} for seed in protocol['seeds'] for family in protocol['families'] for arm in protocol['arms']]
 def state(m):
  weights=m.packed(folded=True);base=prepared['initials']['78123'].copy();base.update({'weights':weights,'role':'semantic','genericValidation':{'accepted':False,'reason':'Offline interaction ablation'}});return {'state':m.state(),'foldedModel':base,'sha256':hashlib.sha256(weights.tobytes()).hexdigest()}
 def run(c):
  path=root/'runs'/c['name'];path.mkdir(exist_ok=True,parents=True)
  if (path/'run.json.gz').exists():
   r=read(path/'run.json.gz')
   if r['provenance']!=provenance:raise ValueError('Stale ablation fit')
   return
  model=AblatedModel(prepared['initials'][str(c['seed'])]['weights'],'batchnorm'in c['family']);partition=parts[c['arm']]
  if model.batch_norm:model.calibrate_identity(assemble(data,partition['train'])['x'])
  snapshots={}
  def capture(epoch,m):
   if epoch%10==0:snapshots[epoch]=m.clone()
  def progress(row):print({'name':c['name'],'epoch':row['epoch'],'trainLoss':row['train']['loss'],'validationCorrect':row['validation']['chosenAt1'],'validationLoss':row['validation']['loss']},flush=True)
  start=time.monotonic();r=fit(model,data,partition['train'],partition['validation'],protocol['recipe'],c['strength'],progress=progress,snapshot=capture)
  values={'epochs':np.asarray(list(snapshots))};values.update({'p_'+k:np.stack([m.p[k] for m in snapshots.values()]) for k in model.p});values.update({'r_'+k:np.stack([m.running[k] for m in snapshots.values()]) for k in model.running});np.savez_compressed(path/'snapshots.npz',**values);write(path/'curve.json.gz',r['curve'])
  write(path/'run.json.gz',{'config':c,'provenance':provenance,'selected':state(r['selected']),'last':state(r['model']),'selectedEpoch':r['selectedEpoch'],'epochsRun':r['epochsRun'],'steps':r['steps'],'clippedSteps':r['clippedSteps'],'maximumGradientNorm':r['maximumGradientNorm'],'stoppedBy':r['stoppedBy'],'elapsedSeconds':time.monotonic()-start,'testEvaluated':False,'snapshotsSha256':digest(path/'snapshots.npz')});print({'finished':c['name'],'seconds':time.monotonic()-start},flush=True)
 if args.lane is not None:
  for i,c in enumerate(configs):
   if i%3==args.lane:run(c)
  return
 if args.tiny:
  ids=parts['seen']['train'];rows=metrics(Model(prepared['initials']['78123']['weights']),assemble(data,ids),rows=True)['rows'];bad={r['id'] for r in rows if not r['chosenAt1']};seen=set();tiny=[]
  for cid in sorted(ids,key=lambda c:(c not in bad,c)):
   if data[cid]['meaningId'] not in seen:seen.add(data[cid]['meaningId']);tiny.append(cid)
   if len(tiny)==8:break
  results=[]
  for family in protocol['families']:
   m=AblatedModel(prepared['initials']['78123']['weights'],'batchnorm'in family)
   if m.batch_norm:m.calibrate_identity(assemble(data,tiny)['x'])
   strength=protocol['l2'] if 'l2'in family else 0;r=fit(m,data,tiny,tiny,protocol['recipe'],strength);after=metrics(r['model'],assemble(data,tiny));passed=after['chosenAt1']==8 and after['pairwiseAccuracy']>=1-1e-12;results.append({'family':family,'strength':strength,'ids':tiny,'after':after,'curve':r['curve'],'passed':passed})
  write(root/'tiny.json.gz',{'passed':all(r['passed'] for r in results),'sameKernelAsFull':True,'results':results})
  if not all(r['passed'] for r in results):raise ValueError('Tiny check failed')
  return
 if not args.aggregate:raise ValueError('Choose stage')
 frozen=[]
 for c in configs:
  r=read(root/'runs'/c['name']/'run.json.gz')
  if r['provenance']!=provenance or r['epochsRun']!=600 or r['testEvaluated'] or digest(root/'runs'/c['name']/'snapshots.npz')!=r['snapshotsSha256']:raise ValueError('Invalid frozen fit')
  for ck in ['selected','last']:
   if hashlib.sha256(restore(r[ck]['state']).packed(folded=True).tobytes()).hexdigest()!=r[ck]['sha256']:raise ValueError('Frozen state changed')
  frozen.append(r)
 if not read(root/'tiny.json.gz')['passed']:raise ValueError('Tiny check required')
 report={'protocol':protocol,'provenance':provenance,'runs':[],'allRunsFrozenBeforeTest':True,'activated':False,'primaryTestSize':21}
 for saved in frozen:
  c=saved['config'];partition={k:assemble(data,v) for k,v in parts[c['arm']].items()};row={k:v for k,v in saved.items() if k not in ['selected','last']};row['metrics']={split:{ck:metrics(restore(saved[ck]['state']),batch,rows=True) for ck in ['selected','last']} for split,batch in partition.items()};curve=read(root/'runs'/c['name']/'curve.json.gz');archive=np.load(root/'runs'/c['name']/'snapshots.npz');snapshots={k:archive[k] for k in archive.files}
  for i,epoch in enumerate(snapshots['epochs']):
   m=restore(saved['last']['state']);m.p={k:snapshots['p_'+k][i] for k in m.p};m.running={k:snapshots['r_'+k][i] for k in m.running};curve[int(epoch)]['test']=metrics(m,partition['test'])
  curve[saved['selectedEpoch']]['test']=metrics(restore(saved['selected']['state']),partition['test']);write(root/'runs'/c['name']/'complete-curve.json.gz',curve);report['runs'].append(row)
 report['clipTest']=metrics(Model(prepared['initials']['78123']['weights']),assemble(data,plan['testIds']),rows=True);write(root/'report.json.gz',report)


if __name__=='__main__':main()

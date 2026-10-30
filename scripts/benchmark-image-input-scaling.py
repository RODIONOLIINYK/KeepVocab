"""Follow-up input-scaling study, with fixed settings and validation-only LR search."""
import argparse
import copy
import hashlib
import importlib.util
from pathlib import Path
import time
import numpy as np
from lib.image_regularization import read, write, digest, load_data, assemble, Model, fit, metrics
from lib.image_input_scaling import ScaledModel, calibration, restore


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--lane',type=int);ap.add_argument('--final-lane',type=int);ap.add_argument('--select',action='store_true');ap.add_argument('--aggregate',action='store_true');ap.add_argument('--tiny',action='store_true');args=ap.parse_args()
    root=Path('work/image-input-scaling');root.mkdir(exist_ok=True,parents=True)
    protocol=read('docs/image-input-scaling-protocol.json');plan=read(protocol['dataSplit']);data,encoder=load_data(plan)
    proof=read(root/'preflight.json')
    if not proof['passed'] or proof['kernelSha256']!=digest('scripts/lib/image_input_scaling.py') or proof['baseKernelSha256']!=digest('scripts/lib/image_regularization.py') or proof['protocolSha256']!=digest('docs/image-input-scaling-protocol.json'):raise ValueError('Input-scaling preflight required')
    prepared=read('work/image-regularization/prepared.json.gz')
    provenance={'sourceSha256':{f:digest(f) for f in ['scripts/lib/image_regularization.py','scripts/lib/image_input_scaling.py','scripts/benchmark-image-input-scaling.py','docs/image-input-scaling-protocol.json',protocol['dataSplit']]},
                'parentReportSha256':digest('work/image-regularization/report.json.gz'),'preparedSha256':digest('work/image-regularization/prepared.json.gz')}
    partitions={arm:{'train':plan['commonIds']+plan[f'{arm}ExposureIds'],'validation':plan['validationIds'],'test':plan['testIds']} for arm in protocol['arms']}
    norms={arm:calibration(data,partitions[arm]['train']) for arm in protocol['arms']}
    write(root/'normalizers.json.gz',norms)
    def config(seed,arm,family,lr):return {'seed':seed,'arm':arm,'family':family,'learningRate':lr,'strength':protocol['fixed']['scaledL2'] if family=='scaled-l2' else 0,'name':f'{seed}-{arm}-{family}-{lr:g}'}
    def state(model):
        s=model.state();raw=model.packed(folded=True)
        base=prepared['initials'][str(protocol['seeds'][0])].copy();base.update({'weights':raw,'role':'semantic','genericValidation':{'accepted':False,'reason':'Offline input-scaling study'}})
        return {'state':s,'foldedModel':base,'sha256':hashlib.sha256(raw.tobytes()).hexdigest()}
    def run(c):
        path=root/'runs'/c['name'];path.mkdir(exist_ok=True,parents=True)
        if (path/'run.json.gz').exists():
            r=read(path/'run.json.gz')
            if r['provenance']!=provenance:raise ValueError('Stale input-scaling fit')
            return r
        norm=norms[c['arm']];initial=prepared['initials'][str(c['seed'])]['weights'];model=ScaledModel(initial,norm['mean'],norm['scale']);part=partitions[c['arm']]
        reference=Model(initial);x=assemble(data,part['train'])['x'];a,_=reference.forward(x);b,_=model.forward(x);initial_error=float(np.max(np.abs(a-b)))
        if initial_error>2e-6:raise ValueError(('Initial function changed',initial_error))
        snapshots={}
        def capture(epoch,m):
            if epoch%10==0:snapshots[epoch]=m.clone()
        def progress(row):
            print({'name':c['name'],'epoch':row['epoch'],'trainLoss':row['train']['loss'],'validationCorrect':row['validation']['chosenAt1'],'validationLoss':row['validation']['loss']},flush=True)
        start=time.monotonic();recipe={**protocol['recipe'],'learningRate':c['learningRate']}
        r=fit(model,data,part['train'],part['validation'],recipe,c['strength'],progress=progress,snapshot=capture)
        np.savez_compressed(path/'snapshots.npz',epochs=np.asarray(list(snapshots)),**{'p_'+k:np.stack([m.p[k] for m in snapshots.values()]) for k in model.p})
        write(path/'curve.json.gz',r['curve'])
        saved={'config':c,'provenance':provenance,'normalization':norm,'recipe':recipe,'selected':state(r['selected']),'last':state(r['model']),
               'selectedEpoch':r['selectedEpoch'],'epochsRun':r['epochsRun'],'steps':r['steps'],'maximumGradientNorm':r['maximumGradientNorm'],'clippedSteps':r['clippedSteps'],
               'stoppedBy':r['stoppedBy'],'initialRawScoreError':initial_error,'validationSelected':metrics(r['selected'],assemble(data,part['validation'])),
               'testEvaluated':False,'elapsedSeconds':time.monotonic()-start,'snapshotsSha256':digest(path/'snapshots.npz')}
        write(path/'run.json.gz',saved);print({'finished':c['name'],'seconds':saved['elapsedSeconds']},flush=True);return saved
    pilots=[config(protocol['seeds'][0],arm,family,lr) for family in protocol['families'] for lr in protocol['learningRateGrid'] for arm in protocol['arms']]
    if args.lane is not None:
        for i,c in enumerate(pilots):
            if i%3==args.lane:run(c)
        return
    if args.select:
        summaries=[];selected={}
        for family in protocol['families']:
            choices=[]
            for lr in protocol['learningRateGrid']:
                runs=[read(root/'runs'/c['name']/'run.json.gz') for c in pilots if c['family']==family and c['learningRate']==lr]
                if any(r['provenance']!=provenance or r['epochsRun']!=600 or r['testEvaluated'] for r in runs):raise ValueError('Invalid pilot')
                row={'family':family,'learningRate':lr,'correct':sum(r['validationSelected']['chosenAt1'] for r in runs),'loss':float(np.mean([r['validationSelected']['loss'] for r in runs]))};choices.append(row);summaries.append(row)
            selected[family]=sorted(choices,key=lambda r:(-r['correct'],r['loss'],r['learningRate']))[0]
        write(root/'selection.json',{'provenance':provenance,'selected':selected,'pilots':summaries});print(selected);return
    selection=read(root/'selection.json')
    if selection['provenance']!=provenance:raise ValueError('Stale selection')
    cohorts={family+'-'+mode:[config(seed,arm,family,protocol['fixed']['learningRate'] if mode=='fixed' else selection['selected'][family]['learningRate']) for seed in protocol['seeds'] for arm in protocol['arms']] for family in protocol['families'] for mode in ['fixed','tuned']}
    unique={c['name']:c for rows in cohorts.values() for c in rows}
    if args.final_lane is not None:
        for i,c in enumerate(unique.values()):
            if i%3==args.final_lane:run(c)
        return
    if args.tiny:
        ids=partitions['seen']['train'];reference=Model(prepared['initials']['78123']['weights']);rows=metrics(reference,assemble(data,ids),rows=True)['rows'];bad={r['id'] for r in rows if not r['chosenAt1']};seen=set();tiny=[]
        for cid in sorted(ids,key=lambda c:(c not in bad,c)):
            if data[cid]['meaningId'] not in seen:seen.add(data[cid]['meaningId']);tiny.append(cid)
            if len(tiny)==8:break
        norm=calibration(data,tiny);results=[]
        for cohort,configs in cohorts.items():
            c=configs[0];model=ScaledModel(prepared['initials']['78123']['weights'],norm['mean'],norm['scale']);recipe={**protocol['recipe'],'learningRate':c['learningRate']};r=fit(model,data,tiny,tiny,recipe,c['strength']);after=metrics(r['model'],assemble(data,tiny));passed=after['chosenAt1']==8 and after['pairwiseAccuracy']>=1-1e-12
            results.append({'cohort':cohort,'recipe':recipe,'strength':c['strength'],'ids':tiny,'curve':r['curve'],'after':after,'passed':passed})
        write(root/'tiny.json.gz',{'results':results,'passed':all(r['passed'] for r in results),'sameKernelAsFull':True})
        if not all(r['passed'] for r in results):raise ValueError('Tiny check failed')
        return
    if not args.aggregate:raise ValueError('Choose stage')
    frozen={}
    for c in unique.values():
        r=read(root/'runs'/c['name']/'run.json.gz')
        if r['provenance']!=provenance or r['epochsRun']!=600 or r['testEvaluated'] or digest(root/'runs'/c['name']/'snapshots.npz')!=r['snapshotsSha256']:raise ValueError('Invalid frozen fit')
        frozen[c['name']]=r
    if not read(root/'tiny.json.gz')['passed']:raise ValueError('Tiny check required')
    for saved in frozen.values():
        for checkpoint in ['selected','last']:
            actual=hashlib.sha256(restore(saved[checkpoint]['state']).packed(folded=True).tobytes()).hexdigest()
            if actual!=saved[checkpoint]['sha256']:raise ValueError('Frozen normalized model changed')
    report={'protocol':protocol,'provenance':provenance,'selection':selection,'cohorts':{k:[c['name'] for c in v] for k,v in cohorts.items()},'runs':[],'allRunsFrozenBeforeTest':True,'activated':False}
    for name,saved in frozen.items():
        c=saved['config'];parts={k:assemble(data,v) for k,v in partitions[c['arm']].items()};row={k:v for k,v in saved.items() if k not in ['selected','last','normalization']};row['metrics']={split:{ck:metrics(restore(saved[ck]['state']),batch,rows=True) for ck in ['selected','last']} for split,batch in parts.items()}
        curve=read(root/'runs'/name/'curve.json.gz');archive=np.load(root/'runs'/name/'snapshots.npz');snapshots={k:archive[k] for k in archive.files}
        for i,epoch in enumerate(snapshots['epochs']):
            m=restore(saved['last']['state']);m.p={k:snapshots['p_'+k][i] for k in m.p};curve[int(epoch)]['test']=metrics(m,parts['test'])
        curve[saved['selectedEpoch']]['test']=metrics(restore(saved['selected']['state']),parts['test']);write(root/'runs'/name/'complete-curve.json.gz',curve);report['runs'].append(row)
    write(root/'report.json.gz',report)


if __name__=='__main__':main()

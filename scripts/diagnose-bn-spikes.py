"""Training-only diagnosis of BN+L2 inference-loss spikes; does not retune models."""
from pathlib import Path
import sys
import numpy as np
from lib.image_regularization import read,write,load_data,assemble,Model,metrics


def checkpoint(path, epoch):
    saved=read(path/'run.json.gz');state=saved['last']['state'];m=Model([0]*49825,True,state['epsilon'],state['momentum'])
    archive=np.load(path/'snapshots.npz');idx=list(archive['epochs']).index(epoch)
    m.p={k:archive['p_'+k][idx] for k in state['parameters']};m.running={k:archive['r_'+k][idx] for k in state['running']};return m


def training_mode(model,data,ids,epoch):
    rotation=max(0,epoch-1)%len(ids);ordered=ids[rotation:]+ids[:rotation];total=0.;largest=0.
    for offset in range(0,len(ordered),8):
        current=ordered[offset:offset+8];batch=assemble(data,current)
        value,gradient,_=model.gradient(batch,0,False)
        total+=value*len(current)/len(ids)
        largest=max(largest,np.sqrt(sum(float(np.sum(x.astype(float)**2)) for x in gradient.values())))
    return total,largest


def main():
    root=Path('work/image-regularization');plan=read('tests/fixtures/image-meaning-shift/split.json');data,_=load_data(plan);ids=plan['commonIds']+plan['seenExposureIds'];train=assemble(data,ids);results=[]
    for seed in [78123,78124,78125]:
        path=root/'runs'/f'{seed}-seen-batchnorm-l2-0.0001';curve=read(path/'curve.json.gz')
        # Select only by training inference-loss jump, not validation/test.
        peak=max(range(110,601,10),key=lambda e:curve[e]['train']['loss']/max(curve[e-10]['train']['loss'],1e-30))
        rows=[]
        for epoch in sorted({max(0,peak-10),peak,min(600,peak+10)}):
            for family,strength in [('batchnorm',0),('batchnorm-l2',.0001)]:
                model=checkpoint(root/'runs'/f'{seed}-seen-{family}-{strength:g}',epoch)
                original={k:v.copy() for k,v in model.running.items()};infer=metrics(model,train);batch_loss,max_grad=training_mode(model,data,ids,epoch)
                assert all(np.array_equal(original[k],v) for k,v in model.running.items())
                layers=[]
                for i in range(2):
                    norms=np.linalg.norm(model.p[f'w{i}'].astype(float),axis=1)
                    layers.append({'layer':i,'medianKernelRowNorm':float(np.median(norms)),'minimumKernelRowNorm':float(norms.min()),
                                   'maximumEffectiveGain':float(np.max(np.abs(model.p[f'g{i}'])/np.sqrt(model.running[f'v{i}']+model.epsilon)))})
                rows.append({'epoch':epoch,'family':family,'inferenceDataLoss':infer['loss'],'minibatchTrainingDataLoss':batch_loss,
                             'maximumBatchGradientNormAtCheckpoint':max_grad,'layers':layers})
        results.append({'seed':seed,'peakSnapshotEpoch':peak,'rows':rows})
    write(root/'bn-spike-diagnosis.json',{'method':'Compare frozen inference statistics with actual eight-gallery training-mode statistics, no parameter/statistic updates. Training data only; no test-driven intervention. Peaks selected from sampled training-loss jumps.','results':results})
    if '--plot-dir' in sys.argv:
        render(root,results,Path(sys.argv[sys.argv.index('--plot-dir')+1]))
    print(results)


def render(root,results,output):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    output.mkdir(exist_ok=True,parents=True)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none','svg.hashsalt':'bn-spike-diagnosis'})
    fig,axes=plt.subplots(2,3,figsize=(13,6),sharex='col')
    for col,item in enumerate(results):
        seed,peak=item['seed'],item['peakSnapshotEpoch'];epochs=list(range(peak-20,min(600,peak+20)+1))
        for family,strength,color in [('batchnorm',0,'#657587'),('batchnorm-l2',.0001,'#c56a16')]:
            curve=read(root/'runs'/f'{seed}-seen-{family}-{strength:g}'/'curve.json.gz')
            axes[0,col].plot(epochs,[curve[e]['train']['loss'] for e in epochs],color=color,label=family+' inference')
            rows=[r for r in item['rows'] if r['family']==family]
            axes[0,col].plot([r['epoch'] for r in rows],[r['minibatchTrainingDataLoss'] for r in rows],marker='o',ls='--',color=color,label=family+' minibatch')
            axes[1,col].plot([r['epoch'] for r in rows],[r['layers'][0]['medianKernelRowNorm'] for r in rows],marker='o',color=color)
        for row in range(2):axes[row,col].grid(axis='y',alpha=.2)
        axes[0,col].set_yscale('log');axes[0,col].set_title(f'Seed {seed}');axes[1,col].set_xlabel('Epoch');axes[1,col].set_ylim(bottom=0)
    axes[0,0].set_ylabel('Training pairwise loss\n(log scale)');axes[1,0].set_ylabel('First-layer row norm\n(median)')
    fig.legend(*axes[0,0].get_legend_handles_labels(),loc='upper center',bbox_to_anchor=(.5,.95),ncol=2,frameon=False)
    fig.suptitle('BN + L2 spikes: minibatch optimization and inference statistics',fontsize=13)
    fig.text(.5,.012,'Training-only diagnosis. No parameter or running-statistic updates; no test-based intervention.',ha='center',fontsize=9)
    fig.tight_layout(rect=[0,.04,1,.86]);fig.savefig(output/'bn-spike-diagnosis.png',dpi=180)
    path=output/'bn-spike-diagnosis.svg';fig.savefig(path,metadata={'Date':None});path.write_text('\n'.join(x.rstrip() for x in path.read_text().splitlines())+'\n');plt.close(fig)


if __name__=='__main__':main()

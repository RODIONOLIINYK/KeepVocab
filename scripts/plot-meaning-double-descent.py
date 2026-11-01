#!/usr/bin/env python3
"""Render all preregistered capacity runs, including failures; no model selection."""
import importlib.util,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('wide_plot_runner',ROOT/'scripts/train-meaning-double-descent.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
sys.path.insert(0,str(ROOT/'work/meaning-structured-plot'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
np=r.np
def main():
    p=r.r.read(r.OUT/'protocol.json');results=r.r.read(r.OUT/'results.json.gz');assert results['protocolFileSha256']==r.r.digest(r.OUT/'protocol.json')
    runs=results['runs'];assert len(runs)==p['configurationSeedFits']
    summary=[]
    for l2 in p['l2']:
        for width in p['widths']:
            group=[q for q in runs if q['l2']==l2 and q['width']==width];assert [q['seed'] for q in group]==p['seeds']
            last=[q['trace'][-1] for q in group]
            record={'l2':l2,'width':width,'parameters':group[0]['parameterCount'],'parametersPerOriginalMeaning':group[0]['parametersPerOriginalMeaning'],
                'interpolatedSeeds':sum(q['trainingInterpolated'] for q in group),'seedCount':len(group),
                'trainExactMean':float(np.mean([q['train']['exactMatch'] for q in last])),
                'allTrainingRowsExactMean':float(np.mean([q['allTrainingRowsExact'] for q in last])),
                'validationExactMean':float(np.mean([q['validation']['exactMatch'] for q in last])),
                'validationExactMin':min(q['validation']['exactMatch'] for q in last),'validationExactMax':max(q['validation']['exactMatch'] for q in last),
                'trainJointNLLMean':float(np.mean([q['train']['jointNLL'] for q in last])),
                'validationJointNLLMean':float(np.mean([q['validation']['jointNLL'] for q in last]))}
            summary.append(record)
    r.r.write(r.OUT/'summary.json',{'protocolFileSha256':results['protocolFileSha256'],'resultsFileSha256':r.r.digest(r.OUT/'results.json.gz'),
        'testUsed':False,'usedForModelSelection':False,'summary':summary,
        'firstAllSeedInterpolation':{str(l2):next((q for q in summary if q['l2']==l2 and q['interpolatedSeeds']==q['seedCount']),None) for l2 in p['l2']}})
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.grid':True,'grid.alpha':.2})
    blue,orange='#2563eb','#c45b10'
    for loss in [False,True]:
        fig,axes=plt.subplots(1,2,figsize=(12,4.8),sharey=True)
        for ax,l2 in zip(axes,p['l2']):
            group=[q for q in summary if q['l2']==l2];counts=[q['parameters'] for q in group]
            for key,color,label in [('train',blue,'Training originals (750)'),('validation',orange,'Reused validation (48)')]:
                values=np.array([[z['trace'][-1][key]['jointNLL'] if loss else 100*(1-z['trace'][-1][key]['exactMatch']) for z in runs if z['width']==q['width'] and z['l2']==l2] for q in group])
                ax.plot(counts,values.mean(axis=1),'-o',ms=4,color=color,label=label);ax.fill_between(counts,values.min(axis=1),values.max(axis=1),color=color,alpha=.15)
            if not loss:
                ax.plot(counts,[100*(1-q['allTrainingRowsExactMean']) for q in group],':s',ms=3,color='#0f766e',label='All fitting rows (890)')
                first=next((q for q in group if q['interpolatedSeeds']==q['seedCount']),None)
                if first:ax.axvline(first['parameters'],color='#7c3aed',ls='--',lw=1,label='All 3 seeds fit every training row')
            ax.axvline(7500,color='#64748b',ls=':',lw=1,label='10 × original meanings')
            ax.set_xscale('log');ax.set(xlabel='Learned head coefficients (log scale)',title=f'Weight / pair L2 = {l2}');ax.legend(fontsize=8)
        axes[0].set_ylabel('Joint negative log likelihood' if loss else 'Exact label-set error (%)')
        fig.suptitle(f"Capacity sweep · {p['epochs']:,} fixed epochs · 540 to 531,477 parameters",fontweight='bold',fontsize=12)
        fig.text(.5,.015,'Three seeds: mean and min–max bands • no early stopping or calibration • reused validation, no test data',ha='center',fontsize=9,color='#475569')
        fig.tight_layout(rect=(0,.055,1,.91))
        name='capacity-loss' if loss else 'double-descent-curve'
        for suffix in ['png','pdf']:fig.savefig(r.OUT/f'{name}.{suffix}',dpi=180)
        plt.close(fig)
    fig,axes=plt.subplots(1,2,figsize=(12,4.8))
    for l2,style in [(0.,'-'),(.001,'--')]:
        q=next(z for z in runs if z['width']==max(p['widths']) and z['seed']==7919 and z['l2']==l2);trace=q['trace'];epochs=[z['epoch'] for z in trace]
        for key,color,label in [('train',blue,'Training'),('validation',orange,'Reused validation')]:
            axes[0].plot(epochs,[z[key]['jointNLL'] for z in trace],style,color=color,label=f'{label}, L2={l2}')
            axes[1].plot(epochs,[100*z[key]['exactMatch'] for z in trace],style,color=color,label=f'{label}, L2={l2}')
    axes[0].set(xlabel='Epoch',ylabel='Joint negative log likelihood');axes[1].set(xlabel='Epoch',ylabel='Exact label-set accuracy (%)',ylim=(0,102))
    for ax in axes:ax.legend(fontsize=8)
    fig.suptitle('512 → 1,024 → 6 joint head · 531,477 coefficients · fixed seed7919',fontweight='bold',fontsize=12)
    fig.text(.5,.015,'Same training budget and sample order • no early stopping/calibration • training means original meanings only',ha='center',fontsize=9,color='#475569')
    fig.tight_layout(rect=(0,.055,1,.91))
    for suffix in ['png','pdf']:fig.savefig(r.OUT/f'wide-training-curve.{suffix}',dpi=180)
    plt.close(fig)
    print({'runs':len(runs),'summary':str(r.OUT/'summary.json'),'conflictingIdenticalTrainingVectors':len(results['conflictingIdenticalTrainingVectors'])})
if __name__=='__main__':main()

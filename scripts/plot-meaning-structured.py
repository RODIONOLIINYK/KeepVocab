#!/usr/bin/env python3
"""Replay a frozen neural fit for diagnostic curves; never select on curves."""
import importlib.util,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('structured_curve_runner',ROOT/'scripts/train-meaning-structured.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
sys.path.insert(0,str(ROOT/'work/meaning-structured-plot'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
np,s=r.np,r.s

def main():
    selection=r.read(r.OUT/'selection.json');protocol=r.read(r.OUT/'protocol.json')
    assert selection['protocolFileSha256']==r.digest(r.OUT/'protocol.json')
    assert protocol['sources']['trainer']==r.digest(ROOT/'scripts/lib/meaning_structured.py')
    record=next(q for q in selection['finalists'] if q['id']==selection['bestNeuralCurveId'])
    saved=next(q for q in record['models'] if q['seed']==selection['exportSeed'])
    artifact=r.read(ROOT/saved['artifact']);assert r.digest(ROOT/saved['artifact'])==saved['artifactFileSha256']
    assert artifact['kind']=='model' and artifact['model']['family']!='svm'
    parts,_,dh,eh=r.m.load_partitions(['train','validation']);rows,x,y=parts['train'];vr,xv,yv=parts['validation']
    assert dh==selection['datasetFileSha256'] and eh==selection['embeddingsFileSha256']
    assert [q['id'] for q in rows]==protocol['trainIds'] and [q['id'] for q in vr]==protocol['validationIds']
    model=s.restore(artifact['model']);raw={k:v.copy() for k,v in model['params'].items()}
    if artifact['calibrationFolded']:
        c=artifact['calibration'];temp=c['temperature'];raw['outputBias'][:6]-=np.array(c['unaryOffsets'])
        if model['config']['context']:raw['outputBias'][6:]-=np.array(c['pairOffsets'])
        else:raw['couplings']-=np.array(c['pairOffsets'])
        for k in ['outputWeight','outputBias','skipWeight','couplings']:
            if k in raw:raw[k]*=temp
    epoch=model['optimizer']['selectedEpoch']
    replay=s.fit_neural(x,y,r.m.sample_weights(rows),model['config'],selection['exportSeed'],epochs=epoch,
        scoring_mask=r.m.scoring_mask(rows),diagnostic_monitor=(xv,yv))
    errors={k:float(np.max(np.abs(raw[k]-replay['params'][k]))) for k in raw}
    assert max(errors.values())<1e-10,errors
    for k in ['mean','scale','projection','projectScale']:
        if model['features'][k] is not None:np.testing.assert_array_equal(model['features'][k],replay['features'][k])
    trace=replay['optimizer']['monitorTrace'];inner=model['optimizer']['innerStop']['monitorTrace']
    controls=[q for q in selection['finalists'] if q['config'].get('capacitySweep')]
    assert len(controls)==10 and all(len(q['models'])==3 for q in controls)
    evidence={'schemaVersion':1,'selectionFileSha256':r.digest(r.OUT/'selection.json'),'protocolFileSha256':selection['protocolFileSha256'],
        'curveModelId':record['id'],'globallySelectedId':selection['selectedId'],'artifact':saved['artifact'],'artifactFileSha256':saved['artifactFileSha256'],
        'seed':selection['exportSeed'],'epochs':epoch,'curveType':'uncalibrated fixed-epoch full-refit diagnostic replay',
        'validationUsedForStopping':False,'testUsed':False,'parameterParityPassed':True,'maxAbsoluteParameterDifference':errors,
        'trainIds':protocol['trainIds'],'validationIds':protocol['validationIds'],'trace':trace,'innerStoppingTrace':inner,
        'capacityControls':[{'id':q['id'],'width':q['config']['width'],'l2':q['config']['l2'],
            'runs':[{'seed':z['seed'],'epoch':z['optimizer']['selectedEpoch'],'train':z['trainRaw'],'validation':z['validationRaw']} for z in q['models']]} for q in controls],
        'limitations':['Reused validation48 is diagnostic and selection-biased, not fresh confirmation.',
            'Training scores count750 original meanings once; training fitting includes890 original/paraphrase rows.',
            'Joint NLL is unregularized; optimizer uses joint NLL plus weight L2. Calibration follows training.',
            'Capacity bands are min/max across three seeds, not confidence intervals or evidence of double descent.']}
    r.write(r.OUT/'curves.json',evidence)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.grid':True,'grid.alpha':.2})
    blue,orange='#2563eb','#c45b10'
    def plot_trace(points,title,path,stopping=False):
        fig,axes=plt.subplots(1,2,figsize=(11.5,4.4));steps=[q['step'] for q in points]
        for ax,key,label,mult in [(axes[0],'JointNLL','Joint negative log likelihood',1),(axes[1],'Exact','Exact label-set accuracy (%)',100)]:
            ax.plot(steps,[q['train'+key]*mult for q in points],color=blue,label='Training originals')
            ax.plot(steps,[q['monitor'+key]*mult for q in points],color=orange,label='Inner stopping monitor' if stopping else 'Reused validation (48)')
            ax.axvline(epoch,color='#64748b',ls='--',lw=1,label=f'Chosen epoch {epoch}')
            ax.set(xlabel='Epoch',ylabel=label);ax.legend(fontsize=8)
            if key=='Exact':ax.set_ylim(0,102)
        fig.suptitle(title,fontweight='bold',fontsize=12)
        fig.text(.5,.015,'Six fixed original-policy labels • text embeddings only • no test data • curves before calibration',ha='center',fontsize=9,color='#475569')
        fig.tight_layout(rect=(0,.055,1,.91))
        for suffix in ['png','pdf']:fig.savefig(r.OUT/f'{path}.{suffix}',dpi=180)
        plt.close(fig)
    plot_trace(trace,f"{record['id']} · {record['config']['family']} · width {record['config']['width']} · fixed seed7919",'training-curve')
    plot_trace(inner,f"{record['id']} · separate inner fit used to choose the epoch",'inner-stopping-curve',True)
    fig,axes=plt.subplots(1,2,figsize=(11.5,4.6),sharey=True)
    for ax,l2 in zip(axes,[.001,.01]):
        selected=sorted([q for q in controls if q['config']['l2']==l2],key=lambda q:q['config']['width']);widths=[q['config']['width'] for q in selected]
        for metric,color,label in [('trainRaw',blue,'Training originals'),('validationRaw',orange,'Reused validation (48)')]:
            values=np.array([[z[metric]['exactMatch']*100 for z in q['models']] for q in selected]);ax.plot(widths,values.mean(axis=1),'-o',color=color,label=label)
            ax.fill_between(widths,values.min(axis=1),values.max(axis=1),color=color,alpha=.15)
        ax.set(xlabel='Hidden units (tanh)',title=f'Weight L2 = {l2}',ylim=(40,102));ax.set_xscale('log',base=2);ax.set_xticks(widths,labels=[str(v) for v in widths]);ax.legend(fontsize=9)
    axes[0].set_ylabel('Exact label-set accuracy (%)')
    fig.suptitle('Does increasing capacity close the generalization gap?',fontweight='bold',fontsize=12)
    fig.text(.5,.015,'Means and min–max bands across three fixed seeds • same optimizer/batch/learning rate • grouped inner stopping',ha='center',fontsize=9,color='#475569')
    fig.tight_layout(rect=(0,.055,1,.91))
    for suffix in ['png','pdf']:fig.savefig(r.OUT/f'capacity-curve.{suffix}',dpi=180)
    plt.close(fig)
    print({'model':record['id'],'globallySelected':selection['selectedId'],'epoch':epoch,'parameterMaxError':max(errors.values()),'output':str(r.OUT/'training-curve.png')})
if __name__=='__main__':main()

#!/usr/bin/env python3
"""Parity-verified replay of selected early-stop checkpoint, plots and timings."""
import importlib.util,platform,statistics,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('early_l2_plot',ROOT/'scripts/train-meaning-early-l2.py')
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
r,s,np=e.r,e.s,e.np
sys.path.insert(0,str(ROOT/'work/meaning-structured-plot'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
def main():
    sel=r.read(e.OUT/'selection.json');p=r.read(e.OUT/'protocol.json');assert sel['protocolFileSha256']==r.digest(e.OUT/'protocol.json')
    assert p['sources']['runner']==r.digest(ROOT/'scripts/train-meaning-early-l2.py') and p['sources']['trainer']==r.digest(ROOT/'scripts/lib/meaning_structured.py')
    a=r.read(ROOT/sel['selectedArtifact']);assert sel['selectedArtifactSha256']==r.digest(ROOT/sel['selectedArtifact'])
    model=s.restore(a['model']);part=a['fitPartition'];parts,_,dh,eh=r.m.load_partitions(['train','validation']);rows,x,y=parts['train'];vr,xv,yv=parts['validation']
    assert dh==sel['datasetFileSha256'] and eh==sel['embeddingsFileSha256']
    assert [q['id'] for q in rows]==p['trainIds'] and [q['id'] for q in vr]==p['validationIds']
    tr=np.array(part['trainIndices']);monitor=np.array(part['monitorIndices']);mask=r.m.scoring_mask([rows[i] for i in tr]);w=r.m.sample_weights(rows)
    epoch=model['optimizer']['selectedEpoch'];executed=model['optimizer']['epochsExecuted']
    checkpoint=s.fit_neural(x[tr],y[tr],w[tr],model['config'],7919,epochs=epoch,scoring_mask=mask,diagnostic_monitor=(xv,yv))
    errors={k:float(np.max(np.abs(model['params'][k]-checkpoint['params'][k]))) for k in model['params']};assert max(errors.values())==0.,errors
    full=checkpoint if epoch==executed else s.fit_neural(x[tr],y[tr],w[tr],model['config'],7919,epochs=executed,scoring_mask=mask,diagnostic_monitor=(xv,yv))
    assert full['optimizer']['monitorTrace'][:epoch+1]==checkpoint['optimizer']['monitorTrace']
    monitor_trace=model['optimizer']['monitorTrace'];trace=full['optimizer']['monitorTrace']
    r.write(e.OUT/'curves.json',{'schemaVersion':1,'selectionFileSha256':r.digest(e.OUT/'selection.json'),'artifactFileSha256':sel['selectedArtifactSha256'],
        'selectedId':sel['selectedId'],'seed':7919,'selectedEpoch':epoch,'executedEpochs':executed,'parameterParityPassed':True,'parameterMaxAbsoluteErrors':errors,
        'validationUsedForStopping':False,'testUsed':False,'checkpointRestored':True,'refitOnMonitor':False,'trainIds':part['trainIds'],'stoppingIds':part['stoppingIds'],
        'validationIds':p['validationIds'],'trainingOriginalCount':int(mask.sum()),'trace':trace,'actualStoppingTrace':monitor_trace,
        'note':'Fixed-seed post-selection diagnostic replay. Original fitting rows only, same initialization/sample ordering. Validation48 is reused and never chooses epochs. Purple curve beyond restored checkpoint is diagnostic only.'})
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.grid':True,'grid.alpha':.2})
    fig,axes=plt.subplots(1,2,figsize=(12,4.8));steps=[q['step'] for q in trace]
    for ax,key,label,mult in [(axes[0],'JointNLL','Joint negative log likelihood',1),(axes[1],'Exact','Exact label-set accuracy (%)',100)]:
        ax.plot(steps,[q['train'+key]*mult for q in trace],color='#2563eb',label=f'Fitting originals ({int(mask.sum())})')
        ax.plot([q['step'] for q in monitor_trace],[q['monitor'+key]*mult for q in monitor_trace],color='#c45b10',label=f'Training-only stop monitor ({len(monitor)})')
        ax.plot(steps,[q['monitor'+key]*mult for q in trace],color='#9333ea',ls=':',label=f'Reused validation ({len(vr)}), diagnostic')
        ax.axvline(epoch,color='#475569',ls='--',lw=1,label=f'Restored epoch {epoch}')
        ax.set(xlabel='Epoch',ylabel=label);ax.legend(fontsize=8)
        if key=='Exact':ax.set_ylim(0,102)
    cfg=model['config'];fig.suptitle(f"Early stopping + L2 · width {cfg['width']} · λ={cfg['l2']} · patience {cfg['patience']} · seed 7919",fontweight='bold',fontsize=12)
    fig.text(.5,.015,'Checkpoint restored without refitting • monitor families never fit weights or preprocessing • no test curves',ha='center',fontsize=9,color='#475569')
    fig.tight_layout(rect=(0,.055,1,.91))
    for suffix in ['png','pdf']:fig.savefig(e.OUT/f'training-curve.{suffix}',dpi=180)
    plt.close(fig)
    # Restore once before timing; no model conversion inside timed calls.
    prior_a=r.read(ROOT/'tests/fixtures/meaning-taxonomy/structured-heads/prior-compact.json.gz');prior=r.j.restore(prior_a['priorArtifact']['model']);row=x[:1];resources={}
    for name,fn,count in [('early-and-l2',lambda:np.exp(s.model_log_joint(model,row)),r.tensors(a)),('prior-compact',lambda:r.j.joint_probabilities(prior,row),4117)]:
        def call():
            q=fn();return q@s.P,s.P[q.argmax(axis=1)]
        for _ in range(20):call()
        timings=[]
        for _ in range(7):
            start=time.perf_counter()
            for _ in range(100):call()
            timings.append((time.perf_counter()-start)*1e6/100)
        resources[name]={'estimatedFP32KiB':count*4/1024,'inferenceNumericValueCount':count,'medianBatch1Microseconds':statistics.median(timings),'repeatMeansMicroseconds':timings}
    r.write(e.OUT/'resources.json',{'platform':platform.platform(),'machine':platform.machine(),'dtype':'float64','blasThreads':1,'models':resources,
        'method':'Preloaded model,20 warmups,median of7x100 batch1 calls. Includes preprocessing,joint probabilities,marginals,MAP. Excludes CLIP/loading/RPC/network. FP32 storage estimate includes preprocessing. Not mobile battery/latency evidence.'})
    print({'selected':sel['selectedId'],'epoch':epoch,'executed':executed,'parameterParity':max(errors.values()),'resources':resources})
if __name__=='__main__':main()

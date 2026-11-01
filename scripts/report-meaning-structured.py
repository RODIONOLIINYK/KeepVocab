#!/usr/bin/env python3
"""Post-selection timing and error diagnosis; never feeds the model search."""
import importlib.util,time,platform,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('structured_reporting',ROOT/'scripts/train-meaning-structured.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
np,s=r.np,r.s

def main():
    report=r.read(r.OUT/'report.json');selection=r.read(r.OUT/'selection.json')
    parts,*_=r.m.load_partitions(['train']);row=parts['train'][1][:1]
    resources={};benchmark=lambda fn:None
    for key,rec in report['models'].items():
        a=r.read(ROOT/rec['artifact']);model=s.restore(a['model']) if a['kind']=='model' else r.j.restore(a['priorArtifact']['model'])
        def call():
            if a['kind']=='prior-compact':joint=r.j.joint_probabilities(model,row)
            else:
                lp=s.model_log_joint(model,row);joint=np.exp(lp) if a['calibrationFolded'] else r.u.calibrate(lp,a['calibration'])
            return joint@r.j.PATTERNS,r.j.PATTERNS[joint.argmax(axis=1)]
        for _ in range(20):call()
        timings=[]
        for _ in range(7):
            start=time.perf_counter()
            for _ in range(100):call()
            timings.append((time.perf_counter()-start)*1e6/100)
        numeric=r.tensors(a)+(1 if a['kind']=='model' and model['family']=='svm' else 0)
        if a['kind']=='prior-compact':learned=3093;supports=0
        elif model['family']=='svm':learned=int(model['coefficients'].size+model['bias'].size+13);supports=len(model['supportVectors'])
        else:learned=sum(int(v.size) for v in model['params'].values());supports=0
        resources[key]={'artifact':rec['artifact'],'artifactFileSha256':rec['artifactFileSha256'],'compressedArtifactBytes':(ROOT/rec['artifact']).stat().st_size,
            'learnedHeadCoefficientCount':learned,'dataDerivedSupportVectorCount':supports,'inferenceNumericValueCount':numeric,'estimatedFP32KiB':numeric*4/1024,
            'medianBatch1Microseconds':statistics.median(timings),'repeatMeansMicroseconds':timings}
    r.write(r.OUT/'resources.json',{'platform':platform.platform(),'machine':platform.machine(),'processor':'Apple M5','dtype':'float64','blasThreads':1,
        'method':'Preloaded, restored model;20 warmups,7 repeats of100 batch1 calls. Includes preprocessing, joint probabilities, six marginals and MAP. Excludes CLIP, loading, RPC and network. Not phone/battery measurement.',
        'storage':'FP32 numeric inference tensor estimate; includes feature statistics/PCA/supports. Support data and derived transforms are not counted as learned head coefficients. JSON/optimizer/training traces excluded.',
        'models':resources})
    errors={};lookup={}
    for folder in ['expanded-1000','regularized-expansion']:
        for q in r.read(ROOT/f'tests/fixtures/meaning-taxonomy/{folder}/dataset.json')['items']:lookup[q['id']]=q
    for name,c in report['cohorts'].items():
        entries=[]
        for i,row in enumerate(c['rows']):
            q=np.array(c['predictions']['selected']['joint'][i]);pred=r.j.PATTERNS[q.argmax()]
            if np.all(pred==row['targets']):continue
            source=lookup[row['id']]
            entries.append({'id':row['id'],'word':source.get('word'),'meaning':source.get('meaning',source.get('definition')),
                'targets':row['targets'],'predicted':pred.tolist(),'MAPConfidence':float(q.max()),
                'missed':[label for k,label in enumerate(r.t.CATEGORIES) if row['targets'][k] and not pred[k]],
                'extra':[label for k,label in enumerate(r.t.CATEGORIES) if pred[k] and not row['targets'][k]]})
        errors[name]={'selectedErrors':entries,'perClass':c['metrics']['selected']['perClass']}
    r.write(r.OUT/'errors.json',{'usedForTrainingOrSelection':False,'labelChanges':False,'cohorts':errors})
    print({k:{z:round(v[z],2) for z in ['estimatedFP32KiB','medianBatch1Microseconds']} for k,v in resources.items()})
if __name__=='__main__':main()

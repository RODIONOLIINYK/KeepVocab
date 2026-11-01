#!/usr/bin/env python3
"""Versioned annotation revision; historical files and split exposure stay frozen."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from collections import Counter,defaultdict

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'work/meaning-taxonomy-training/python-libs'))
import numpy as np
from scipy.optimize import milp,Bounds,LinearConstraint
from scipy.sparse import coo_matrix

DIR='tests/fixtures/meaning-taxonomy/policy-v2'
BASE='tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json'
CATEGORIES=['entity','place','action','state','relation','abstract']
OUT=ROOT/DIR
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads((ROOT/p).read_bytes())
def encoded(v):return (json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode()
def norm(v):return ' '.join(str(v).strip().lower().split())
def record_hashes(path):
    script="import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const d=JSON.parse(readFileSync(process.argv[1]));console.log(JSON.stringify((Array.isArray(d)?d:d.items).map(r=>createHash('sha256').update(JSON.stringify(r)).digest('hex'))));"
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',script,str(ROOT/path)]))

def main():
    base=read(BASE);source=base['items'];newpath=f'{DIR}/new-annotations.json';decisionpath=f'{DIR}/review-decisions.json'
    new=read(newpath);decisions=read(decisionpath);review=read(f'{DIR}/review.json')
    assert len(source)==1420 and len(new)==360
    assert review['newAnnotationsFileSha256']==sha((ROOT/newpath).read_bytes())
    assert review['decisionsFileSha256']==sha((ROOT/decisionpath).read_bytes())
    assert review['policyFileSha256']==sha((OUT/'POLICY.md').read_bytes())
    oldbyid={r['id']:r for r in source};dec={r['id']:r for r in decisions}
    expected={r['id'] for r in source if r.get('kind')!='paraphrase'}
    assert set(dec)==expected and len(dec)==1280
    assert all(d['primaryReview']['status']=='reviewed' for d in decisions)
    b_hash=record_hashes(BASE);n_hash=record_hashes(newpath)
    rows=[];ledger=[];newheads=set();oldheads={norm(r['word']) for r in source}
    for i,original in enumerate(source):
        parent=original.get('sourceId') if original.get('kind')=='paraphrase' else original['id']
        d=dec[parent];assert d['oldLabels']==oldbyid[parent]['labels']
        assert d['word']==oldbyid[parent]['word'] and d['definition']==oldbyid[parent]['definition']
        labels=d['proposedLabels'];assert labels and labels==[c for c in CATEGORIES if c in labels]
        split='train' if original['split']=='train' else 'retired-validation' if 'validation' in original['split'] else 'retired-test'
        r=dict(original);r.update(labels=labels,targets=[int(c in labels) for c in CATEGORIES],
          anchorCategory=original['anchorCategory'] if original['anchorCategory'] in labels else labels[0],
          primaryClass=original['anchorCategory'] if original['anchorCategory'] in labels else labels[0],
          annotationPolicyVersion='v2',split=split,sourceSplit=original['split'],sourceGroupId=original['groupId'],
          sourceRecord={'file':BASE,'id':original['id'],'sha256':b_hash[i]},
          meaningUnitId=parent,sampleWeight=1.,rationale=d['reason'],
          previousAnnotation={'labels':original['labels'],'policyVersion':'v1'},
          review={'type':review['reviewType'],'status':'reviewed','decisionId':parent,'policyFileSha256':review['policyFileSha256']},
          ambiguous=bool(d['ambiguous']))
        # Historical evidence text described v1 routes; retain only in source.
        r.pop('requiredEvidence',None)
        rows.append(r)
        if labels!=original['labels']:
            ledger.append({'id':r['id'],'word':r['word'],'sourceSplit':original['split'],'oldLabels':original['labels'],'newLabels':labels,
              'reason':d['reason'],'inheritedFromParent':parent if r.get('kind')=='paraphrase' else None})
    for i,annotation in enumerate(new):
        r=dict(annotation);h=norm(r['word']);assert h not in oldheads and h not in newheads,h;newheads.add(h)
        assert r['labels']==[c for c in CATEGORIES if c in r['labels']] and r['anchorCategory'] in r['labels']
        assert r['review']['status']=='reviewed'
        r.update(targets=[int(c in r['labels']) for c in CATEGORIES],kind='new-meaning',annotationPolicyVersion='v2',
          sourceSplit=None,split=None,meaningUnitId=r['id'],sampleWeight=1.,
          sourceRecord={'file':newpath,'id':r['id'],'sha256':n_hash[i]})
        rows.append(r)
    assert len({r['id'] for r in rows})==1780
    # Headwords, families and explicitly reviewed links share one identity graph.
    parents=list(range(len(rows)));owners={};positions={r['id']:i for i,r in enumerate(rows)}
    def root(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    def join(a,b):parents[root(b)]=root(a)
    for i,r in enumerate(rows):
        keys=[('meaning',r['word']),('meaning',r['familyId'])]+[('meaning',v) for v in r.get('extraFamilyKeys',[])]
        if r.get('sourceGroupId'):keys.append(('oldgroup',r['sourceGroupId']))
        for kind,value in keys:
            k=kind+':'+norm(value)
            if k in owners:join(i,owners[k])
            else:owners[k]=i
        for link in [r.get('relatedExistingId'),r.get('sourceId')]:
            if link:
                assert link in positions,link;join(i,positions[link])
    groups=defaultdict(list)
    for i in range(len(rows)):groups[root(i)].append(i)
    available=[];quarantine=[]
    for members in groups.values():
        old_splits={rows[i]['split'] for i in members if rows[i]['sourceRecord']['file']==BASE}
        ambiguous=any(rows[i].get('ambiguous') for i in members)
        groupid='policy-v2-'+sha('\n'.join(sorted(rows[i]['id'] for i in members)).encode())[:16]
        for i in members:rows[i]['groupId']=groupid
        if len(old_splits)>1 or ambiguous:
            reason='Conflicting protected source partitions.' if len(old_splits)>1 else 'Unresolved selected-definition ambiguity under v2 policy.'
            for i in members:rows[i].update(split='quarantine',quarantineReason=reason)
            quarantine.append({'groupId':groupid,'ids':[rows[i]['id'] for i in members],'reason':reason})
        elif old_splits:
            split=next(iter(old_splits))
            for i in members:rows[i]['split']=split
        else:
            assert all(rows[i]['sourceRecord']['file']==newpath for i in members)
            available.append(members)
    # Labels-only partitioning, no model scores, vectors or difficulty filtering.
    n=len(available);cost=np.random.default_rng(20261101).uniform(0,1e-7,3*n)
    constraints=[];low=[];high=[]
    def add(entries,a,b):constraints.append(entries);low.append(a);high.append(b)
    for j in range(n):add({3*j+s:1 for s in range(3)},1,1)
    for s,count,anchors in [(1,60,10),(2,120,20)]:
        add({3*j+s:len(g) for j,g in enumerate(available)},count,count)
        for c in CATEGORIES:
            add({3*j+s:sum(rows[i]['anchorCategory']==c for i in g) for j,g in enumerate(available)},anchors,anchors)
        # Coverage strata are declared before encoding/fitting, not chosen from
        # which examples a model happens to get right.
        strata=[('entity','artifact',6 if s==1 else 12),
          ('entity','material',2 if s==1 else 4),('entity','organism',2 if s==1 else 4),
          ('place','natural-place',4 if s==1 else 8),('place','built-place',6 if s==1 else 12),
          ('relation','social-role',5 if s==1 else 10),('relation','physical-relation',5 if s==1 else 10)]
        for category,domain,target in strata:
            add({3*j+s:sum(rows[i]['anchorCategory']==category and rows[i].get('domain')==domain for i in g)
              for j,g in enumerate(available)},target,target)
    rr=[];cc=[];vv=[]
    for i,entry in enumerate(constraints):
        for j,v in entry.items():
            if v:rr.append(i);cc.append(j);vv.append(v)
    matrix=coo_matrix((vv,(rr,cc)),shape=(len(low),3*n)).tocsc()
    result=milp(cost,integrality=np.ones(3*n),bounds=Bounds(0,1),constraints=LinearConstraint(matrix,low,high),options={'time_limit':60})
    assert result.x is not None,result.message
    for j,g in enumerate(available):
        split=['train','validation','test'][int(np.argmax(result.x[3*j:3*j+3]))]
        for i in g:rows[i]['split']=split
    units=defaultdict(list)
    for r in rows:
        if r['split']=='train':units[r['meaningUnitId']].append(r)
    for members in units.values():
        for r in members:r['sampleWeight']=1/len(members)
    counts=Counter(r['split'] for r in rows)
    assert counts['validation']==60 and counts['test']==120
    sourcehashes={BASE:sha((ROOT/BASE).read_bytes()),newpath:sha((ROOT/newpath).read_bytes()),decisionpath:sha((ROOT/decisionpath).read_bytes()),f'{DIR}/POLICY.md':sha((OUT/'POLICY.md').read_bytes())}
    stats={split:{c:sum(r['sampleWeight'] for r in rows if r['split']==split and c in r['labels']) for c in CATEGORIES} for split in counts}
    dataset={'schemaVersion':1,'task':'meaning-category-membership','annotationPolicyVersion':'v2',
      'categories':CATEGORIES,'targetEncoding':'multilabel-binary-in-category-order','personalPreference':False,
      'sourceFilesSha256':sourcehashes,'quarantinedSourceIds':base['quarantinedSourceIds'],
      'counts':dict(counts),'weightedPositiveMemberships':stats,
      'splitProtocol':{'seed':20261101,'method':'Connected source/meaning identity groups; protected old exposure; labels-only fresh assignment.',
        'freshValidation':60,'freshTest':120,'oldEvaluationUsedForTraining':False,'modelScoresUsed':False,
        'freshCoverage':'Entity:60% artifacts,20% materials,20% organisms; place:40% natural,60% built/interior; relation:50% physical,50% social.'},
      'reviewType':review['reviewType'],'items':rows}
    data=encoded(dataset)
    manifest={'schemaVersion':1,'datasetFileSha256':sha(data),'policyFileSha256':review['policyFileSha256'],
      'sourceFilesSha256':sourcehashes,'sourceRowCount':1420,'reviewedSourceMeaningUnits':1280,'newMeaningCount':360,
      'counts':dict(counts),'trainingMeaningUnits':len(units),'labelChanges':ledger,'changedRowCount':len(ledger),
      'quarantine':quarantine,'weightedPositiveMemberships':stats,'freshGroups':len(available)}
    for name,b in [('dataset.json',data),('manifest.json',encoded(manifest))]:
        path=OUT/name
        if path.exists():assert path.read_bytes()==b,f'Frozen output changed: {path}'
        else:path.write_bytes(b)
    print(json.dumps({k:v for k,v in manifest.items() if k not in ['labelChanges','quarantine','sourceFilesSha256']},indent=2))

if __name__=='__main__':main()

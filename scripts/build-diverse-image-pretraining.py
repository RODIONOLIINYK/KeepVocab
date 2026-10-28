"""Build a reproducible, caption-grounded semantic dataset with disjoint photos.

Definitions/queries come from fixed rules, never CLIP's scores. All preferred
photos are distinct. Unreviewed examples are marked for review; caption absence
alone is not a verified wrong-meaning label. Raw photos stay outside the repo.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import random
import re
import time
import urllib.request

REVISION='9e50abcdc1361852f34841af4939cbcd2d37c92f'
BASE=f'https://huggingface.co/datasets/merve/coco/resolve/{REVISION}'
SEED=20261025

def digest(text):return hashlib.sha256(str(text).encode()).hexdigest()
def tokens(text):return set(re.findall(r'[a-z]{3,}',text.lower()))-{'the','and','with','that','this','there','some','very','from','onto','into','over','near','next','standing','sitting','front','behind','small','large','white','black','brown','man','woman','person','people','men','women','young','old'}
def download(url,path):
    if path.exists():return path.read_bytes()
    error=None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url,timeout=45) as response:data=response.read(3_000_001)
            if not data or len(data)>3_000_000:raise ValueError('Photo exceeds byte budget')
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);return data
        except Exception as e:error=e;time.sleep(min(8,2**attempt))
    raise RuntimeError(f'{url}: {error}')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--directory',default='work/image-pretraining-v2');ap.add_argument('--meanings',type=int,default=220);ap.add_argument('--galleries',type=int,default=4);args=ap.parse_args()
    root=Path(__file__).resolve().parents[1];directory=root/args.directory;directory.mkdir(parents=True,exist_ok=True)
    rules_doc=json.loads((root/'scripts/data/image-meaning-rules.json').read_text());rules=rules_doc['rules']
    caption_file=directory/'captions_val2017.json'
    annotation_sources={
        'captions_val2017.json':rules_doc['sourceSha256'],
        'instances_val2017.json':'e8c7f7908f1d7278341fae127d0da654f102f11bd7b21d8aeefa635b8c810b6f'
    }
    for name,checksum in annotation_sources.items():
        file=directory/name
        if not file.exists():
            with urllib.request.urlopen(BASE+'/annotations/'+name,timeout=60) as response:data=response.read(30_000_001)
            if len(data)>30_000_000 or hashlib.sha256(data).hexdigest()!=checksum:raise ValueError('Annotation source byte/hash mismatch: '+name)
            file.write_bytes(data)
        elif hashlib.sha256(file.read_bytes()).hexdigest()!=checksum:raise ValueError('Annotation source hash mismatch: '+name)
    raw=caption_file.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=rules_doc['sourceSha256']:raise ValueError('Caption source hash mismatch')
    source=json.loads(raw);images={p['id']:p for p in source['images']};captions=defaultdict(list)
    for c in source['annotations']:captions[c['image_id']].append(c)
    instances=json.loads((directory/'instances_val2017.json').read_text());objects=defaultdict(set)
    for a in instances['annotations']:objects[a['image_id']].add(a['category_id'])
    categories={c['name']:c['id'] for c in instances['categories']}
    aliases={'doughnut':'donut','sofa':'couch','television':'tv','mobile phone':'cell phone','sneaker':'shoe','racket':'tennis racket','wineglass':'wine glass'}
    def fulltext(pid):return ' '.join(c['caption'] for c in captions[pid])
    text_tokens={pid:tokens(fulltext(pid)) for pid in images}
    positives={};mentioned={}
    for rule in rules:
        pattern=re.compile(rule['positivePattern'],re.I);exclude=re.compile(rule['excludePattern'],re.I) if rule.get('excludePattern') else None
        mentioned[rule['key']]={pid for pid in images if any(pattern.search(c['caption']) for c in captions[pid])}
        positives[rule['key']]=[pid for pid in images if sum(bool(pattern.search(c['caption'])) for c in captions[pid])>=rule['captionAgreement'] and not(exclude and exclude.search(fulltext(pid)))]
    # Reserve distinct preferred photos, scarce meanings first. Prefer different
    # caption contexts within each meaning; no model predictions enter selection.
    preferred_used=set();available=[]
    for rule in sorted(rules,key=lambda r:(len(positives[r['key']]),digest(r['key']))):
        pool=[p for p in positives[rule['key']] if p not in preferred_used];chosen=[]
        while pool and len(chosen)<args.galleries:
            def priority(pid):
                sim=max((len(text_tokens[pid]&text_tokens[q])/max(1,len(text_tokens[pid]|text_tokens[q])) for q in chosen),default=0)
                return (sim,digest(f'{rule["key"]}:{pid}'))
            pid=min(pool,key=priority);chosen.append(pid);pool.remove(pid)
        if len(chosen)==args.galleries:available.append({**rule,'preferredIds':chosen});preferred_used.update(chosen)
    # Balance domains while retaining complete meaning families.
    grouped=defaultdict(list)
    for r in available:grouped[r['family']].append(r)
    families=list(grouped.values());families.sort(key=lambda rs:(0 if any(r['domain']=='actions' for r in rs) else 1,Counter(r['domain'] for r in available)[rs[0]['domain']],digest(rs[0]['family'])))
    # Exact-count subset sum prevents cutting a family at 60/20/20 boundaries.
    def subset(groups,total):
        dp={0:[]}
        for i,g in enumerate(groups):
            for n,ids in list(dp.items())[::-1]:
                if n+len(g)<=total and n+len(g) not in dp:dp[n+len(g)]=ids+[i]
        if total not in dp:raise ValueError('Cannot form requested complete-family split')
        selected=set(dp[total]);return [g for i,g in enumerate(groups) if i in selected],[g for i,g in enumerate(groups) if i not in selected]
    selected,unused=subset(families,args.meanings)
    # Deterministic shuffled families avoid grouping all rare domains into test.
    random.Random(SEED).shuffle(selected)
    test,remaining=subset(selected,args.meanings//5);validation,train=subset(remaining,args.meanings//5)
    partitions={'train':[r for g in train for r in g],'validation':[r for g in validation for r in g],'test':[r for g in test for r in g]}
    selected_rules=[r for rs in partitions.values() for r in rs];selected_by_key={r['key']:r for r in selected_rules}
    owner={pid:split for split,rs in partitions.items() for r in rs for pid in r['preferredIds']}
    for pid in images:
        if pid not in owner:owner[pid]='train' if int(digest(pid)[:8],16)%5<3 else 'validation' if int(digest(pid)[:8],16)%5==3 else 'test'
    pools={}
    for split,rs in partitions.items():
        references={pid for r in rs for pid in r['preferredIds']}
        extra=sorted((p for p in images if owner[p]==split and p not in references),key=lambda p:digest('pool:'+str(p)))[:len(rs)*3]
        pools[split]=sorted(references|set(extra))
    usage=Counter();cases=[];start=datetime(2026,10,26,tzinfo=timezone.utc)
    for split,rs in partitions.items():
        for rule in sorted(rs,key=lambda r:digest(r['key'])):
            category=categories.get(aliases.get(rule['word'],rule['word']))
            for j,winner in enumerate(rule['preferredIds']):
                forbidden=mentioned[rule['key']]|{winner}
                pool=[p for p in pools[split] if p not in forbidden and (category is None or category not in objects[p]) and usage[p]<8]
                contrasts=set()
                for key in rule.get('contrastKeys',[]):contrasts.update(positives.get(key,[]))
                # Hard contrast where available, plus varied independent contexts.
                hard=[p for p in pool if p in contrasts]
                def order(pid):return (usage[pid],-len(text_tokens[pid]&text_tokens[winner]),digest(f'{rule["key"]}:{j}:{pid}'))
                alternatives=[]
                if hard:alternatives.append(min(hard,key=order))
                remaining=[p for p in pool if p not in alternatives]
                # At most one close textual neighbor; other distractors come from
                # distinct captions/aspect ratios rather than near-duplicate frames.
                while len(alternatives)<4:
                    def diversity(pid):
                        sim=max((len(text_tokens[pid]&text_tokens[q])/max(1,len(text_tokens[pid]|text_tokens[q])) for q in alternatives),default=0)
                        return (usage[pid],sim,digest(f'alt:{rule["key"]}:{j}:{pid}'))
                    pid=min(remaining,key=diversity);alternatives.append(pid);remaining.remove(pid)
                ids=[winner,*alternatives];random.Random(f'{SEED}:{rule["key"]}:{j}').shuffle(ids)
                for pid in ids:usage[pid]+=1
                # Raw source constraints remain explicit. Visual review decides
                # what can be a semantic negative; no guessed labels are hidden.
                candidates=[]
                for pid in ids:
                    item=images[pid];candidates.append({'id':str(pid),'url':f'{BASE}/val2017/{item["file_name"]}','file':'images/'+item['file_name'],'source':'COCO val2017 human annotations via pinned public mirror','sourceUrl':item['flickr_url'].replace('http:','https:'),'licenseId':item['license'],'width':item['width'],'height':item['height'],'humanCaptions':captions[pid], 'annotatedObjects':sorted(objects[pid])})
                cases.append({'id':f'semantic-v2-{rule["key"]}-{j}','meaningId':'semantic-v2:'+rule['key'],'familyId':rule['family'],'split':split,'domain':rule['domain'],'occurredAt':(start+timedelta(seconds=len(cases))).isoformat().replace('+00:00','Z'),'word':{'word':rule['word'],'partOfSpeech':rule['partOfSpeech'],'definition':rule['definition'],'imageScenes':{'scenes':[rule['scene']]}},'candidates':candidates,'feedback':{'selected':[str(winner)],'wrong':[]},'annotation':{'positiveEvidence':'at least two independent original human captions','negativeEvidence':'pending independent visual review; caption absence alone is not a rejection','reviewStatus':'pending','categoryAbsenceChecked':category is not None,'contrastCandidateIds':[str(p) for p in alternatives if p in contrasts]}})
    (directory/'draft-metadata.json').write_text(json.dumps({'targetTask':'semantic','cases':cases,'rulesSha256':hashlib.sha256((root/'scripts/data/image-meaning-rules.json').read_bytes()).hexdigest()},indent=2)+'\n')
    used={int(p['id']) for c in cases for p in c['candidates']};print(json.dumps({'stage':'downloading','meanings':len(selected_rules),'galleries':len(cases),'photos':len(used)}),flush=True)
    with ThreadPoolExecutor(max_workers=10) as executor:
        pending={executor.submit(download,f'{BASE}/val2017/{images[pid]["file_name"]}',directory/'images'/images[pid]['file_name']):pid for pid in used}
        hashes={}
        for n,future in enumerate(as_completed(pending),1):
            pid=pending[future];hashes[pid]=hashlib.sha256(future.result()).hexdigest()
            if n%50==0 or n==len(pending):print(json.dumps({'downloaded':n,'total':len(pending)}),flush=True)
    for c in cases:
        for p in c['candidates']:p['sha256']=hashes[int(p['id'])]
    manifest={'version':2,'kind':'human-caption-grounded-diverse-semantic-photos','targetTask':'semantic','seed':SEED,'source':{'dataset':'COCO val2017','mirrorRevision':REVISION,'captionsUrl':BASE+'/annotations/captions_val2017.json','captionsSha256':hashlib.sha256(raw).hexdigest(),'instancesUrl':BASE+'/annotations/instances_val2017.json','instancesSha256':hashlib.sha256((directory/'instances_val2017.json').read_bytes()).hexdigest(),'rawImagesIncludedInRepository':False,'licenses':source['licenses']},'splitPolicy':'Complete meaning families and source photos/hashes disjoint; each preferred photo used once as a reference; candidate order randomized. Review occurs before any model scores.','cases':cases,'construction':{'rulesSha256':hashlib.sha256((root/'scripts/data/image-meaning-rules.json').read_bytes()).hexdigest(),'availableRules':len(rules),'supportedRulesWithDistinctReferences':len(available),'selectedMeanings':len(selected_rules),'candidateUseMaximum':max(usage.values()),'meaningsByDomain':dict(Counter(r['domain'] for r in selected_rules))}}
    (directory/'draft-cases.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'stage':'ready-for-review','path':str(directory/'draft-cases.json'),'construction':manifest['construction']}),flush=True)
if __name__=='__main__':main()

"""Add unused fixed meanings without reassigning any reviewed photo/split.

Produces new blind extra-*.jpg sheets. All additional labels still need review.
"""
from collections import defaultdict,Counter
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone,timedelta
import hashlib,importlib.util,json,random,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('dataset_builder',ROOT/'scripts/build-diverse-image-pretraining.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
base=ROOT/'work/image-pretraining-v2';source=json.loads((base/'review-source.json').read_text());rules=json.loads((ROOT/'scripts/data/image-meaning-rules.json').read_text())['rules']
if source.get('construction',{}).get('extension'):
    print('Extension already exists; original frozen partitions and reviews preserved.');raise SystemExit(0)
old_ids={c['id'] for c in source['cases']};used={c['meaningId'].split(':',1)[1] for c in source['cases']};new_rules=[r for r in rules if r['key'] not in used]
raw=json.loads((base/'captions_val2017.json').read_text());images={p['id']:p for p in raw['images']};captions=defaultdict(list)
for c in raw['annotations']:captions[c['image_id']].append(c)
owner={int(p['id']):c['split'] for c in source['cases'] for p in c['candidates']};reference_ids={int(c['feedback']['selected'][0]) for c in source['cases']};usage=Counter(int(p['id']) for c in source['cases'] for p in c['candidates'])
objects=defaultdict(set);instances=json.loads((base/'instances_val2017.json').read_text());categories={c['name']:c['id'] for c in instances['categories']}
for a in instances['annotations']:objects[a['image_id']].add(a['category_id'])
aliases={'doughnut':'donut','hot dog':'hot dog','orange':'orange'};extra=[];skipped=[]
for rule in sorted(new_rules,key=lambda r:r['candidateCount']):
 pattern=re.compile(rule['positivePattern'],re.I);exclude=re.compile(rule['excludePattern'],re.I) if rule.get('excludePattern') else None
 positive=[pid for pid in images if pid not in reference_ids and sum(bool(pattern.search(c['caption'])) for c in captions[pid])>=2 and not(exclude and any(exclude.search(c['caption']) for c in captions[pid]))]
 available={split:[p for p in positive if owner.get(p,split)==split] for split in ['train','validation','test']}
 preferred_split=['train','train','train','validation','test'][int(builder.digest(rule['key'])[:8],16)%5]
 split=max(available,key=lambda s:(min(4,len(available[s])),s==preferred_split,-len([c for c in extra if c['split']==s])))
 selected=sorted(available[split],key=lambda p:builder.digest(str(p)))[:4]
 if not selected:skipped.append(rule['key']);continue
 for pid in selected:owner[pid]=split;reference_ids.add(pid)
 category=categories.get(aliases.get(rule['word'],rule['word']))
 for j,winner in enumerate(selected):
  pool=[p for p in images if p!=winner and owner.get(p,split)==split and not any(pattern.search(c['caption']) for c in captions[p]) and (category is None or category not in objects[p]) and usage[p]<5]
  alternatives=sorted(pool,key=lambda p:(usage[p],builder.digest(f'extra:{rule["key"]}:{j}:{p}')))[:4]
  if len(alternatives)<4:raise ValueError('Insufficient distinct alternatives')
  ids=[winner,*alternatives];random.Random(f'extra:{rule["key"]}:{j}').shuffle(ids);photos=[]
  for pid in ids:
   owner[pid]=split;usage[pid]+=1;p=images[pid];photos.append({'id':str(pid),'url':builder.BASE+'/val2017/'+p['file_name'],'file':'images/'+p['file_name'],'source':'COCO val2017 human annotations via pinned public mirror','sourceUrl':p['flickr_url'].replace('http:','https:'),'licenseId':p['license'],'width':p['width'],'height':p['height'],'humanCaptions':captions[pid],'annotatedObjects':sorted(objects[pid])})
  extra.append({'id':f'semantic-v2-extra-{rule["key"]}-{j}','meaningId':'semantic-v2:'+rule['key'],'familyId':rule['family'],'split':split,'domain':rule['domain'],'occurredAt':(datetime(2026,10,27,tzinfo=timezone.utc)+timedelta(seconds=len(extra))).isoformat().replace('+00:00','Z'),'word':{'word':rule['word'],'partOfSpeech':rule['partOfSpeech'],'definition':rule['definition'],'imageScenes':{'scenes':[rule['scene']]}},'candidates':photos,'feedback':{'selected':[str(winner)],'wrong':[]},'annotation':{'positiveEvidence':'at least two original human captions','negativeEvidence':'pending independent blind visual review','reviewStatus':'pending','categoryAbsenceChecked':category is not None,'contrastCandidateIds':[]}})
photos={p['id']:p for c in extra for p in c['candidates']}
print(json.dumps({'newGalleries':len(extra),'newMeanings':len({c['meaningId'] for c in extra}),'sourcePhotos':len(photos),'skipped':skipped}),flush=True)
with ThreadPoolExecutor(max_workers=8) as executor:
 futures={executor.submit(builder.download,p['url'],base/p['file']):pid for pid,p in photos.items()};hashes={}
 for n,f in enumerate(as_completed(futures),1):
  hashes[futures[f]]=hashlib.sha256(f.result()).hexdigest()
  if n%50==0 or n==len(futures):print(json.dumps({'downloaded':n,'total':len(futures)}),flush=True)
for c in extra:
 for p in c['candidates']:p['sha256']=hashes[p['id']]
source['cases'].extend(extra);source['construction']['extension']={'galleries':len(extra),'meanings':len({c['meaningId'] for c in extra}),'skippedRules':skipped,'frozenExistingPartitions':True}
(base/'review-source.json').write_text(json.dumps(source,indent=2)+'\n')
# New sheets use the same blind presentation; existing sheets are untouched.
from PIL import Image,ImageOps,ImageDraw,ImageFont
font=lambda n:ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',n)
index=json.loads((base/'contact-sheets/blind-index.json').read_text())
for split in ['train','validation','test']:
 cases=[c for c in extra if c['split']==split]
 for start in range(0,len(cases),8):
  batch=cases[start:start+8];sheet=Image.new('RGB',(1150,225*len(batch)),(245,247,249));draw=ImageDraw.Draw(sheet)
  for r,c in enumerate(batch):
   y=r*225;draw.text((8,y+2),f'{c["id"]} | {c["word"]["word"]}: {c["word"]["definition"]}',font=font(15),fill='black')
   for col,p in enumerate(c['candidates']):
    with Image.open(base/p['file']) as im:tile=ImageOps.contain(im.convert('RGB'),(222,174));sheet.paste(tile,(col*230+(222-tile.width)//2,y+25+(174-tile.height)//2))
    draw.text((col*230+8,y+202),f'{col+1}: {p["id"]}',font=font(16),fill='black')
  name=f'extra-{split}-{start//8:03d}.jpg';sheet.save(base/'contact-sheets'/name,quality=90);index.append({'file':name,'split':split,'cases':[{'id':c['id'],'word':c['word'],'candidateIds':[p['id'] for p in c['candidates']]} for c in batch]})
(base/'contact-sheets/blind-index.json').write_text(json.dumps(index,indent=2)+'\n')
print('Blind extension sheets ready.',flush=True)

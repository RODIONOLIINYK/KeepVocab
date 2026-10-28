"""Prepare blind contact sheets, then apply explicit visual correctness reviews.

Uses Pillow only for local QA contact sheets and conservative duplicate checks.
No CLIP score or selected-photo marker is shown to the reviewers.
"""
import argparse
from collections import Counter,defaultdict
import hashlib,json,math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
def font(n):
    from PIL import ImageFont
    return ImageFont.truetype(FONT,n)
def dhash(image):
    gray=list(image.convert('L').resize((17,8)).getdata());value=0
    for y in range(8):
        for x in range(16):value=(value<<1)|int(gray[y*17+x]>gray[y*17+x+1])
    return value

def prepare(directory):
    from PIL import Image,ImageDraw,ImageOps,ImageStat
    source=json.loads((directory/'draft-cases.json').read_text());photos={p['id']:p for c in source['cases'] for p in c['candidates']};owners={p['id']:c['split'] for c in source['cases'] for p in c['candidates']}
    hashes={};quality=set()
    for pid,p in photos.items():
        with Image.open(directory/p['file']) as im:
            hashes[pid]=(dhash(im),im.width/im.height)
            if min(im.size)<90 or sum(ImageStat.Stat(im.convert('RGB')).stddev)/3<8:quality.add(pid)
    duplicate_pairs=[]
    ids=list(photos)
    for i,a in enumerate(ids):
        ha,aa=hashes[a]
        for b in ids[i+1:]:
            hb,ab=hashes[b]
            if owners[a]!=owners[b] and abs(math.log(aa/ab))<.03 and (ha^hb).bit_count()<=4:duplicate_pairs.append([a,b]);quality.update([a,b])
    cases=[];exclusions=[]
    for c in source['cases']:
        winner=c['feedback']['selected'][0]
        if winner in quality:exclusions.append({'id':c['id'],'reason':'source quality or cross-split near duplicate'});continue
        c['candidates']=[p for p in c['candidates'] if p['id'] not in quality]
        if len(c['candidates'])<2:exclusions.append({'id':c['id'],'reason':'not enough independent candidates'});continue
        cases.append(c)
    source['cases']=cases;source['preReviewExclusions']=exclusions;source['duplicateAudit']={'method':'128-bit difference hash, aspect ratio within3%, Hamming<=4; both sides of cross-split duplicate excluded','crossSplitPairs':duplicate_pairs,'qualityExcludedPhotoIds':sorted(quality)}
    (directory/'review-source.json').write_text(json.dumps(source,indent=2)+'\n')
    output=directory/'contact-sheets';output.mkdir(exist_ok=True);pages=[]
    for split in ['train','validation','test']:
        rows=[c for c in cases if c['split']==split]
        for start in range(0,len(rows),8):
            batch=rows[start:start+8];sheet=Image.new('RGB',(1150,225*len(batch)),(245,247,249));draw=ImageDraw.Draw(sheet)
            for r,c in enumerate(batch):
                y=r*225;draw.text((8,y+2),f'{c["id"]} | {c["word"]["word"]}: {c["word"]["definition"]}',font=font(15),fill=(0,0,0))
                for col,p in enumerate(c['candidates']):
                    with Image.open(directory/p['file']) as im:
                        tile=ImageOps.contain(im.convert('RGB'),(222,174));sheet.paste(tile,(col*230+(222-tile.width)//2,y+25+(174-tile.height)//2))
                    draw.text((col*230+8,y+202),f'{col+1}: {p["id"]}',font=font(16),fill=(0,0,0))
            name=f'{split}-{start//8:03d}.jpg';sheet.save(output/name,quality=90)
            pages.append({'file':name,'split':split,'cases':[{'id':c['id'],'word':c['word'],'candidateIds':[p['id'] for p in c['candidates']]} for c in batch]})
    (output/'blind-index.json').write_text(json.dumps(pages,indent=2)+'\n');print(json.dumps({'pages':len(pages),'cases':len(cases),'excluded':len(exclusions),'duplicates':len(duplicate_pairs),'bySplit':dict(Counter(c['split'] for c in cases))}))

def audit(directory):
    """Check new source photos without regenerating/reordering blind sheets."""
    from PIL import Image,ImageStat
    source=json.loads((directory/'review-source.json').read_text());photos={};owners={}
    for case in source['cases']:
        for photo in case['candidates']:
            if photo['id'] in owners and owners[photo['id']]!=case['split']:raise ValueError('Photo crosses partitions '+photo['id'])
            owners[photo['id']]=case['split'];photos[photo['id']]=photo
    signatures={};excluded=set()
    for pid,photo in photos.items():
        path=directory/photo['file']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=photo['sha256']:raise ValueError('Source photo hash mismatch '+pid)
        with Image.open(path) as im:
            signatures[pid]=(dhash(im),im.width/im.height)
            if min(im.size)<90 or sum(ImageStat.Stat(im.convert('RGB')).stddev)/3<8:excluded.add(pid)
    pairs=[];ids=list(photos)
    for i,a in enumerate(ids):
        ha,aa=signatures[a]
        for b in ids[i+1:]:
            hb,ab=signatures[b]
            if owners[a]!=owners[b] and abs(math.log(aa/ab))<.03 and (ha^hb).bit_count()<=4:pairs.append([a,b]);excluded.update([a,b])
    source['finalSourceAudit']={'verifiedSourcePhotos':len(photos),'crossSplitNearDuplicatePairs':pairs,'excludedPhotoIds':sorted(excluded),'method':'Exact SHA256 plus 128-bit difference hash/aspect-ratio cross-partition screening; not a guarantee of perceptual independence.'}
    (directory/'review-source.json').write_text(json.dumps(source,indent=2)+'\n');print(json.dumps(source['finalSourceAudit']))

def apply(directory):
    source=json.loads((directory/'review-source.json').read_text());reviews={};paths=sorted((directory/'reviews').glob('*.json'))
    for path in paths:
        data=json.loads(path.read_text());rows=data['reviews'] if isinstance(data,dict) else data
        for r in rows:
            if r['id'] in reviews:raise ValueError('Duplicate review '+r['id'])
            reviews[r['id']]=r
    expected={case['id'] for case in source['cases']}
    if set(reviews)!=expected:raise ValueError('Review coverage mismatch; missing='+str(sorted(expected-set(reviews)))+' unexpected='+str(sorted(set(reviews)-expected)))
    for review in reviews.values():
        values=[pid for key in ['fits','wrong','uncertain'] for pid in review.get(key,[])]
        if len(values)!=len(set(values)):raise ValueError('Candidate classified more than once '+review['id'])
    adjudications=[];secondaryFiles=[]
    for spotcheck in [directory/'independent-spotcheck.json',directory/'terra-independent-check.json']:
        if not spotcheck.exists():continue
        secondaryFiles.append({'file':spotcheck.name,'sha256':hashlib.sha256(spotcheck.read_bytes()).hexdigest()})
        for second in json.loads(spotcheck.read_text())['reviews']:
            first=reviews.get(second['id'])
            if not first:raise ValueError('Spot-check has no primary review '+second['id'])
            allids=set(first['fits'])|set(first['wrong'])|set(first['uncertain'])
            secondids=set(second['fits'])|set(second['wrong'])|set(second['uncertain'])
            if allids!=secondids:raise ValueError('Spot-check candidate mismatch '+second['id'])
            fits=set(first['fits'])&set(second['fits']);wrong=set(first['wrong'])&set(second['wrong']);uncertain=allids-fits-wrong
            reviews[second['id']]={**first,'fits':sorted(fits),'wrong':sorted(wrong),'uncertain':sorted(uncertain),'reviewer':first['reviewer']+'; independent check agreement'}
            adjudications.append({'id':second['id'],'disagreementIds':sorted(uncertain-(set(first['uncertain'])&set(second['uncertain'])))})
    quality=set(source.get('finalSourceAudit',{}).get('excludedPhotoIds',[]))
    accepted=[];exclusions=list(source.get('preReviewExclusions',[]));removed=0
    for c in source['cases']:
        r=reviews.get(c['id'])
        if not r:raise ValueError('Missing visual review '+c['id'])
        ids={p['id'] for p in c['candidates']};fits=set(r.get('fits',[]));wrong=set(r.get('wrong',[]));uncertain=set(r.get('uncertain',[]))
        if fits&wrong or fits&uncertain or wrong&uncertain or fits|wrong|uncertain!=ids:raise ValueError('Review does not classify every candidate '+c['id'])
        winner=c['feedback']['selected'][0]
        if winner in quality:exclusions.append({'id':c['id'],'reason':'final source quality/duplicate screening'});continue
        if winner not in fits:exclusions.append({'id':c['id'],'reason':'caption reference not independently verified as depicting meaning','review':r});continue
        # Other valid photos are not mislabeled as wrong. Keep only the known
        # valid reference and visually confirmed wrong-meaning alternatives.
        c['candidates']=[p for p in c['candidates'] if p['id']==winner or p['id'] in wrong and p['id'] not in quality]
        removed+=len(ids)-len(c['candidates'])
        if len(c['candidates'])<2:exclusions.append({'id':c['id'],'reason':'no verified wrong-meaning alternatives','review':r});continue
        c['feedback']['wrong']=[p['id'] for p in c['candidates'] if p['id']!=winner]
        c['annotation'].update({'negativeEvidence':'independent agent visual inspection of actual photos before model scoring','reviewStatus':'visually-reviewed','reviewer':r.get('reviewer','agent'),'removedAmbiguousOrAlsoValidIds':sorted((fits|uncertain)-{winner})})
        accepted.append(c)
    source['cases']=accepted;source['reviewAudit']={'reviewedGalleries':len(reviews),'retainedGalleries':len(accepted),'excludedGalleries':exclusions,'removedAmbiguousOrAlsoValidCandidates':removed,'reviewFiles':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths],'modelScoresVisibleToReviewers':False,'secondarySpotCheck':{'files':secondaryFiles,'cases':adjudications}}
    source['construction']['retainedMeanings']=len({c['meaningId'] for c in accepted});source['construction']['retainedComparisons']=sum(len(c['candidates'])-1 for c in accepted)
    (directory/'cases.json').write_text(json.dumps(source,indent=2)+'\n');print(json.dumps(source['construction'],indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('mode',choices=['prepare','apply','audit']);ap.add_argument('--directory',default='work/image-pretraining-v2');a=ap.parse_args();directory=ROOT/a.directory
    prepare(directory) if a.mode=='prepare' else audit(directory) if a.mode=='audit' else apply(directory)

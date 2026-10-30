"""Normalized-input fixed/tuned learning curves with raw-input references."""
import csv
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter
from lib.image_regularization import read


def save(fig,output,name):
 fig.savefig(output/(name+'.png'),dpi=180);path=output/(name+'.svg');fig.savefig(path,metadata={'Date':None});path.write_text('\n'.join(x.rstrip() for x in path.read_text().splitlines())+'\n');plt.close(fig)


def main():
 root=Path('work/image-input-scaling');parentroot=Path('work/image-regularization');output=Path(sys.argv[1] if len(sys.argv)>1 else 'docs/image-input-scaling');output.mkdir(exist_ok=True,parents=True)
 report,parent=read(root/'report.json.gz'),read(parentroot/'report.json.gz');plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none','svg.hashsalt':'input-scaling'})
 colors={'train':'#2563eb','validation':'#c56a16','test':'#8057ad'};csvrows=[]
 for arm in ['seen','unseen']:
  for family in ['scaled','scaled-l2']:
   l2=family.endswith('l2');sets=[('Raw inputs',parentroot,[r for r in parent['runs'] if r['config']['arm']==arm and r['config']['family']==('l2' if l2 else 'baseline')]),
     ('Input normalization, fixed LR',root,[r for r in report['runs'] if r['config']['arm']==arm and r['config']['name']in report['cohorts'][family+'-fixed']]),
     ('Input normalization, tuned LR',root,[r for r in report['runs'] if r['config']['arm']==arm and r['config']['name']in report['cohorts'][family+'-tuned']]),
     ('BatchNorm reference',parentroot,[r for r in parent['runs'] if r['config']['arm']==arm and r['config']['family']==('batchnorm-l2' if l2 else 'batchnorm')])]
   fig,axes=plt.subplots(2,4,figsize=(16,7),sharex=True,sharey='row')
   for col,(title,source,runs)in enumerate(sets):
    curves=[read(source/'runs'/r['config']['name']/'complete-curve.json.gz') for r in runs]
    for split in ['train','validation','test']:
     epochs=list(range(0,601,10)) if split=='test' else list(range(601))
     for row,key in [(0,'loss'),(1,'rankingError')]:
      values=np.asarray([[c[e][split][key] for e in epochs] for c in curves]);axes[row,col].plot(epochs,values.mean(0),color=colors[split],label=split.capitalize(),ls='--'if split=='test'else'-');axes[row,col].fill_between(epochs,values.min(0),values.max(0),color=colors[split],alpha=.1,lw=0)
    lr=runs[0]['config'].get('learningRate',.0002);axes[0,col].set_title(title+f'\nLR={lr:g}');axes[0,col].set_yscale('log');axes[1,col].set_xlabel('Epoch');axes[1,col].set_ylim(bottom=-.005);axes[1,col].yaxis.set_major_formatter(PercentFormatter(1,decimals=0))
    for row in range(2):axes[row,col].grid(axis='y',alpha=.2)
    if source==root:
     for run,curve in zip(runs,curves):
      for r in curve:csvrows.append({'arm':arm,'family':family,'panel':title,'seed':run['config']['seed'],'learning_rate':lr,'epoch':r['epoch'],'train_loss':r['train']['loss'],'validation_loss':r['validation']['loss'],'test_loss':r.get('test',{}).get('loss',''),'train_error':r['train']['rankingError'],'validation_error':r['validation']['rankingError'],'test_error':r.get('test',{}).get('rankingError','')})
   axes[0,0].set_ylabel('Pairwise data loss (log scale)');axes[1,0].set_ylabel('First-choice error');fig.legend(*axes[0,0].get_legend_handles_labels(),loc='upper center',bbox_to_anchor=(.5,.925),ncol=3,frameon=False)
   fig.suptitle(('Familiar'if arm=='seen'else'Unfamiliar')+' meanings · input normalization'+(' + L2=0.0001'if l2 else' without L2'),fontsize=15,y=.99);fig.text(.5,.943,'600 epochs; lines are three-seed means, shading is seed range. CLIP stays frozen.',ha='center');fig.text(.5,.018,'Normalization statistics use training inputs only. Test curves are post-hoc every10epochs, not used for tuning.',ha='center');fig.tight_layout(rect=[0,.05,1,.88]);save(fig,output,arm+'-'+family+'-learning-curves')
 with(output/'learning-curves.csv').open('w',newline='')as f:
  writer=csv.DictWriter(f,fieldnames=list(csvrows[0]),lineterminator='\n');writer.writeheader();writer.writerows(csvrows)


if __name__=='__main__':main()

#!/usr/bin/env python3
"""Standalone scientific figures for the classifier development diagnostics."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work/meaning-taxonomy-training/python-libs'))
import numpy as np
# Reuse the already installed project plotting runtime, without global installs.
sys.path.append(str(ROOT / 'work/mlp-fp16-retrain/python-libs'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

OUT = ROOT / 'docs/meaning-taxonomy-training/diagnostics'
report = json.loads((OUT / 'report.json').read_text())
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
colors = {'train': '#2166ac', 'validation': '#b35806'}

fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.2), constrained_layout=True)
history = report['optimizationTrace']
for split in ['train', 'validation']:
    axes[0].plot([r['iteration'] for r in history], [r[split]['bce'] for r in history], label=split.title(), color=colors[split])
axes[0].set(yscale='log', xlabel='L-BFGS optimization iteration', ylabel='Unweighted binary cross-entropy', title='Training fit versus generalization')
axes[0].legend()
records = report['sampleSizeLearningCurve']
for split in ['train', 'validation']:
    x, means, lows, highs = [], [], [], []
    for target in [24, 48, 96, 160, 244]:
        chosen = [r for r in records if r['targetCount'] == target]
        values = [r[split]['exactMatch'] * 100 for r in chosen]
        x.append(np.mean([r['actualCount'] for r in chosen]))
        means.append(np.mean(values)); lows.append(min(values)); highs.append(max(values))
    axes[1].plot(x, means, marker='o', label=split.title(), color=colors[split])
    axes[1].fill_between(x, lows, highs, color=colors[split], alpha=.15)
axes[1].axhline(97, color='#777777', linestyle='--', linewidth=1, label='97% goal')
axes[1].set(xlabel='Training meanings (whole family groups)', ylabel='All-label exact accuracy (%)', ylim=(0, 102),
            title='Data-size learning curve: three group orders')
axes[1].legend(fontsize=8)
fig.suptitle('32-unit category head: capacity is sufficient; validation remains limiting', fontsize=13)
fig.savefig(OUT / 'learning-curves.png', dpi=180)
fig.savefig(OUT / 'learning-curves.svg')
plt.close(fig)

fig, axes = plt.subplots(2, 3, figsize=(11.5, 7), constrained_layout=True)
raw = report['confidence']['rawReliability']['perClass']
cal = report['calibration']['selected']['validationReliability']['perClass']
for ax, a, b in zip(axes.flat, raw, cal):
    ax.plot([0, 1], [0, 1], '--', color='#777777', linewidth=1, label='Ideal')
    for name, record, color in [('Raw', a, '#2166ac'), ('Calibrated', b, '#b35806')]:
        bins = [r for r in record['bins'] if r['count']]
        ax.plot([r['meanPrediction'] for r in bins], [r['observedPositiveFraction'] for r in bins],
                marker='o', markersize=4, color=color, label=name)
    ax.set(xlim=(0, 1), ylim=(0, 1), xlabel='Mean predicted membership', ylabel='Observed positive fraction', title=a['category'].title())
axes.flat[0].legend(fontsize=8)
fig.suptitle('Reused validation reliability: sparse bins, not a calibration guarantee', fontsize=13)
fig.savefig(OUT / 'reliability.png', dpi=180)
fig.savefig(OUT / 'reliability.svg')
plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.2), constrained_layout=True)
curve = report['precisionTarget']['rawValidationThresholdCurve']
curve = [r for r in curve if r['microPrecision'] is not None]
axes[0].plot([r['microRecall'] * 100 for r in curve], [r['microPrecision'] * 100 for r in curve], color='#2166ac')
axes[0].axhline(97, color='#777777', linestyle='--', linewidth=1, label='97% precision goal')
point = report['precisionTarget']['rawValidationAtOOFThreshold']
if point:
    axes[0].scatter([point['microRecall'] * 100], [point['microPrecision'] * 100], color='#b35806', zorder=3, label='Training-OOF chosen cutoff')
axes[0].set(xlabel='Positive-label recall (%)', ylabel='Positive-label precision (%)', xlim=(0, 100), ylim=(0, 102), title='Higher precision sacrifices recovered labels')
axes[0].legend(fontsize=8)
curve = report['confidence']['rawSelectiveExactCurve']
curve = [r for r in curve if r['exactAccuracy'] is not None]
axes[1].plot([r['coverage'] * 100 for r in curve], [r['exactAccuracy'] * 100 for r in curve], color='#2166ac')
axes[1].axhline(97, color='#777777', linestyle='--', linewidth=1)
axes[1].set(xlabel='Meanings retained (%)', ylabel='All-label exact accuracy on retained meanings (%)',
            xlim=(0, 100), ylim=(0, 102), title='Abstention changes coverage; it does not fix errors')
fig.suptitle('Development-only precision and coverage diagnostics', fontsize=13)
fig.savefig(OUT / 'precision-coverage.png', dpi=180)
fig.savefig(OUT / 'precision-coverage.svg')
plt.close(fig)
print('Wrote learning-curves, reliability, and precision-coverage PNG/SVG figures.')

# Matplotlib emits spaces at path-command line endings; keep generated SVGs
# clean in repository diffs without changing their geometry.
for name in ("learning-curves.svg", "reliability.svg", "precision-coverage.svg"):
    path = OUT / name
    path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")

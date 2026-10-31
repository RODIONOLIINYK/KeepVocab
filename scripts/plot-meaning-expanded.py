#!/usr/bin/env python3
"""Reproduce the same-fresh-test comparison for the expanded 1,000-meaning run."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'work/meaning-taxonomy-training/python-libs'))
sys.path.append(str(ROOT / 'work/mlp-fp16-retrain/python-libs'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ARTIFACTS = ROOT / 'docs/meaning-taxonomy-training/expanded-1000'
report = json.loads((ARTIFACTS / 'report.json').read_text())
models = [
    ('original244-32', '244 meanings\nfixed 32-unit', '#64748b'),
    ('fixed-expanded-32', 'Expanded\nfixed 32-unit', '#d97706'),
    ('32', 'Expanded\ntuned 32-unit', '#2563eb'),
    ('linear', 'Expanded\nlinear', '#7c3aed'),
]
metrics = [
    ('exactMatch', 'Exact match'),
    ('macroF1', 'Macro F1'),
    ('microPrecision', 'Micro precision'),
    ('microRecall', 'Micro recall'),
]

plt.rcParams.update({
    'font.family': 'DejaVu Sans',
    'font.size': 10,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'svg.fonttype': 'none',
    'svg.hashsalt': 'expanded-1000-test-metrics',
})

fig, ax = plt.subplots(figsize=(11.5, 5.8), constrained_layout=True)
positions = np.arange(len(metrics))
width = 0.19
for model_index, (key, label, color) in enumerate(models):
    values = [report['results'][key]['test'][metric] * 100 for metric, _ in metrics]
    x = positions + (model_index - (len(models) - 1) / 2) * width
    bars = ax.bar(x, values, width=width, label=label.replace('\n', ' '), color=color, zorder=3)
    ax.bar_label(bars, fmt='%.1f', padding=2, fontsize=8, color='#334155')

ax.set_ylim(0, 108)
ax.set_ylabel('Score (%)')
ax.set_xticks(positions, [label for _, label in metrics])
ax.grid(axis='y', color='#cbd5e1', alpha=0.45, linewidth=0.8, zorder=0)
ax.tick_params(axis='x', length=0, pad=8)
ax.legend(frameon=False, ncol=2, loc='upper left')
fig.suptitle('Classifier results on the same 120 fresh test meanings', fontsize=14, color='#172033')
fig.text(
    0.5, -0.025,
    'Original 244-meaning head, fixed expanded-data control, tuned 32-unit head, and linear head; all evaluated on the frozen fresh test cohort.',
    ha='center', fontsize=9, color='#475569'
)

for extension in ('png', 'svg'):
    path = ARTIFACTS / f'test-metrics.{extension}'
    if extension == 'png':
        fig.savefig(path, dpi=180, bbox_inches='tight')
    else:
        fig.savefig(path, metadata={'Date': None}, bbox_inches='tight')
        path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines()) + '\n')
plt.close(fig)
print(f'Wrote {ARTIFACTS / "test-metrics.png"} and {ARTIFACTS / "test-metrics.svg"}')

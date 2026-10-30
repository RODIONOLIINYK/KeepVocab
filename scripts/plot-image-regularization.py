"""Exportable learning curves for the fixed-epoch L2/BatchNorm comparison."""
import csv
import gzip
import json
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter


def read(path):
    path = Path(path)
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())


def save(fig, directory, name):
    fig.savefig(directory/(name+'.png'), dpi=180)
    svg = directory/(name+'.svg')
    fig.savefig(svg, metadata={'Date': None})
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
    plt.close(fig)


def main():
    root, output = Path(sys.argv[1]), Path(sys.argv[2]); output.mkdir(exist_ok=True, parents=True)
    report = read(root/'report.json.gz')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
                         'axes.spines.right': False, 'svg.fonttype': 'none', 'svg.hashsalt': 'regularization-study'})
    labels = {'baseline': 'Baseline', 'l2': 'L2', 'batchnorm': 'Batch normalization', 'batchnorm-l2': 'Batch normalization + L2'}
    colors = {'train': '#2563eb', 'validation': '#c56a16', 'test': '#8057ad'}
    curves, csv_rows = {}, []
    for run in report['runs']:
        curve = read(root/'runs'/run['config']['name']/'complete-curve.json.gz'); curves[run['config']['name']] = curve
        for row in curve:
            csv_rows.append({'arm': run['config']['arm'], 'family': run['config']['family'], 'seed': run['config']['seed'],
                             'l2': run['config']['strength'], 'epoch': row['epoch'],
                             'train_loss': row['train']['loss'], 'validation_loss': row['validation']['loss'],
                             'test_loss': row.get('test', {}).get('loss', ''), 'train_error': row['train']['rankingError'],
                             'validation_error': row['validation']['rankingError'], 'test_error': row.get('test', {}).get('rankingError', ''),
                             'regularization_penalty': row['regularizationPenalty']})
    with (output/'learning-curves.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(csv_rows[0]), lineterminator='\n'); writer.writeheader(); writer.writerows(csv_rows)
    for arm in report['protocol']['arms']:
        fig, axes = plt.subplots(2, 4, figsize=(16, 7), sharex=True, sharey='row')
        for col, family in enumerate(report['protocol']['families']):
            runs = [r for r in report['runs'] if r['config']['arm'] == arm and r['config']['family'] == family]
            for split in ['train', 'validation', 'test']:
                epochs = list(range(0, 601, 10)) if split == 'test' else list(range(601))
                for row, key in [(0, 'loss'), (1, 'rankingError')]:
                    values = np.asarray([[curves[r['config']['name']][e][split][key] for e in epochs] for r in runs])
                    axes[row, col].plot(epochs, values.mean(0), color=colors[split], label=split.capitalize(), lw=1.6, ls='--' if split == 'test' else '-')
                    axes[row, col].fill_between(epochs, values.min(0), values.max(0), color=colors[split], alpha=.10, linewidth=0)
            strength = report.get('selection', {}).get('families', {}).get(family, {}).get('strength', runs[0]['config']['strength'])
            axes[0, col].set_title(labels[family]+(f'\nλ = {strength:g}' if strength else '\nNo L2'))
            axes[0, col].set_yscale('log')
            axes[1, col].set_xlabel('Epoch')
            axes[1, col].yaxis.set_major_formatter(PercentFormatter(1, decimals=0))
            axes[1, col].set_ylim(bottom=-.005)
            for row in range(2):
                axes[row, col].grid(axis='y', alpha=.2)
        axes[0, 0].set_ylabel('Pairwise data loss (log scale)')
        axes[1, 0].set_ylabel('First-choice error')
        handles, legend = axes[0, 0].get_legend_handles_labels()
        fig.legend(handles, legend, ncol=3, loc='upper center', bbox_to_anchor=(.5, .925), frameon=False)
        suffix = ' · 1027 inputs, no products' if report['protocol']['architecture'][0] == 1027 else ''
        fig.suptitle(('Familiar' if arm == 'seen' else 'Unfamiliar')+' meanings · fixed 600 epochs · frozen CLIP'+suffix, fontsize=16, y=.99)
        fig.text(.5, .943, 'Lines: mean of three seeds. Shading: seed range, not confidence intervals.', ha='center')
        fig.text(.5, .018, 'Test curves are post-hoc every 10 epochs; no test-driven selection. L2 penalty is excluded from these data-loss curves.', ha='center')
        fig.tight_layout(rect=[0, .05, 1, .88]); save(fig, output, arm+'-learning-curves')

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), sharey=True)
    markers, arm_colors = {'seen': 'o', 'unseen': '^'}, {'seen': '#2563eb', 'unseen': '#c56a16'}
    for ax, checkpoint in zip(axes, ['selected', 'last']):
        for i, family in enumerate(report['protocol']['families']):
            for arm in report['protocol']['arms']:
                values = [r['metrics']['test'][checkpoint]['chosenAt1'] for r in report['runs'] if r['config']['family'] == family and r['config']['arm'] == arm]
                x = i+(-.17 if arm == 'seen' else .17)
                ax.scatter([x+(k-1)*.035 for k in range(3)], values, marker=markers[arm], color=arm_colors[arm], s=45,
                           label=('Familiar meanings' if arm == 'seen' else 'Unfamiliar meanings') if i == 0 else None)
                ax.plot([x-.11, x+.11], [np.mean(values)]*2, color=arm_colors[arm])
        ax.axhline(report['clipTest']['chosenAt1'], color='#536171', ls='--', label='CLIP alone')
        ax.set_xticks(range(4), ['Baseline', 'L2', 'BatchNorm', 'BatchNorm\n+ L2'])
        ax.set_ylim(0, 21.5); ax.set_yticks(range(0, 22, 3)); ax.grid(axis='y', alpha=.2)
        ax.set_title('Best validation checkpoint' if checkpoint == 'selected' else 'Final epoch 600')
    axes[0].set_ylabel('Correct test choices /21'); axes[1].legend(frameon=False, loc='lower right')
    fig.suptitle('Four-way comparison · every dot uses the same 21 test galleries', fontsize=14)
    fig.text(.5, .015, 'Three seeds are not three independent test sets. Lines within groups show seed means.', ha='center')
    fig.tight_layout(rect=[0, .04, 1, .92]); save(fig, output, 'test-choices')

    tiny = read(root/'tiny.json.gz'); fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))
    for row in tiny['results']:
        curve = row['curve']; epochs = [r['epoch'] for r in curve]
        axes[0].plot(epochs, [r['train']['loss'] for r in curve], label=labels[row['family']])
        axes[1].plot(epochs, [r['train']['rankingError'] for r in curve], label=labels[row['family']])
    axes[0].set_yscale('log'); axes[0].set_ylabel('Training pairwise data loss (log scale)')
    axes[1].set_ylabel('Training first-choice error'); axes[1].yaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    for ax in axes:
        ax.set_xlabel('Epoch'); ax.grid(axis='y', alpha=.2)
    axes[0].legend(frameon=False)
    fig.suptitle('Eight-gallery memorization check · same recipe/kernel as full fitting', fontsize=13)
    fig.tight_layout(rect=[0, 0, 1, .92]); save(fig, output, 'tiny-overfit')


if __name__ == '__main__':
    main()

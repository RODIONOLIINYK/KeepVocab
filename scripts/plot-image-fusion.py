"""Standalone scientific figures for the equal-fusion training experiment.

Usage: python3 scripts/plot-image-fusion.py results-directory output-directory
Requires scripts/requirements-image-training.txt. Does not train/select a model.
"""
import argparse
import csv
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import MaxNLocator, PercentFormatter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('results')
    parser.add_argument('output')
    args = parser.parse_args()
    source, output = Path(args.results), Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    read = lambda name: json.loads((source / name).read_text())
    report, tiny, pilots, variance = (read(name) for name in ['training-report.json', 'small-batch.json', 'pilot-report.json', 'bias-variance.json'])
    recipe, curves = report['recipe'], report['curve']
    colors = {'train': '#2563eb', 'validation': '#c66c13', 'test': '#7b61a8'}
    styles = {'train': '-', 'validation': '-.', 'test': '--'}
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.titlesize': 13,
                         'axes.labelcolor': '#263342', 'text.color': '#263342', 'axes.edgecolor': '#87919d',
                         'figure.facecolor': 'white', 'axes.facecolor': 'white', 'savefig.facecolor': 'white',
                         'svg.fonttype': 'none', 'svg.hashsalt': 'keepvocab-fusion-v2', 'axes.spines.top': False, 'axes.spines.right': False})

    def finish(fig, name):
        fig.savefig(output / (name + '.png'), dpi=180)
        svg = output / (name + '.svg')
        fig.savefig(svg, metadata={'Date': None})
        svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n')
        plt.close(fig)

    def decorate(ax, xlabel='Epoch'):
        ax.set_xlabel(xlabel)
        ax.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=7))
        ax.grid(axis='y', color='#e6e9ee', linewidth=.7)

    def test_points():
        points = {row['epoch']: row['test'] for row in curves if row.get('test')}
        points[report['epochsRun']] = report['lastMetrics']['test']['fusion']
        return sorted(points.items())

    fig, axes = plt.subplots(1, 2, figsize=(12.4, 5.2))
    for split, key in [('train', 'train'), ('validation', 'selection')]:
        for ax, metric in zip(axes, ['loss', 'rankingError']):
            ax.plot([row['epoch'] for row in curves], [row[key][metric] for row in curves],
                    color=colors[split], linestyle=styles[split], linewidth=2, label=split.title())
    for ax, metric in zip(axes, ['loss', 'rankingError']):
        points = test_points()
        ax.plot([epoch for epoch, _ in points], [row[metric] for _, row in points],
                color=colors['test'], linestyle=styles['test'], marker='o', markersize=3, linewidth=1.8, label='Post-hoc test')
        ax.axvline(report['selectedEpoch'], color='#536070', linewidth=1.1, linestyle=':', label='Validation-selected checkpoint')
        decorate(ax)
        ax.set_xlim(0, report['epochsRun'])
    axes[0].set_yscale('log')
    axes[0].set_title('Unrestricted fusion: pairwise loss')
    axes[0].set_ylabel('Mean cross-entropy per gallery (log scale)')
    axes[1].set_title('First-choice ranking error')
    axes[1].set_ylabel('Galleries with the wrong top photo')
    axes[1].set_ylim(bottom=0)
    axes[1].yaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, fontsize=9, loc='upper center', bbox_to_anchor=(.5, .91), ncol=4)
    fig.suptitle('50% CLIP + 50% unrestricted MLP · full-data learning curves', y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.08, right=.98, top=.77, bottom=.22, wspace=.3)
    fig.text(.08, .10, f"LR {recipe['learningRate']}, batch {recipe['batchSize']}, L2=0, global norm clip=1; selected epoch {report['selectedEpoch']}, stopped at {report['epochsRun']}.", fontsize=10)
    fig.text(.08, .045, 'Test points were evaluated after selection. Training and validation meanings/photos are disjoint; this is a reused semantic regression set.', fontsize=9)
    finish(fig, 'learning-curves')

    fig, axes = plt.subplots(1, 2, figsize=(12.4, 4.8))
    x = [row['epoch'] for row in tiny['curve']]
    axes[0].plot(x, [row['train']['loss'] for row in tiny['curve']], color=colors['train'], linewidth=2)
    axes[0].set_yscale('log')
    axes[0].set_title('Training loss with no output cap')
    axes[0].set_ylabel('Pairwise cross-entropy (log scale)')
    axes[1].step(x, [row['train']['rankingError'] for row in tiny['curve']], where='post', color=colors['train'], linewidth=2)
    axes[1].set_title(f"First-choice accuracy: {tiny['curve'][0]['train']['chosenAt1']}/{recipe['batchSize']} → {tiny['after']['chosenAt1']}/{recipe['batchSize']}")
    axes[1].set_ylabel('Wrong top-photo choices')
    axes[1].set_ylim(-.025, 1.05)
    axes[1].yaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    for ax in axes:
        decorate(ax)
        ax.set_xlim(0, tiny['epochsRun'])
    fig.suptitle(f"Identical training settings · {recipe['batchSize']} galleries, {tiny['comparisons']} comparisons", y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.08, right=.98, top=.79, bottom=.23, wspace=.3)
    fig.text(.08, .10, f"Identical full/small recipe: LR {recipe['learningRate']}, batch {recipe['batchSize']}, L2=0, norm clip=1, epoch limit {recipe['epochs']}, patience {recipe['patience']}.", fontsize=9)
    fig.text(.08, .045, 'The tiny batch is also its selection data for this training-only diagnostic. There are no small-batch-only optimizer or model overrides.', fontsize=9)
    finish(fig, 'small-batch-overfit')

    rates = [.002, .0005, .0002]
    palette = {.002: '#c66c13', .0005: '#2563eb', .0002: '#7b61a8'}
    fig, axes = plt.subplots(2, 3, figsize=(14, 8), sharex=True, sharey='row')
    maximum_error = max(row['selection']['rankingError'] for trial in pilots['trials'] for row in trial['curve'])
    for column, batch in enumerate([8, 32, 64]):
        for trial in pilots['trials']:
            if trial['batchSize'] != batch:
                continue
            regularized = trial['regularization'] > 0
            for ax, key, metric in [(axes[0, column], 'train', 'loss'), (axes[1, column], 'selection', 'rankingError')]:
                ax.plot([row['epoch'] for row in trial['curve']], [row[key][metric] for row in trial['curve']],
                        color=palette[trial['learningRate']], linestyle=':' if regularized else '-', linewidth=1.7)
        axes[0, column].set_title(f'Configured batch {batch}')
        axes[0, column].set_yscale('log')
        baseline = report['metrics']['validation']['clip']['rankingError']
        axes[1, column].axhline(baseline, color='#536070', linewidth=1, linestyle='--')
        axes[1, column].yaxis.set_major_formatter(PercentFormatter(1, decimals=1))
        axes[1, column].set_ylim(0, max(.2, maximum_error * 1.08))
        for row in [0, 1]:
            decorate(axes[row, column])
            axes[row, column].set_xlim(0, 100)
            axes[row, column].set_xticks([0, 20, 40, 60, 80, 100])
        axes[0, column].set_xlabel('')
    axes[0, 0].set_ylabel('Training loss (log scale)')
    axes[1, 0].set_ylabel('Validation first-choice error')
    handles = [Line2D([0], [0], color=palette[lr], linewidth=2, label=f'LR {lr}') for lr in rates]
    handles += [Line2D([0], [0], color='#536070', linestyle=':', label='L2=0.001 matched control'),
                Line2D([0], [0], color='#536070', linestyle='--', label='CLIP validation baseline')]
    fig.legend(handles=handles, frameon=False, loc='upper center', bbox_to_anchor=(.5, .94), ncol=5, fontsize=9)
    fig.suptitle('Learning-rate and batch-size comparison · training / validation only', y=.99, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.07, right=.98, top=.85, bottom=.13, wspace=.12, hspace=.28)
    fig.text(.07, .04, 'All trials share initialization, 50/50 fusion, global norm clipping and stopping policy. Curves end where each trial stopped; no test result selected settings.', fontsize=9)
    finish(fig, 'tuning-grid')

    fig, axes = plt.subplots(1, 2, figsize=(12.4, 4.7))
    recorded = [row for row in curves if row['epoch'] > 0]
    axes[0].plot([row['epoch'] for row in recorded], [row['maximumGradientNorm'] for row in recorded], color=colors['train'], linewidth=1.8, label='Maximum pre-clip norm')
    axes[0].axhline(1, color='#536070', linewidth=1.1, linestyle='--', label='Global clipping limit')
    axes[0].set_yscale('log')
    axes[0].set_ylabel('L2 norm before clipping (log scale)')
    axes[0].set_title('Recorded gradient norms')
    axes[0].legend(frameon=False, fontsize=9)
    axes[1].bar([row['epoch'] for row in recorded], [row['clippedSteps'] for row in recorded], color=colors['validation'], width=.8)
    axes[1].set_title(f"Clipped updates: {report['clippedSteps']}/{report['steps']}")
    axes[1].set_ylabel('Updates whose global norm exceeded 1')
    axes[1].yaxis.set_major_locator(MaxNLocator(integer=True))
    for ax in axes:
        decorate(ax)
        ax.set_xlim(0, report['epochsRun'])
    fig.suptitle('Gradient monitoring · full-data fit', y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.08, right=.98, top=.79, bottom=.22, wspace=.3)
    fig.text(.08, .10, f"Maximum observed norm: {report['maximumObservedGradientNorm']:.6f}. Nonfinite gradients cause the fitter to reject the run.", fontsize=10)
    fig.text(.08, .045, 'Clipping scales the complete gradient vector; it does not cap MLP scores. Finite norms and a few clipped updates do not establish exploding gradients.', fontsize=9)
    finish(fig, 'gradient-norms')

    fig, ax = plt.subplots(figsize=(12, 4.9))
    decompositions = [variance, variance['lastCheckpoint']]
    maximum = max(row['expectedBrierError'] for row in decompositions)
    for y, row in enumerate(decompositions):
        bias, var = row['squaredBiasToFixedLabels'], row['predictionVariance']
        ax.barh(y, bias, color=colors['train'], height=.45)
        ax.barh(y, var, left=bias, color=colors['validation'], height=.45)
        ax.text(row['expectedBrierError'] + maximum * .02, y, f"{row['expectedBrierError']:.6f}", va='center')
    ax.set_yticks([0, 1], ['Validation-selected', 'Last fitted checkpoint'])
    ax.invert_yaxis()
    ax.set_xlim(0, maximum * 1.25)
    ax.set_xlabel('Gallery-weighted pairwise Brier error')
    ax.grid(axis='x', color='#e6e9ee', linewidth=.7)
    ax.set_axisbelow(True)
    handles = [Line2D([0], [0], color=colors['train'], linewidth=8, label='Squared error of mean prediction vs fixed labels'),
               Line2D([0], [0], color=colors['validation'], linewidth=8, label='Prediction variance')]
    fig.legend(handles=handles, frameon=False, fontsize=9, loc='upper center', bbox_to_anchor=(.6, .85), ncol=2)
    fig.suptitle(f"Empirical bias–variance identity · {variance['bootstrapModels']} resampled training fits", y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.22, right=.98, top=.72, bottom=.27)
    fig.text(.08, .13, 'Selected and last fitted models are shown separately so early checkpoint selection does not hide training variability.', fontsize=9)
    fig.text(.08, .075, 'True Bayes bias and irreducible label noise are unknown. Initialization and validation are fixed; training meaning families are resampled.', fontsize=9)
    fig.text(.08, .02, 'These logistic pair-order scores are not calibrated image-suitability probabilities; the test set is a reused semantic regression fixture.', fontsize=9)
    finish(fig, 'bias-variance')

    with (output / 'learning-curves.csv').open('w', newline='') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(['epoch', 'train_loss', 'validation_loss', 'posthoc_test_loss', 'train_top1_error', 'validation_top1_error', 'posthoc_test_top1_error', 'maximum_preclip_gradient_norm', 'clipped_updates'])
        test = dict(test_points())
        for row in curves:
            t = test.get(row['epoch'], {})
            writer.writerow([row['epoch'], row['train']['loss'], row['selection']['loss'], t.get('loss', ''), row['train']['rankingError'], row['selection']['rankingError'], t.get('rankingError', ''), row.get('maximumGradientNorm', ''), row.get('clippedSteps', '')])
    print(f'Rendered ten figure files and learning-curve CSV in {output}')


if __name__ == '__main__':
    main()

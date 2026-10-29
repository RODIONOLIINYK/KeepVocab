"""Render reproducible scientific figures from saved training diagnostics.

Usage: python3 scripts/plot-image-training.py results-directory output-directory
Requires numpy and matplotlib. No model training or checkpoint selection occurs.
"""
import argparse
import csv
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter, MaxNLocator


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('results')
    parser.add_argument('output')
    args = parser.parse_args()
    source, output = Path(args.results), Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    read = lambda name: json.loads((source / name).read_text())
    report, tiny, decomposition = read('training-report.json'), read('small-batch-overfit.json'), read('bias-variance.json')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.titlesize': 13,
                         'axes.labelcolor': '#263342', 'text.color': '#263342', 'axes.edgecolor': '#87919d',
                         'figure.facecolor': 'white', 'axes.facecolor': 'white', 'savefig.facecolor': 'white',
                         'svg.fonttype': 'none', 'svg.hashsalt': 'keepvocab-mlp-fp16', 'axes.spines.top': False, 'axes.spines.right': False})
    colors = {'train': '#2563eb', 'validation': '#c66c13', 'test': '#7b61a8'}
    styles = {'train': '-', 'validation': '-.', 'test': '--'}

    def finish(fig, name):
        fig.savefig(output / (name + '.png'), dpi=180)
        svg = output / (name + '.svg')
        fig.savefig(svg, metadata={'Date': None})
        svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n')
        plt.close(fig)

    with (output / 'learning-curves.csv').open('w', newline='') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(['epoch', 'selected_epoch_so_far', 'train_loss', 'validation_loss', 'test_loss',
                         'train_first_choice_error', 'validation_first_choice_error', 'test_first_choice_error'])
        for row in report['curves']:
            writer.writerow([row['epoch'], row['selectedEpoch']] + [row[s]['loss'] for s in ['train', 'validation', 'test']]
                            + [row[s]['rankingError'] for s in ['train', 'validation', 'test']])

    fig, axes = plt.subplots(1, 2, figsize=(12.4, 5.2))
    epochs = [row['epoch'] for row in report['curves']]
    for split in ['train', 'validation', 'test']:
        count = report['finalMetrics'][split]['mlp']['choices']
        for ax, metric in zip(axes, ['loss', 'rankingError']):
            ax.plot(epochs, [row[split][metric] for row in report['curves']],
                    color=colors[split], linestyle=styles[split], linewidth=2.1, label=f'{split.title()} (n={count})')
    for ax in axes:
        ax.axvline(report['selectedEpoch'], color='#536070', linewidth=1.1, linestyle=':', label='Selected checkpoint')
        ax.set_xlabel('Epoch')
        ax.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=8))
        ax.set_xlim(min(epochs), max(epochs))
        ax.set_ylim(bottom=0)
        ax.grid(axis='y', color='#e6e9ee', linewidth=.7)
    axes[0].set_title('Training objective: pairwise cross-entropy')
    axes[0].set_ylabel('Mean loss per gallery (lower is better)')
    axes[1].set_title('First-choice ranking error')
    axes[1].set_ylabel('Galleries with the wrong top photo')
    axes[1].yaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, fontsize=9, loc='upper center', bbox_to_anchor=(.5, .91), ncol=4)
    fig.suptitle('FP16 text + FP32 vision · 1,539 → 32 → 16 → 1 MLP', y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.08, right=.98, top=.77, bottom=.21, wspace=.28)
    fig.text(.08, .09, f"Validation selected epoch {report['selectedEpoch']}; training stopped at epoch {report['epochsRun']}.", fontsize=10)
    fig.text(.08, .045, 'Test curves were calculated after selection. This previously inspected benchmark measures meaning correctness, not personal taste.', fontsize=9)
    finish(fig, 'learning-curves')

    fig, axes = plt.subplots(1, 2, figsize=(12.4, 4.7))
    x = [row['epoch'] for row in tiny['curve']]
    axes[0].plot(x, [row['loss'] for row in tiny['curve']], color=colors['train'], linewidth=2, label='Training loss')
    floor = tiny['capacity']['optimisticLossLowerBound']
    axes[0].axhline(floor, color='#536070', linestyle='--', linewidth=1.2, label=f'Optimistic bounded-score floor ({floor:.4f})')
    axes[0].set_ylabel('Pairwise cross-entropy')
    axes[0].set_title('Loss under the production ±0.08 score bound')
    axes[0].set_ylim(bottom=0)
    axes[0].legend(frameon=False, fontsize=9, loc='upper right')
    axes[1].step(x, [row['rankingError'] for row in tiny['curve']], where='post', color=colors['train'], linewidth=2)
    axes[1].set_title(f"First-choice error · {tiny['before']['chosenAt1']}/8 → {tiny['after']['chosenAt1']}/8 correct")
    axes[1].set_ylabel('Wrong top-photo choices')
    axes[1].set_ylim(-.025, 1.05)
    axes[1].yaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    for ax in axes:
        ax.set_xlabel('Epoch')
        ax.set_xlim(0, max(x))
        ax.grid(axis='y', color='#e6e9ee', linewidth=.7)
    fig.suptitle(f"Small-batch memorization · 8 training mistakes, {tiny['comparisons']} comparisons", y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.08, right=.98, top=.8, bottom=.22, wspace=.28)
    fig.text(.08, .09, 'Same production forward pass, gradients and score bound; regularization and early stopping disabled for this diagnostic.', fontsize=9)
    fig.text(.08, .045, 'No validation/test examples were used. Memorization supports the fitter sanity check; it does not prove generalization.', fontsize=9)
    finish(fig, 'small-batch-overfit')

    fig, ax = plt.subplots(figsize=(11.6, 4.1))
    bias, variance, total = (decomposition[key] for key in ['squaredBiasToFixedLabels', 'predictionVariance', 'expectedBrierError'])
    ax.barh([0], [bias], color=colors['train'], height=.42, label=f'Squared mean prediction error vs fixed labels: {bias:.6f}')
    ax.barh([0], [variance], left=[bias], color=colors['validation'], height=.42, label=f'Prediction variance: {variance:.6f}')
    ax.text(total * 1.02, 0, f'Total: {total:.6f}', va='center', fontsize=11)
    ax.set_xlim(0, total * 1.35)
    ax.set_yticks([])
    ax.set_ylim(-.65, .65)
    ax.set_xlabel('Gallery-weighted pairwise Brier error (lower is better)')
    ax.grid(axis='x', color='#e6e9ee', linewidth=.7)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, fontsize=10, loc='upper left', bbox_to_anchor=(0, 1.22))
    fig.suptitle(f"Empirical bias–variance identity · {decomposition['bootstrapModels']} resampled training fits", y=.98, fontsize=15, fontweight='bold')
    fig.subplots_adjust(left=.07, right=.98, top=.67, bottom=.3)
    fig.text(.07, .14, 'Bias here means squared error of the average prediction against the fixed reviewed labels; Bayes bias is unknown.', fontsize=9)
    fig.text(.07, .085, 'Irreducible label noise is not identifiable. Initialization and validation are fixed; training meaning families are resampled.', fontsize=9)
    fig.text(.07, .03, 'These logistic pair-order scores are not calibrated suitability probabilities. The test set is a reused regression fixture.', fontsize=9)
    finish(fig, 'bias-variance')
    print(f'Rendered six figure files in {output}')


if __name__ == '__main__':
    main()

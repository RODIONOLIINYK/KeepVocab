"""Static, exportable figures for the frozen paired meaning-shift experiment."""
import json
from pathlib import Path
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator


def main():
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    report = json.loads(source.read_text())
    output.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.spines.top': False,
                         'axes.spines.right': False, 'svg.fonttype': 'none', 'svg.hashsalt': 'meaning-shift'})
    colors = {'seen': '#2563eb', 'unseen': '#bc6825'}
    fig, axes = plt.subplots(2, 3, figsize=(14, 7), sharex='col', sharey='row')
    for col, seed in enumerate(report['protocol']['seeds']):
        for arm in ['seen', 'unseen']:
            run = next(r for r in report['runs'] if r['seed'] == seed and r['arm'] == arm)
            for name, style in [('train', '-'), ('validation', '--')]:
                axes[0, col].plot([r['epoch'] for r in run['curve']], [r[name]['loss'] for r in run['curve']],
                                  style, color=colors[arm], label=f'{arm.capitalize()}: {name}')
            axes[1, col].plot([r['epoch'] for r in run['curve']], [100*r['validation']['rankingError'] for r in run['curve']],
                              color=colors[arm], label=arm.capitalize())
        axes[0, col].set_yscale('log')
        axes[0, col].set_title(f'Initialization seed {seed}')
        axes[1, col].set_xlabel('Epoch')
        axes[1, col].xaxis.set_major_locator(MaxNLocator(integer=True, nbins=6))
        for row in range(2):
            axes[row, col].grid(axis='y', alpha=.2)
    axes[0, 0].set_ylabel('Pairwise loss (log scale)')
    axes[1, 0].set_ylabel('Validation first-choice error (%)')
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc='upper center', bbox_to_anchor=(.5, .95), ncol=4, frameon=False)
    fig.suptitle('Same meanings versus unseen meanings · identical held-out photographs', fontsize=16)
    fig.text(.5, .015, f'{report["sourceMeanings"]} held-out meanings; CLIP frozen; no test labels used for fitting, stopping or checkpoint selection.', ha='center')
    fig.tight_layout(rect=[0, .035, 1, .89])
    save(fig, output, 'learning-curves')

    n = report['baseline']['test']['choices']
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.7))
    for i, checkpoint in enumerate(['selected', 'last']):
        ax = axes[i]
        for j, arm in enumerate(['seen', 'unseen']):
            values = [r['metrics']['test'][checkpoint]['chosenAt1'] for r in report['runs'] if r['arm'] == arm]
            for k, value in enumerate(values):
                ax.scatter(j+(k-1)*.065, value, color=colors[arm], s=65, zorder=3)
            ax.plot([j-.16, j+.16], [sum(values)/len(values)]*2, color=colors[arm], linewidth=2)
        clip = report['baseline']['test']['chosenAt1']
        ax.axhline(clip, linestyle='--', color='#536171', label=f'CLIP: {clip}/{n}')
        ax.set_xticks([0, 1], ['Same meanings', 'Unseen meanings'])
        lower = max(0, min(r['metrics']['test'][checkpoint]['chosenAt1'] for r in report['runs'])-2)
        ax.set_ylim(lower, n+.4)
        ax.set_yticks(range(lower, n+1))
        ax.set_title('Validation-selected' if checkpoint == 'selected' else 'Final fitted (diagnostic)')
        ax.set_ylabel(f'Correct test choices (out of {n})')
        ax.grid(axis='y', alpha=.2)
        ax.legend(frameon=False)
    fig.suptitle('Test results · each dot is one seed, not an independent dataset', fontsize=14)
    fig.text(.5, .02, 'Small retrospective set: ties or zero-width bootstrap intervals do not establish equivalence.', ha='center', fontsize=10)
    fig.tight_layout(rect=[0, .06, 1, .93])
    save(fig, output, 'test-choices')


def save(fig, directory, name):
    fig.savefig(directory/(name+'.png'), dpi=180)
    svg = directory/(name+'.svg')
    fig.savefig(svg, metadata={'Date': None})
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
    plt.close(fig)


if __name__ == '__main__':
    main()

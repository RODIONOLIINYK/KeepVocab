#!/usr/bin/env python3
"""Describe frozen expanded heads; never refit, retune, or change labels."""
import importlib.util
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('expanded_training', ROOT / 'scripts/train-meaning-expanded.py')
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
np, t = e.np, e.t
parts, _, _, _ = e.load_partitions(['train', 'validation'])
report = {'schemaVersion': 1, 'weightsChanged': False, 'labelsChanged': False, 'testUsedForTuning': False, 'models': {}}
for name in ['linear', '32']:
    artifact = e.read(e.FIXTURE / f'classifier-{name}.json')
    report['models'][name] = {}
    for split, (rows, x, y) in parts.items():
        probabilities = e.candidate_probabilities(artifact, x)
        report['models'][name][split] = e.r.expanded_metrics(y, probabilities, artifact['decisionThreshold'])
trials = e.read(e.OUT / 'trials.json')
optimizers = [value for trial in trials for value in trial['optimizers']]
report['searchFits'] = {'count': len(optimizers), 'nonConvergedCount': sum(not x['success'] for x in optimizers),
                       'meaning': 'Exploratory fits hitting optimization limits are recorded, not claimed optimal.'}
# Test errors are descriptive only: the selection and report are already frozen.
labels = {row['id']: row for row in e.read(e.FIXTURE / 'dataset.json')['items']}
predictions = e.read(e.OUT / 'test-predictions.json')['rows']
model = e.read(e.FIXTURE / 'classifier.json'); selected = e.read(e.OUT / 'selection.json')['selectedArchitecture']
errors = []
for row in predictions:
    source = labels[row['id']]; p = row['probabilities'][selected]
    predicted = [c for c, v in zip(t.CATEGORIES, p) if v >= model['decisionThreshold']]
    if predicted != source['labels']:
        errors.append({'id': row['id'], 'word': source['word'], 'definition': source['definition'],
                       'referenceLabels': source['labels'], 'predictedLabels': predicted,
                       'probabilities': p, 'groupId': source['groupId']})
report['selectedFreshTestErrors'] = errors
report['interpretation'] = 'Reference labels are AI-reviewed and may have policy ambiguity. Error analysis does not establish annotation truth and does not relabel test errors.'
t.write_json(e.OUT / 'fit-diagnostics.json', report)
print(json.dumps({'searchFits': report['searchFits'], 'train': {name: {k: record['train'][k] for k in ['exactMatch', 'macroF1', 'bce']} for name, record in report['models'].items()}}, indent=2))

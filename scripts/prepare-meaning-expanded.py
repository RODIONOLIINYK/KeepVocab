#!/usr/bin/env python3
"""Build 1,000 reviewed text examples with isolated, balanced meaning groups."""
import importlib.util
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('meaning_trainer', ROOT / 'scripts/train-meaning-taxonomy.py')
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
np = t.np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import coo_matrix

OUT = ROOT / 'tests/fixtures/meaning-taxonomy/expanded-1000'
SOURCES = ['tests/fixtures/meaning-taxonomy/dataset.json', 'tests/fixtures/meaning-taxonomy/supplement/dataset.json',
           'tests/fixtures/meaning-taxonomy/expanded-1000/new-annotations.json']
SEED = 20261101


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def normalized(value):
    return ' '.join(str(value).strip().lower().split())


def main():
    review = json.loads((OUT / 'review.json').read_text())
    raw = {file: (ROOT / file).read_bytes() for file in SOURCES}
    data = {file: json.loads(value) for file, value in raw.items()}
    assert sha(raw[SOURCES[2]]) == review['newAnnotationsFileSha256']
    assert review['reviewedCount'] == 531
    rows, excluded = [], []
    for file in SOURCES:
        for original in data[file]['items']:
            if original.get('split') == 'quarantine':
                excluded.append(original['id']); continue
            row = {**original, 'sourceRecord': {'file': file, 'id': original['id'], 'sha256': sha(canonical(original))}}
            if file != SOURCES[2]:
                row['originalDatasetSplit'] = original['split']
                row['split'] = {'train': 'train', 'validation': 'legacy-validation', 'test': 'legacy-test'}[original['split']]
                row['originalDatasetGroupId'] = original['groupId']
                row['anchorCategory'] = original['primaryClass']
            else:
                row['split'] = None
                row['sourceKind'] = 'reviewed-expansion-1000'
                row['primaryClass'] = row['anchorCategory']
            rows.append(row)
    assert len(rows) == 1000 and len(excluded) == 5
    assert len({r['id'] for r in rows}) == 1000
    # Connect exact headwords, source families, synonyms/derivatives, and explicit
    # review links before any partition choice. No representation is fitted here.
    parents = list(range(len(rows)))
    def find(i):
        while i != parents[i]:
            parents[i] = parents[parents[i]]; i = parents[i]
        return i
    def join(i, j):
        parents[find(j)] = find(i)
    owners = {}; by_id = {r['id']: i for i, r in enumerate(rows)}
    for i, row in enumerate(rows):
        keys = ['word:' + normalized(row['word']), 'family:' + normalized(row['familyId'])]
        if row.get('originalDatasetGroupId'): keys.append('source-group:' + row['originalDatasetGroupId'])
        keys += ['extra:' + key for key in row.get('extraFamilyKeys', [])]
        for key in keys:
            if key in owners: join(i, owners[key])
            else: owners[key] = i
        if row.get('linkedExistingId'):
            assert row['linkedExistingId'] in by_id
            join(i, by_id[row['linkedExistingId']])
    groups = {}
    for i, row in enumerate(rows): groups.setdefault(find(i), []).append(i)
    decisions, locked = [], []
    for members in groups.values():
        partitions = {rows[i]['split'] for i in members if rows[i]['split'] is not None}
        assert len(partitions) <= 1, f'Conflicting old partitions in {[rows[i]["word"] for i in members]}'
        old_split = next(iter(partitions), None)
        group_id = 'expanded-family-' + sha('\n'.join(sorted(rows[i]['id'] for i in members)).encode())[:16]
        for i in members: rows[i]['groupId'] = group_id
        new = [i for i in members if rows[i]['split'] is None]
        if not new: continue
        if old_split and old_split != 'train':
            for i in new: rows[i]['split'] = old_split
            locked += new
        else:
            decisions.append({'new': new, 'forcedTrain': old_split == 'train', 'id': group_id})
    # MILP uses labels only to stratify and balance, never model scores. Exactly
    # twenty primary examples/category go into each NEW evaluation partition.
    g = len(decisions); split_names = ['train', 'validation', 'test']; residual_start = 3 * g
    variables = residual_start + 36
    cost = np.zeros(variables)
    rng = np.random.default_rng(SEED); cost[:residual_start] = rng.uniform(0, 1e-6, residual_start)
    cost[residual_start:] = 1
    cost[residual_start:residual_start + 12] = 2
    lower = np.zeros(variables); upper = np.full(variables, np.inf); upper[:residual_start] = 1
    integer = np.zeros(variables); integer[:residual_start] = 1
    coefficients, limits_low, limits_high = [], [], []
    def constraint(entries, lo, hi):
        coefficients.append(entries); limits_low.append(lo); limits_high.append(hi)
    for j, group in enumerate(decisions):
        constraint({j * 3 + s: 1 for s in range(3)}, 1, 1)
        if group['forcedTrain']:
            lower[j * 3] = upper[j * 3] = 1
            upper[j * 3 + 1] = upper[j * 3 + 2] = 0
    for s in [1, 2]:
        for category in t.CATEGORIES:
            entries = {j * 3 + s: sum(rows[i]['anchorCategory'] == category for i in group['new'])
                       for j, group in enumerate(decisions)}
            constraint(entries, 20, 20)
    base_train = np.asarray([r['targets'] for r in rows if r['split'] == 'train']).sum(axis=0)
    for s in range(3):
        for k, category in enumerate(t.CATEGORIES):
            entries = {j * 3 + s: sum(rows[i]['targets'][k] for i in group['new']) for j, group in enumerate(decisions)}
            p = residual_start + s * 12 + k * 2
            entries[p] = -1; entries[p + 1] = 1
            target = (125 - base_train[k]) if s == 0 else 28
            constraint(entries, target, target)
    rr, cc, vv = [], [], []
    for r, entries in enumerate(coefficients):
        for c, v in entries.items():
            if v: rr.append(r); cc.append(c); vv.append(v)
    matrix = coo_matrix((vv, (rr, cc)), shape=(len(coefficients), variables)).tocsc()
    result = milp(cost, integrality=integer, bounds=Bounds(lower, upper),
                  constraints=LinearConstraint(matrix, limits_low, limits_high),
                  options={'time_limit': 30, 'mip_rel_gap': .001})
    assert result.x is not None, str(result.message)
    for j, group in enumerate(decisions):
        assignment = result.x[j * 3:j * 3 + 3]
        assert max(assignment) > .9999
        split = split_names[int(np.argmax(assignment))]
        for i in group['new']: rows[i]['split'] = split
    counts, balance, primary = {}, {}, {}
    for split in ['train', 'validation', 'test', 'legacy-validation', 'legacy-test']:
        selected = [r for r in rows if r['split'] == split]
        counts[split] = len(selected)
        balance[split] = {c: sum(r['targets'][k] for r in selected) for k, c in enumerate(t.CATEGORIES)}
        primary[split] = {c: sum(r['anchorCategory'] == c for r in selected) for c in t.CATEGORIES}
    assert counts['validation'] == counts['test'] == 120
    assert min(balance['train'].values()) > 0
    assert max(balance['train'].values()) / min(balance['train'].values()) <= 1.6
    dataset = {'schemaVersion': 1, 'task': 'meaning-category-membership', 'categories': t.CATEGORIES,
               'targetEncoding': 'multilabel-binary-in-category-order', 'personalPreference': False,
               'sourceFilesSha256': {file: sha(value) for file, value in raw.items()},
               'quarantinedSourceIds': excluded, 'counts': counts, 'classBalance': balance,
               'primaryClassBalance': primary,
               'splitProtocol': {'seed': SEED, 'method': 'Pre-model mixed-integer group assignment; balanced primary classes in fresh evaluation; L1 training membership balance.',
                                 'freshEvaluation': '120 new validation and 120 new test examples; twenty primary examples/category each; no group or headword shared with train or legacy evaluation.',
                                 'legacy': 'Original validation/test remain retired diagnostics; related new meanings stay with the old group, never in train or the fresh sets.',
                                 'optimizerMessage': str(result.message), 'modelScoresUsed': False},
               'reviewType': review['reviewType'],
               'limitations': ['AI-authored/reviewed pilot; no independent human-expert annotation accuracy claim.',
                              'Class-balanced evaluation is not an estimate of real-app class prevalence.',
                              'Related examples share groups; 1000 rows do not imply 1000 independent meaning families.'], 'items': rows}
    encoded = (json.dumps(dataset, indent=2, ensure_ascii=False) + '\n').encode()
    if (OUT / 'dataset.json').exists():
        assert (OUT / 'dataset.json').read_bytes() == encoded, \
            'Frozen expanded dataset would change. Start a new versioned experiment; do not rewrite evaluated partitions.'
    (OUT / 'dataset.json').write_bytes(encoded)
    review['datasetFileSha256'] = sha(encoded)
    (OUT / 'review.json').write_text(json.dumps(review, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'counts': counts, 'trainMemberships': balance['train'], 'freshValidationMemberships': balance['validation'],
                      'freshTestMemberships': balance['test'], 'groups': len(groups), 'newRowsKeptWithLegacyEvaluation': len(locked)}, indent=2))


if __name__ == '__main__':
    main()

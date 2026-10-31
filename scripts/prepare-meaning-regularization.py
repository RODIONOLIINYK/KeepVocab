#!/usr/bin/env python3
"""Build the frozen, group-isolated 1,420-row meaning regularization fixture."""
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = 'tests/fixtures/meaning-taxonomy/expanded-1000/dataset.json'
OUT = ROOT / 'tests/fixtures/meaning-taxonomy/regularized-expansion'
ANNOTATION_PATH = 'tests/fixtures/meaning-taxonomy/regularized-expansion/new-annotations.json'
REVIEW_PATH = 'tests/fixtures/meaning-taxonomy/regularized-expansion/review.json'
MANIFEST_PATH = 'tests/fixtures/meaning-taxonomy/regularized-expansion/manifest.json'
DATASET_PATH = 'tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json'
CATEGORIES = ['entity', 'place', 'action', 'state', 'relation', 'abstract']
FRESH_PER_SPLIT = 48
FRESH_PRIMARY_PER_CATEGORY = 8
SEED = 20261031


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    """Match JSON.stringify for source-record hashing (UTF-8, compact JSON)."""
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False).encode('utf-8')


def norm(value):
    return ' '.join(str(value).strip().lower().split())


def labels_for(row):
    labels = row.get('labels')
    assert isinstance(labels, list) and labels, f"Missing labels for {row.get('id')}"
    assert len(set(labels)) == len(labels), f"Duplicate labels for {row.get('id')}"
    assert all(label in CATEGORIES for label in labels), f"Unknown labels for {row.get('id')}: {labels}"
    ordered = [label for label in CATEGORIES if label in labels]
    assert labels == ordered, f"Labels are not in category order for {row.get('id')}: {labels}"
    anchor = row.get('anchorCategory')
    assert anchor in labels, f"Anchor category is not a positive label for {row.get('id')}"
    return labels


class DSU:
    def __init__(self, size):
        self.parent = list(range(size))

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def join(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.parent[b] = a


def load_annotations(raw):
    parsed = json.loads(raw)
    rows = parsed if isinstance(parsed, list) else parsed.get('items')
    assert isinstance(rows, list), 'new-annotations.json must be an array or contain an items array.'
    assert len(rows) == 420, f'Expected exactly 420 annotations, got {len(rows)}.'
    assert len({r.get('id') for r in rows}) == len(rows), 'Duplicate annotation IDs.'
    return rows


def add_group_keys(row, index, dsu, owners):
    # Headwords and family aliases are one identity namespace, as in the audit.
    keys = [('meaning-family', row['word']), ('meaning-family', row['familyId'])]
    keys.extend(('meaning-family', key) for key in row.get('extraFamilyKeys', []))
    if row.get('originalDatasetGroupId'):
        keys.append(('old-source-group', row['originalDatasetGroupId']))
    if row.get('groupId') and row.get('sourceRecord', {}).get('file') == BASE_PATH:
        keys.append(('expanded-group', row['groupId']))
    if row.get('sourceGroupId'):
        keys.append(('expanded-group', row['sourceGroupId']))
    for kind, value in keys:
        key = kind + ':' + norm(value)
        if key in owners:
            dsu.join(index, owners[key])
        else:
            owners[key] = index


def build_groups(rows, old_by_id):
    dsu = DSU(len(rows))
    owners = {}
    by_id = {row['id']: i for i, row in enumerate(rows)}
    for i, row in enumerate(rows):
        add_group_keys(row, i, dsu, owners)
        for field in ('sourceId', 'relatedExistingId'):
            linked = row.get(field)
            if linked:
                assert linked in old_by_id, f'{field} points outside the frozen old dataset: {row["id"]} -> {linked}'
                dsu.join(i, by_id[linked])
    groups = defaultdict(list)
    for i in range(len(rows)):
        groups[dsu.find(i)].append(i)
    return list(groups.values())


def optimize_fresh_groups(rows, groups, labels):
    """Choose fresh-only groups using labels and primary classes only."""
    decisions = []
    fixed_train_new = []
    linked_retired = []
    for members in groups:
        old = [i for i in members if rows[i].get('_isOld')]
        new = [i for i in members if not rows[i].get('_isOld')]
        if not new:
            continue
        old_splits = {rows[i]['split'] for i in old}
        assert len(old_splits) <= 1, f'Connected old rows conflict across protected partitions: {[rows[i]["id"] for i in members]}'
        old_split = next(iter(old_splits), None)
        if old_split:
            for i in new:
                rows[i]['split'] = old_split
            if old_split == 'train':
                fixed_train_new.extend(i for i in new if rows[i]['kind'] == 'new-meaning')
            else:
                linked_retired.extend(new)
            continue
        assert all(rows[i]['kind'] == 'new-meaning' for i in new), \
            f'Paraphrases must connect to their old training source: {[rows[i]["id"] for i in new]}'
        decisions.append({'members': new})

    g = len(decisions)
    if not g:
        raise AssertionError('No fresh-only new-meaning groups are available for evaluation partitioning.')
    # Each group chooses one split. Extra variables represent absolute pairwise
    # differences in weighted training class membership; this objective uses no
    # model predictions or embedding values.
    split_names = ['train', 'validation', 'test']
    assignment_vars = 3 * g
    pairs = [(a, b) for a in range(len(CATEGORIES)) for b in range(a + 1, len(CATEGORIES))]
    diff_start = assignment_vars
    variable_count = diff_start + len(pairs)
    cost = np.zeros(variable_count)
    rng = np.random.default_rng(SEED)
    cost[:assignment_vars] = rng.uniform(0, 1e-7, assignment_vars)
    cost[diff_start:] = 1
    lower = np.zeros(variable_count)
    upper = np.full(variable_count, np.inf)
    upper[:assignment_vars] = 1
    integrality = np.zeros(variable_count)
    integrality[:assignment_vars] = 1
    constraints, lows, highs = [], [], []

    def add(entries, low, high):
        constraints.append(entries)
        lows.append(low)
        highs.append(high)

    for j, group in enumerate(decisions):
        add({3 * j + s: 1 for s in range(3)}, 1, 1)

    # Exactly 48 rows per fresh evaluation split and eight anchors/category.
    for split_index in (1, 2):
        add({3 * j + split_index: len(group['members']) for j, group in enumerate(decisions)},
            FRESH_PER_SPLIT, FRESH_PER_SPLIT)
        for category in CATEGORIES:
            add({3 * j + split_index: sum(rows[i]['anchorCategory'] == category for i in group['members'])
                 for j, group in enumerate(decisions)},
                FRESH_PRIMARY_PER_CATEGORY, FRESH_PRIMARY_PER_CATEGORY)

    base_train = np.zeros(len(CATEGORIES), dtype=float)
    for row in rows:
        if row.get('_isOld') and row['split'] == 'train':
            for k, category in enumerate(CATEGORIES):
                base_train[k] += category in row['labels']
    for i in fixed_train_new:
        for k, category in enumerate(CATEGORIES):
            base_train[k] += category in rows[i]['labels']
    group_memberships = np.asarray([
        [sum(category in rows[i]['labels'] for i in group['members']) for category in CATEGORIES]
        for group in decisions
    ], dtype=float)
    for pair_index, (a, b) in enumerate(pairs):
        entries = {}
        # Difference between class positives in weighted training data.
        for j, group in enumerate(decisions):
            diff = group_memberships[j, a] - group_memberships[j, b]
            if diff:
                entries[3 * j] = diff
        base_diff = base_train[a] - base_train[b]
        slack = diff_start + pair_index
        # d >= |base_diff + sum(diff_j * train_j)|
        entries[slack] = -1
        add(entries.copy(), -np.inf, -base_diff)
        entries[slack] = 1
        add(entries.copy(), -base_diff, np.inf)

    rr, cc, vv = [], [], []
    for r, entries in enumerate(constraints):
        for c, value in entries.items():
            if value:
                rr.append(r); cc.append(c); vv.append(value)
    matrix = coo_matrix((vv, (rr, cc)), shape=(len(constraints), variable_count)).tocsc()
    result = milp(cost, integrality=integrality, bounds=Bounds(lower, upper),
                  constraints=LinearConstraint(matrix, lows, highs),
                  options={'time_limit': 90, 'mip_rel_gap': .001})
    assert result.x is not None, f'Fresh split MILP failed: {result.message}'
    for j, group in enumerate(decisions):
        chosen = int(np.argmax(result.x[3 * j:3 * j + 3]))
        for i in group['members']:
            rows[i]['split'] = split_names[chosen]
    return {'optimizerMessage': str(result.message), 'freshOnlyGroups': len(decisions),
            'newLinkedToOldTrain': len(fixed_train_new), 'newLinkedToOldHeldout': len(linked_retired),
            'freshPerSplit': FRESH_PER_SPLIT, 'freshPrimaryPerCategory': FRESH_PRIMARY_PER_CATEGORY,
            'modelScoresUsed': False}


def finalize_groups(rows, groups):
    group_summary = []
    for members in groups:
        partitions = {rows[i]['split'] for i in members if rows[i]['split'] is not None}
        assert len(partitions) == 1, f'Connected group is not assigned one split: {[rows[i]["id"] for i in members]}'
        split = next(iter(partitions))
        old_ids = sorted({rows[i]['groupId'] for i in members if rows[i].get('_isOld')})
        if len(old_ids) == 1:
            group_id = old_ids[0]
        else:
            group_id = 'regularized-family-' + sha('\n'.join(sorted(rows[i]['id'] for i in members)).encode())[:16]
        for i in members:
            rows[i]['groupId'] = group_id
        group_summary.append({'groupId': group_id, 'split': split,
                              'ids': sorted(rows[i]['id'] for i in members),
                              'oldIds': sorted(rows[i]['id'] for i in members if rows[i].get('_isOld')),
                              'newIds': sorted(rows[i]['id'] for i in members if not rows[i].get('_isOld'))})
    return group_summary


def class_stats(rows, selected):
    count = len(selected)
    return {category: {'positive': sum(category in rows[i]['labels'] for i in selected),
                       'negative': count - sum(category in rows[i]['labels'] for i in selected)}
            for category in CATEGORIES}


def weighted_train_stats(rows):
    selected = [row for row in rows if row['split'] == 'train']
    total_weight = sum(row['sampleWeight'] for row in selected)
    return {category: {'positive': sum(row['sampleWeight'] for row in selected if category in row['labels']),
                       'negative': sum(row['sampleWeight'] for row in selected if category not in row['labels'])}
            for category in CATEGORIES}


def ratio(stats):
    positives = [entry['positive'] for entry in stats.values()]
    return max(positives) / min(positives)


def main():
    base_bytes = (ROOT / BASE_PATH).read_bytes()
    annotation_bytes = (ROOT / ANNOTATION_PATH).read_bytes()
    review_bytes = (ROOT / REVIEW_PATH).read_bytes()
    base = json.loads(base_bytes)
    annotations = load_annotations(annotation_bytes)
    review = json.loads(review_bytes)
    assert review.get('reviewedCount') == 420, 'Review must cover exactly 420 annotations.'
    assert review.get('reviewType') == 'AI semantic review; not human-expert ground truth'
    assert review.get('newAnnotationsFileSha256') == sha(annotation_bytes), 'Annotation review hash is stale.'
    assert len(base['items']) == 1000
    old_by_id = {row['id']: row for row in base['items']}
    assert len(old_by_id) == len(base['items'])

    rows = []
    for original in base['items']:
        row = dict(original)
        source_split = original['split']
        row['split'] = {'train': 'train', 'validation': 'legacy-validation', 'test': 'legacy-test',
                        'legacy-validation': 'legacy-validation', 'legacy-test': 'legacy-test'}[source_split]
        assert row['targets'] == [int(category in row['labels']) for category in CATEGORIES]
        assert row['anchorCategory'] in row['labels']
        row['sourceRecord'] = {'file': BASE_PATH, 'id': original['id'], 'sha256': sha(canonical(original))}
        row['meaningUnitId'] = original['id']
        row['sampleWeight'] = 1.0
        row['_isOld'] = True
        rows.append(row)

    old_headwords = {norm(row['word']) for row in base['items']}
    new_headwords = set()
    for annotation in annotations:
        for field in ('id', 'word', 'partOfSpeech', 'definition', 'familyId', 'anchorCategory'):
            assert isinstance(annotation.get(field), str) and annotation[field].strip(), \
                f'Missing {field} in annotation {annotation.get("id")}'
        kind = annotation.get('kind')
        assert kind in ('new-meaning', 'paraphrase'), f'Invalid kind in annotation {annotation["id"]}: {kind}'
        assert annotation.get('review', {}).get('status') == 'reviewed', f'Unreviewed annotation {annotation["id"]}'
        assert annotation.get('review', {}).get('type') == review['reviewType'], f'Review type mismatch: {annotation["id"]}'
        labels = labels_for(annotation)
        row = dict(annotation)
        row['kind'] = kind
        row['primaryClass'] = row.get('primaryClass', row['anchorCategory'])
        row['targets'] = [int(category in labels) for category in CATEGORIES]
        row['sourceKind'] = row.get('sourceKind', 'reviewed-regularization-expansion')
        row['sourceRecord'] = {'file': ANNOTATION_PATH, 'id': annotation['id'], 'sha256': sha(canonical(annotation))}
        row['split'] = None
        row['meaningUnitId'] = annotation['sourceId'] if kind == 'paraphrase' else annotation['id']
        row['sampleWeight'] = 1.0
        row['_isOld'] = False
        if kind == 'new-meaning':
            head = norm(row['word'])
            assert head not in old_headwords, f'New headword overlaps old dataset: {row["word"]}'
            assert head not in new_headwords, f'Repeated new headword: {row["word"]}'
            new_headwords.add(head)
            row.pop('sourceId', None)
            row.pop('sourceGroupId', None)
        else:
            source_id = annotation.get('sourceId')
            assert source_id in old_by_id, f'Paraphrase source is not an old row: {annotation["id"]}'
            source = old_by_id[source_id]
            assert source['split'] == 'train', f'Paraphrase source is not old TRAIN: {annotation["id"]}'
            for field in ('word', 'partOfSpeech', 'labels', 'anchorCategory'):
                assert row[field] == source[field], f'Paraphrase {field} differs from source: {annotation["id"]}'
            assert norm(row['definition']) != norm(source['definition']), f'Paraphrase text is unchanged: {annotation["id"]}'
            assert annotation.get('sourceGroupId') == source['groupId'], f'Paraphrase sourceGroupId mismatch: {annotation["id"]}'
            assert row['meaningUnitId'] == source_id
        rows.append(row)

    assert len({row['id'] for row in rows}) == 1420, 'Old and new IDs must be unique and total 1,420.'
    groups = build_groups(rows, old_by_id)
    # Keep split protection before solving. Old-only and old-linked groups can
    # never be reassigned; paraphrases have already been restricted to old train.
    for members in groups:
        old_splits = {rows[i]['split'] for i in members if rows[i]['_isOld']}
        assert len(old_splits) <= 1, f'Existing protected partitions conflict: {[rows[i]["id"] for i in members]}'
    split_info = optimize_fresh_groups(rows, groups, CATEGORIES)
    group_manifest = finalize_groups(rows, groups)

    # Preserve source fields without implementation-only markers.
    for row in rows:
        row.pop('_isOld', None)
    by_unit = defaultdict(list)
    for i, row in enumerate(rows):
        if row['split'] == 'train':
            by_unit[row['meaningUnitId']].append(i)
    for members in by_unit.values():
        weight = 1.0 / len(members)
        for i in members:
            rows[i]['sampleWeight'] = weight
    for row in rows:
        if row['split'] != 'train':
            row['sampleWeight'] = 1.0

    # The protected train partitions must retain all 590 old training records;
    # original held-out rows remain retired under their mapped split names.
    counts = Counter(row['split'] for row in rows)
    assert sum(row['split'] == 'train' and row['sourceRecord']['file'] == BASE_PATH for row in rows) == 590
    assert sum(row['split'] == 'legacy-validation' and row['sourceRecord']['file'] == BASE_PATH for row in rows) == 211
    assert sum(row['split'] == 'legacy-test' and row['sourceRecord']['file'] == BASE_PATH for row in rows) == 199
    assert counts['validation'] == counts['test'] == FRESH_PER_SPLIT
    for split in ('validation', 'test'):
        fresh = [row for row in rows if row['split'] == split]
        assert all(row['kind'] == 'new-meaning' and row['sourceRecord']['file'] == ANNOTATION_PATH for row in fresh)
        assert all(sum(row['anchorCategory'] == c for row in fresh) == FRESH_PRIMARY_PER_CATEGORY for c in CATEGORIES)

    raw_stats = class_stats(rows, list(range(len(rows))))
    train_weighted = weighted_train_stats(rows)
    assert ratio(raw_stats) <= 2, f'Raw class positive ratio exceeds 2.0: {ratio(raw_stats):.4f}'
    assert ratio(train_weighted) <= 2, f'Train weighted class positive ratio exceeds 2.0: {ratio(train_weighted):.4f}'
    split_class_balance = {split: class_stats(rows, [i for i, row in enumerate(rows) if row['split'] == split])
                           for split in ('train', 'validation', 'test', 'legacy-validation', 'legacy-test')}
    primary_balance = {split: {c: sum(row['split'] == split and row['anchorCategory'] == c for row in rows)
                               for c in CATEGORIES}
                       for split in ('train', 'validation', 'test', 'legacy-validation', 'legacy-test')}

    source_hashes = dict(base.get('sourceFilesSha256', {}))
    source_hashes[BASE_PATH] = sha(base_bytes)
    source_hashes[ANNOTATION_PATH] = sha(annotation_bytes)
    dataset = {
        'schemaVersion': 1,
        'task': 'meaning-category-membership',
        'categories': CATEGORIES,
        'targetEncoding': 'multilabel-binary-in-category-order',
        'personalPreference': False,
        'sourceFilesSha256': source_hashes,
        'quarantinedSourceIds': list(base['quarantinedSourceIds']),
        'counts': dict(counts),
        'classBalance': {'raw': raw_stats, 'trainWeighted': train_weighted},
        'splitClassBalance': split_class_balance,
        'primaryClassBalance': primary_balance,
        'splitProtocol': {
            'seed': SEED,
            'method': 'Connected-identity grouping before labels-only mixed-integer split assignment; old partitions are protected.',
            'freshEvaluation': '48 fresh new meanings each for validation and test; eight primary anchors per category per split.',
            'legacy': 'Original validation/test rows remain legacy-validation/legacy-test; all linked new rows inherit the protected old partition.',
            'paraphrases': 'Paraphrases link only to old train meanings and share their meaningUnitId; their training sample weights sum with the source to one.',
            'optimizerMessage': split_info['optimizerMessage'],
            'modelScoresUsed': False
        },
        'reviewType': review['reviewType'],
        'limitations': list(base.get('limitations', [])) + [
            'Regularization additions are AI-authored/reviewed and are not human-expert ground truth.',
            'Fresh evaluation groups are class balanced and do not estimate natural class prevalence.'
        ],
        'items': rows
    }
    dataset_bytes = (json.dumps(dataset, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')
    linkage = [{'id': row['id'], 'kind': row.get('kind'), 'sourceId': row.get('sourceId'),
                'relatedExistingId': row.get('relatedExistingId'), 'meaningUnitId': row['meaningUnitId'],
                'split': row['split'], 'groupId': row['groupId'], 'sampleWeight': row['sampleWeight']}
               for row in rows if row['sourceRecord']['file'] == ANNOTATION_PATH]
    manifest = {
        'schemaVersion': 1,
        'datasetFile': DATASET_PATH,
        'datasetFileSha256': sha(dataset_bytes),
        'baseDatasetFile': BASE_PATH,
        'baseDatasetFileSha256': sha(base_bytes),
        'newAnnotationsFile': ANNOTATION_PATH,
        'newAnnotationsFileSha256': sha(annotation_bytes),
        'reviewFile': REVIEW_PATH,
        'reviewType': review['reviewType'],
        'reviewedCount': review['reviewedCount'],
        'counts': dict(counts),
        'annotationKinds': dict(Counter(row['kind'] for row in annotations)),
        'groupCount': len(group_manifest),
        'groupingAndSplit': split_info,
        'freshPrimaryAnchors': {split: primary_balance[split] for split in ('validation', 'test')},
        'classBalance': {'rawPositiveRatio': ratio(raw_stats), 'trainWeightedPositiveRatio': ratio(train_weighted),
                         'raw': raw_stats, 'trainWeighted': train_weighted},
        'annotationLinkage': linkage,
        'groups': group_manifest
    }
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')
    review['datasetFileSha256'] = sha(dataset_bytes)
    review_bytes_out = (json.dumps(review, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')

    # Freeze outputs: rebuilds must be byte-identical once an artifact exists.
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = [(OUT / 'dataset.json', dataset_bytes), (OUT / 'manifest.json', manifest_bytes)]
    for path, encoded in outputs:
        if path.exists():
            assert path.read_bytes() == encoded, f'Frozen output would change: {path.relative_to(ROOT)}'
    review_path = ROOT / REVIEW_PATH
    if review_path.exists() and json.loads(review_path.read_bytes()).get('datasetFileSha256') is not None:
        assert review_path.read_bytes() == review_bytes_out, \
            f'Frozen output would change: {review_path.relative_to(ROOT)}'
    for path, encoded in outputs:
        if not path.exists():
            path.write_bytes(encoded)
    if not review_path.exists() or 'datasetFileSha256' not in json.loads(review_path.read_bytes()):
        review_path.write_bytes(review_bytes_out)

    print(json.dumps({
        'counts': dict(counts),
        'annotationKinds': dict(Counter(row['kind'] for row in annotations)),
        'groups': len(group_manifest),
        'freshPrimaryAnchors': {split: primary_balance[split] for split in ('validation', 'test')},
        'rawPositiveRatio': ratio(raw_stats),
        'trainWeightedPositiveRatio': ratio(train_weighted),
        'newLinkedToOldTrain': split_info['newLinkedToOldTrain'],
        'newLinkedToOldHeldout': split_info['newLinkedToOldHeldout'],
        'datasetFileSha256': sha(dataset_bytes)
    }, indent=2))


if __name__ == '__main__':
    main()

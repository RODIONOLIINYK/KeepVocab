# Six-category meaning dataset, pilot v1

This is a **text-meaning classification** fixture. It prepares the category head
described in [the project plan](../../../docs/meaning-conditioning-plan.md).
The category classifier has now been trained and evaluated **offline**; see the
[training report](../../../docs/meaning-taxonomy-training/README.md). No app
classifier, CLIP adapter, or personal model has been activated. The frozen
dataset's `trained: false` field records its original preparation snapshot;
training provenance is in the separate classifier artifacts.

There are 417 unique exact meanings: all 237 meanings from the legacy image
corpus plus 180 newly AI-authored pilot definitions. The six outputs are
`entity`, `place`, `action`, `state`, `relation`, and `abstract`, in that order.
Each row has six binary membership targets and may have several positive labels.
Use independent sigmoid outputs for multilabel logistic regression; retain the
full vector. The `primaryClass` field is for inspection, not an exclusive target.

## Files and provenance

- `dataset.json`: final reviewed definitions, labels/targets, evidence, rationale,
  provenance, group IDs, partitions, and content-bound review metadata.
- `review.json`: dataset hash, scope/limits, class supports, and integrity audit.
- `embeddings.json.gz`: frozen 512-D original-definition text vectors with exact
  dataset/prompt hashes; no category labels are used to construct the vectors.
- `classifier.json`: validation-selected 512 → 32 tanh → 6 sigmoid classifier.
- `classifier-linear.json`: tuned six-output logistic-regression alternative.
- `review-decisions.json`: primary-assistant policy decisions, exact overrides,
  and a hash locking the reviewed content. It refuses to approve newly added or
  changed rows automatically.
- `source/legacy-annotations.json`: Luna's revised initial annotation draft,
  with original family/split metadata. This draft is not the final training set.
- `source/authored-annotations.json`: Luna's initial authored supplement. Apply
  the reviewed decisions before consuming it. Proposed misleading alternatives
  in this source are **not** verified negative-image labels.

The primary assistant read every selected definition and proposed label set,
resolved the label-policy boundaries, and corrected the drafts. Luna performed
initial annotation and a targeted additional review. These are AI annotations;
there is no independent human-expert validation and no new image review here.
Per-record `confidence` concerns the semantic annotation, not an image judgment
or calibrated classifier probability.

Labels were reviewed before any classifier fit. In particular:

- `rain` is a noun describing a falling process: entity + action.
- `stand`, `sit`, and the supplied resting sense of `lie down` describe states.
- `hold` describes a support/grasp relation; `carry` additionally requires motion.
- Physical `blood` is an entity, `bleed` a process, and `bloody` a state.
- The noun/verb senses of `pet` have different labels and remain in one group.
- `know` is abstract despite being a verb. An abstract meaning is not the same
  as an uncertain classifier prediction.
- Physical informational carriers such as signs/books remain entities.
- Mixed definitions in the authored draft were narrowed before final review.

Categories describe useful evidence routes for a meaning, not all objects or
properties that might happen to occur in a photograph. For disjunctive meanings
such as falling OR settled snow, a valid image need not exhibit every route.
Appearance can illustrate a physical item without proving its chemical content,
history, ownership, or a person's internal feeling. Limitations are retained.

## Partitioning and pilot support

Connected groups use headwords, legacy meaning families, and reviewed related
paraphrases/opposites. A whole connected component has one final split. Original
legacy splits are retained as provenance. Components that already cross legacy
splits are quarantined instead of becoming training or clean evaluation data.

| Partition | Meanings |
|---|---:|
| Train | 244 |
| Validation | 91 |
| Test | 77 |
| Quarantine | 5 |

The five quarantined meanings connect bird/winged flying with airplane/flying
and parked airplane through a shared headword plus original families. Their
original metadata remains intact. New groups use deterministic hash buckets,
approximately 60/20/20, without inspecting model performance.

| Positive category membership | Train | Validation | Test |
|---|---:|---:|---:|
| Entity | 98 | 41 | 36 |
| Place | 26 | 7 | 7 |
| Action | 34 | 15 | 10 |
| State | 46 | 16 | 12 |
| Relation | 75 | 22 | 15 |
| Abstract | 32 | 13 | 11 |

Membership counts overlap: 101 rows have multiple labels. Each category also has
negative examples in each learning split. Small held-out supports, especially
seven places, do not justify precise accuracy or calibration claims. No model
performance is reported for this fixture. Its English authored-definition style,
class imbalance and shared AI authorship can all limit transfer to real meanings.

## Reproduce and inspect

From the repository root:

```sh
node scripts/prepare-meaning-taxonomy.mjs
node scripts/audit-meaning-taxonomy.mjs
node --test tests/meaningTaxonomy.test.mjs
```

Preparation requires a matching reviewed-content hash. Do not refresh that hash
merely to bypass a failed review check: inspect changed definitions and labels,
record the decisions, and then bind the reviewed content. Original corpus and
draft-source hashes are checked as well. The commands need no API key, model
download, user data, or app access.

These checks detect missing records, leakage, invalid labels/targets and stale
reviews. They cannot certify the labels as objective linguistic truth. Before
deployment, add independently reviewed real-app meanings and a prospective test.

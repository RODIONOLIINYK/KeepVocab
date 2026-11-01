# Policy-v2 revision, paired retraining and fresh confirmation

Completed offline on 2026-11-01; released with KeepVocab 1.12.18.
The current **offline meaning classifier** is the selected v2 32-unit L2 head.
It passed the frozen validation and fresh confirmation gates. Production image
filtering, personal ranking and CLIP transforms are not activated or changed.

**Every score in the main result table uses the same new 120 meanings with the
same v2 gold labels.** This is a new annotation policy and cohort. Do not compare
its 67.50% accuracy directly with the historical 70.00% or 72.50% on other
labels/cohorts. Old source files, model files and benchmark results remain intact.
These are AI-authored/reviewed project annotations, not human-expert truth.

## Explicit rules and reviewed data

The versioned [policy](../../../tests/fixtures/meaning-taxonomy/policy-v2/POLICY.md)
defines six overlapping evidence categories. Key adjudications are:

| Selected meaning | v2 treatment |
|---|---|
| shatter / splinter / evaporate / erode | action; no state merely because the process has a lasting result |
| broken / frozen as current conditions | state, with no implied ongoing action |
| greenhouse / gazebo as occupiable structures | entity + place |
| wall / roof / barrier as components or objects | entity; relation only for an independently defining placement/connection |
| room / natural landform | place; geographic roles and boundaries can additionally be relation |
| sad as a private feeling | abstract |
| sad as a visibly downcast expression | state |
| teamwork / cooperation as social coordination | relation + abstract; no physical activity inferred from a generic procedure |

The source's 1,280 nonparaphrase meaning records were reviewed across action/state,
entity/place and relation/abstract slices. Luna supplied audit drafts. The primary
assistant inspected all proposed changes, ambiguity flags and cited counterparts,
all new 360 definitions/memberships, the 281 relation/abstract source definitions,
and unchanged place/multilabel records; simple unchanged physical/action/state
records were checked against the category rules and source integrity. Exact
coverage is recorded in [review.json](../../../tests/fixtures/meaning-taxonomy/policy-v2/review.json),
not presented as independent human-expert review.

**250 original meaning-unit annotations changed**, affecting 255 rows including
inherited paraphrases. All 140 known paraphrases retain parent labels/groups and
share a total training weight of one with their parent. Five unresolved source
meanings (remain, society, counterpart, accumulate and handoff) are quarantined.
The five historical quarantine source IDs also remain excluded from the source.
No label was changed because a model predicted it incorrectly.

The new 360 meanings include material/organism/artifact entities, natural and
constructed places, physical activities/conditions, physical relations, social
roles and conceptual meanings. Primary review replaced private-feeling state
drafts, corrected location-versus-property assignments, narrowed ambiguous new
definitions and replaced a role-only relation draft with 30 physical relations.
The source group/freshness audit protects close synonyms and activity-specific
tool compounds. An embedding-neighbor screen was used only for semantic-family
review before training, never to discard difficult examples or choose labels.

| Final partition | Rows | Role |
|---|---:|---|
| Train | 1,031 | 890 old training rows + 141 new meanings |
| Fresh validation | 60 | 10 primary anchors per category |
| Fresh test | 120 | 20 primary anchors per category; opened after selection |
| Retired validation | 289 | Prior exposure and newly linked synonyms/derivatives |
| Retired test | 275 | Prior exposure and newly linked synonyms/derivatives |
| Quarantine | 5 | Unresolved definition-domain ambiguity |

The 1,780 rows include **891 operational training meaning units** and 140 known
paraphrase variants. Unit IDs are an accounting convention, not a claim that
all source senses were independently expert-adjudicated. Related source meanings
remain together in connected families; even close wording cannot cross grouped
CV. Every fresh headword is new, and no fresh group connects to an old record.
Old heldouts never become training examples.

Fresh entity anchors are 60% artifacts, 20% materials and 20% organisms. Place
anchors are 40% natural and 60% built/interior. Relation anchors are 50% physical
and 50% social. These coverage strata were fixed before fitting; they are not
natural app prevalence. Overlapping positive memberships need not be equal;
training-derived class weighting is tuned instead of duplicating records.

The [dataset](../../../tests/fixtures/meaning-taxonomy/policy-v2/dataset.json),
[decisions](../../../tests/fixtures/meaning-taxonomy/policy-v2/review-decisions.json)
and [manifest/label-change ledger](../../../tests/fixtures/meaning-taxonomy/policy-v2/manifest.json)
are content-bound to the frozen source, policy and review files. Any inherited
legacy qualitative confidence field is source metadata, not a measured v2 label
accuracy or a training weight.

## Paired models and training-only calibration

Both architectures receive identical 512-D pinned MobileCLIP meaning embeddings,
training records, groups and targets. There is no image-category classifier,
image input, extra text feature, dropout, softmax or argmax collapse.

The search tests **76 all-data configurations plus one fixed source-only
control**: 48 broad random settings, 24 local settings and four all-data controls.
Both linear and 32-unit heads explore L2, positive weighting and centered scaled/
standardized inputs. Two CV finalists per architecture plus the fixed v2 controls
repeat across seeds 7919, 104729 and 130363. Linear fitting is convex with fixed
initialization, so its repeated seed solutions are identical as expected.
A fixed seed 7919 is exported rather than the most favorable observed seed.

Four training-only grouped folds score original records once each. Paraphrases
never leak into their parents' held-out fold. None, global temperature/bias and
shared-temperature/per-class-bias calibration are fitted only on OOF training
predictions. Mean validation BCE/Brier select the simplest calibration within
0.002 BCE and 0.001 Brier of the best mean-BCE option. Thresholds are selected
on OOF training probabilities, not on fresh test labels. Mean validation F1 and
BCE rank architectures; linear is preferred when the predeclared practical
margins pass across F1, accuracy, precision/recall, BCE/Brier and worst-class F1.

The preliminary strongest neural fits hit the 800-iteration search cap. Before
opening the fresh test, all finalist OOF/full fits were repeated with a fixed
3,000-iteration limit. All final full fits converged; the selected seed converged
in 1,045 iterations. [Budget review](optimizer-budget-review.json) preserves that
change. Search and confirmation histories contain 94 CV runs /
376 fold fits; 31 report a stopping limit or
unsuccessful status. They are retained rather than called converged.

The selected head is **512 → 32 tanh → 6 sigmoids**, 16,614 parameters, centered
and scaled by sqrt(512), L2 **0.0010109335**, positive-weight power **0.5846147**,
threshold **0.425**, and global temperature/bias calibration. Coefficients under
scaled inputs are not directly comparable with coefficients under standardized
inputs. All six outputs remain available; calibration reliability on real app
usage is not established.

Calibration comparison for the selected configuration (three-seed means on the
same 60 validation meanings):

| Calibration | Validation BCE ↓ | Brier ↓ | Macro F1 |
|---|---:|---:|---:|
| none | 0.2050 | 0.0527 | 87.54% |
| temperature-global-bias | 0.1877 | 0.0512 | 87.88% |
| temperature-class-bias | 0.1864 | 0.0515 | 88.27% |

Per-class offsets did not improve validation enough to justify the extra
parameters under the declared rule. The new linear finalists instead retain
uncalibrated sigmoid outputs because their tested calibrators worsened validation
BCE. Calibration is tested rather than assumed beneficial.

## Fresh confirmation: identical cohort and targets

| Model | Exact label set | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Previous v1-label head | 50.00% | 77.00% | 87.50% | 64.67% | 0.2811 | 0.0828 |
| New v2 logistic regression | 62.50% | 84.23% | 90.12% | 79.35% | 0.1706 | 0.0529 |
| Selected v2 32-unit head | 67.50% | 86.73% | 89.47% | 83.15% | 0.1905 | 0.0544 |

The MLP improves exact match/F1/recall over linear. Linear has slightly higher
precision and better probability losses. It misses the practical equivalence
margins on validation, so the larger head is retained; this is not a claim that
MLP wins every metric. Linear has 3,078 parameters versus 16,614 for the MLP.

The selected head passes every predeclared margin against the previous head on
both validation and fresh test. The paired group bootstrap over
113 fresh groups gives a macro-F1 difference interval of
5.29 to 14.28 percentage points. This measures agreement with the
new policy on this curated cohort, not proof that the old ontology was
objectively wrong or that real app accuracy will match the pilot.

## Separate label, sample and tuning effects

These controls hold the source-only rows, inputs, model hyperparameters and
frozen old scoring transform fixed for the first two rows. Training-derived
class weights respond to the revised labels as part of the same fitting recipe.
The third adds new training meanings with the same configuration. The selected
model then includes new hyperparameters/calibration. All scores use the same
fresh 120 v2 gold meanings.

| Model | Exact label set | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Same source rows, old labels | 50.00% | 77.00% | 87.50% | 64.67% | 0.2811 | 0.0828 |
| Same source rows, revised labels | 57.50% | 81.23% | 86.79% | 75.00% | 0.2113 | 0.0666 |
| Revised labels + new training meanings | 60.00% | 83.47% | 87.35% | 78.80% | 0.1858 | 0.0587 |
| Selected configuration + calibration | 67.50% | 86.73% | 89.47% | 83.15% | 0.1905 | 0.0544 |

The first source-v1 control reproduces the old head's scores exactly. The
label-only revision improves F1 from 77.00% to 81.23%; new examples raise it to
83.47%; the selected recipe reaches 86.73%. These staged controls support the
changes in this pilot; they do not establish an independently measured linguistic
label-accuracy percentage.

Tuning is not a uniform improvement: the fixed all-v2 control has slightly lower
test BCE than the selected model (0.1858 versus 0.1905), while the selected model
has better F1, exact match and Brier score. The table retains that tradeoff.

## Remaining weaknesses and integration boundary

| Category | Test positive support | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| entity | 39 | 92.68% | 97.44% | 95.00% |
| place | 20 | 90.48% | 95.00% | 92.68% |
| action | 21 | 86.36% | 90.48% | 88.37% |
| state | 20 | 77.78% | 70.00% | 73.68% |
| relation | 54 | 85.00% | 62.96% | 72.34% |
| abstract | 30 | 100.00% | 96.67% | 98.31% |

State and relation remain weaker. There are 39 exact-label-set errors, including
extra entity labels on rooms, missed structural relations, and body-condition
confusion. The [error list](errors.json) is post-confirmation diagnosis only:
no gold labels, thresholds or model choice were changed after seeing it.
**97% accuracy/precision is not achieved.** New data, gold-policy clarity and
held-out coverage improve the measurement; they do not remove the limitations
of frozen CLIP text features or AI annotation.

The offline registry is updated to the selected v2 head. Adapter-data routing
probabilities/provenance were regenerated, while all underlying image/text
vectors, semantic image labels, crops, pairs, groups and weights remain identical.
No image/text adapters or production personal ranker are trained or activated.
A fresh text confirmation is not a fresh image–meaning benchmark.

## Reproducibility

[Protocol](protocol.json), [trials](trials.json), [selection](selection.json),
[report](report.json), [predictions](test-predictions.json),
[OOF predictions](oof-predictions.json.gz) and [environment](resources.json) retain
hashes, fold IDs, configurations, seeds and convergence details. Historical tests
check their frozen snapshots; the current-head check belongs to this revision.
Python 3.12.14, NumPy 2.3.5, SciPy 1.16.3 run on arm64.

```sh
node scripts/audit-meaning-policy-v2.mjs
node --test tests/meaningPolicyV2Dataset.test.mjs tests/meaningPolicyV2Classifier.test.mjs
# Replay in an isolated copy preserving all frozen outputs:
python scripts/prepare-meaning-policy-v2.py
node scripts/encode-meaning-taxonomy.mjs --policy-v2
python scripts/train-meaning-policy-v2.py --phase select --workers 6
python scripts/train-meaning-policy-v2.py --phase evaluate
```

Use `scripts/requirements-meaning-taxonomy.txt`; the bundled runtime's builder
needs `PYTHONPATH=work/meaning-taxonomy-training/python-libs`. Rebuilds refuse
changed frozen output and evaluation refuses a second test run. JavaScript
independently reproduces Python predictions and confusion counts for the selected
head, both architectures, the previous head and all three data/label controls.

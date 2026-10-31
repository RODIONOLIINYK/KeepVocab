# Targeted examples and exact L1/L2 comparison

Completed offline on 2026-10-31; released with KeepVocab 1.12.16. The current
**offline meaning head** is the selected 32-unit L2 model. Both frozen validation
and confirmation gates passed against the previous 1,000-row head. The app's
personal image MLP, image filtering, and CLIP encoders remain unchanged. No
image/text adapter matrices were trained or activated.

## Data and primary review

The dataset grows from 1,000 to **1,420 text rows**: 280 new meanings and 140
training-only paraphrases. Additions target the earlier material/entity errors,
action-versus-condition mistakes, and physical/social relationships. Luna drafted
examples and tooling; the primary assistant personally inspected every new
definition and all six memberships, and all 140 rewritten paraphrases. These
are AI-authored and AI-reviewed annotations, **not human-expert ground truth**.

Primary review made 36 explicit semantic corrections and replaced two unsuitable
relationship examples. Examples: cupola/belfry/lighthouse are entities rather
than places; colonnade retains entity/place/relation; basement retains its
below-ground relation; hothouse retains entity/place; hibernate describes a
sustained condition; hardened arteries requires entity/state; avalanche and
landslide definitions now explicitly name events. Threadbare and forked were
replaced by bilateral and interleaved rather than keeping incorrect relationship
labels. Material nouns are entities even when a photo cannot prove composition.

Earlier draft paraphrases included category hints or punctuation-only changes.
They were rewritten as natural definitions and checked against the exact source
sense, POS, labels and anchor. No category names, rationales or review metadata
enter the embedding prompt. All 140 now produce distinct vectors from their
parents (median cosine 0.9642); similarity is only a
diagnostic, not proof of semantic equivalence.

| Partition | Rows | Purpose |
|---|---:|---|
| Train | 890 | 590 old meanings + 160 new meanings + 140 paraphrases |
| Fresh validation | 48 | Model/regime/calibration selection; eight anchors/category |
| Fresh test | 48 | One frozen confirmation; eight anchors/category |
| Retired validation | 225 | Old held-out meanings and linked new derivatives/synonyms |
| Retired test | 209 | Old held-out meanings and linked new derivatives/synonyms |

Training represents **750 meaning units**, not 890 independent examples. Each
original/paraphrase pair has weight 0.5 + 0.5; an unaugmented meaning has weight
one. The 24 new meanings linked to retired groups remain retired; none is moved
into training. New held-out groups are selected from labels and anchors only,
before embeddings or model predictions. The weighted training positive-count
ratio is 1.45 (184 entity, 137 place, 168 action, 127 state, 138 relation,
146 abstract). Old definitions, IDs and labels stay frozen. Five original
quarantined meanings remain excluded.

See the content-bound [annotation review](../../../tests/fixtures/meaning-taxonomy/regularized-expansion/review.json),
[manifest](../../../tests/fixtures/meaning-taxonomy/regularized-expansion/manifest.json)
and [paraphrase diagnostics](paraphrase-diagnostics.json).

## Training and regularization

Inputs are normalized 512-D vectors from the pinned current MobileCLIP text
encoder and the exact definition prompt. Outputs remain six independent sigmoid
probabilities: entity, place, action, state, relation and abstract. Neither an
image vector nor an argmax label is fed to the meaning classifier.

The existing trainer already supported L2. This experiment adds **exact L1**
and elastic-net: each weight is represented as `w = u - v`, with `u,v >= 0`,
and penalized by `lambda * (u + v)`. At the optimum this is the absolute-value
penalty. Biases are unpenalized. L2 penalizes squared weight magnitudes. Analytic
gradients were checked by finite differences for linear and nonlinear heads,
with and without sample weights. Tests also verify the old L2 solver is preserved
when applicable, duplicate-loss weight invariance, and exact zero coefficients
under strong L1.

The bounded search tests **72 configurations**: 48 broad random configurations
and 24 narrower configurations, covering L1/L2/elastic-net for linear and 32-unit
heads. Six worker processes use one BLAS thread each. Four folds are assigned
using original meaning groups, then expanded to include their training
paraphrases. OOF metrics, threshold fitting and calibration use original
meanings once each. Thresholds come from OOF F1; calibration parameters come from
OOF predictions; fresh validation chooses the calibration option and finalists.
No retired or fresh-test labels are used for search.

All 72 configurations ran; 50/288 CV fits reached a stopping limit rather
than reported convergence. Their statuses are retained, not counted as solver
convergence. All six winning architecture/regularizer full-data fits converged,
including the selected model in 194 iterations. Random
search does not establish a global optimum.

Best validation candidate in each architecture/regularizer cell:

| Model | Exact label set | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Linear-l1 | 64.58% | 82.19% | 83.33% | 80.65% | 0.2015 | 0.0570 |
| Linear-l2 | 70.83% | 86.79% | 88.33% | 85.48% | 0.1755 | 0.0490 |
| Linear-elasticnet | 66.67% | 85.28% | 86.67% | 83.87% | 0.1882 | 0.0525 |
| 32-unit-l1 | 64.58% | 82.19% | 83.33% | 80.65% | 0.2070 | 0.0588 |
| 32-unit-l2 | 70.83% | 86.03% | 92.59% | 80.65% | 0.1972 | 0.0530 |
| 32-unit-elasticnet | 70.83% | 84.87% | 92.45% | 79.03% | 0.1890 | 0.0512 |

L2 wins validation F1 in both architectures. L1 makes the best linear head
83.1% sparse and the best 32-unit head 97.2% sparse, but lowers validation F1.
Sparse coefficients do not automatically save mobile inference work: portable
inference currently executes dense loops.

The linear L2 model has slightly **higher validation F1 and better BCE/Brier**
than the selected 32-unit head. Its precision is 88.33% versus 92.59%, and place
F1 is 94.12% versus 100%. It misses the predeclared 2-point precision and 5-point
worst-class practical tolerances, so the architecture rule retains 32 units.
This is a documented precision/resource tradeoff, not a claim that the MLP wins
every metric. Linear has 3,078 parameters; the 32-unit head has 16,614.

The selected L2 coefficient is **0.0377164777**, versus **0.0106707029** previously.
Its positive weighting power is 0.6873864. It uses centered/standardized inputs,
a tanh hidden layer, an OOF temperature/global-bias calibration candidate, and
a binary evaluation threshold of 0.5097575. Probability reliability is not
established; all six continuous outputs remain available. Training-original
exact match/F1 are 86.53%/
93.61%; regularization reduces memorization.

## Frozen test and data ablations

All rows below are evaluated on the **same new 48 meanings**. Do not compare
these percentages directly with the previous experiment's 120-row test.
Fixed controls retain the previous configuration, calibration and threshold;
they isolate adding meanings and then adding shared-weight paraphrases.

| Model | Exact label set | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Previous 1,000-row head | 52.08% | 72.77% | 73.02% | 75.41% | 0.2383 | 0.0753 |
| Same config + new meanings | 62.50% | 80.81% | 80.65% | 81.97% | 0.1806 | 0.0527 |
| Same config + meanings + paraphrases | 62.50% | 81.32% | 81.97% | 81.97% | 0.1789 | 0.0507 |
| Selected stronger-L2 32-unit head | 68.75% | 80.01% | 87.04% | 77.05% | 0.2046 | 0.0588 |

New independent meanings account for most of the improvement. Paraphrases have
no validation F1 gain in this fixed comparison and a small test F1/Brier gain;
their benefit is not established reliably. The tuned model improves exact match
and precision over the fixed data controls, while those controls have **better
recall, F1 and probability losses**. Tuning is not a uniform improvement. The
predeclared candidate stayed frozen; controls were not substituted after seeing
the test results.

The selected model passes all predeclared confirmation margins against the
previous head: F1 -0.01, exact match/precision/recall -0.02, BCE +0.01, Brier
+0.003 and per-class F1 -0.05. Its macro-F1 gain is 7.24 points; the 1,000-repeat
paired bootstrap over 47 groups gives a 95% difference interval of
0.55 to 14.10 points. This small, class-balanced AI pilot does not
estimate accuracy on real app usage. **97% precision or exact accuracy is not
achieved.**

| Test category | Positive support | Precision | Recall | Selected F1 | Previous F1 |
|---|---:|---:|---:|---:|---:|
| entity | 13 | 90.91% | 76.92% | 83.33% | 69.57% |
| place | 8 | 87.50% | 87.50% | 87.50% | 80.00% |
| action | 10 | 88.89% | 80.00% | 84.21% | 80.00% |
| state | 8 | 75.00% | 75.00% | 75.00% | 60.00% |
| relation | 10 | 66.67% | 40.00% | 50.00% | 47.06% |
| abstract | 12 | 100.00% | 100.00% | 100.00% | 100.00% |

Relations remain weak: keyed/buttressed lose the relation route, fastener loses
its joining relation, and social roles such as guardian/landlord lose entity or
relation membership. Hibernate is still predicted as action; granular receives
no label at the binary threshold. That does not discard the stored probability
vector. These test meanings are now retired for further selection; obtain new
independent evaluation groups before another tuning round. Do not relabel these
errors to raise the score.

## Review, reproducibility and integration boundary

Primary code review corrected missing cheaper-linear selection, missing
validation eligibility gating, inconsistent grouping namespaces, fold assignment
that counted paraphrases, frozen comparator/hash checks, and a local-search
configuration bug found during execution. The initial failed search stopped
before selection or any test evaluation; the complete 72-trial run was then
replayed. Dataset rebuilding is byte-identical and refuses changed frozen
outputs. Selection/evaluation refuse overwriting frozen decisions.

[Protocol](protocol.json), [trials](trials.json), [selection](selection.json),
[report](report.json), [predictions](test-predictions.json) and
[environment/commands](resources.json) preserve the audit trail. Commands use
Python 3.12 with `scripts/requirements-meaning-taxonomy.txt`; when using the
bundled runtime, set `PYTHONPATH=work/meaning-taxonomy-training/python-libs` for
the dataset builder. Replay searches in an isolated copy with the original
outputs preserved. Verify the frozen artifacts in place with:

```sh
node scripts/audit-meaning-regularization.mjs
python scripts/test-meaning-regularization.py
node --test tests/meaningRegularizationDataset.test.mjs tests/meaningRegularizationClassifier.test.mjs
```

Portable JavaScript inference independently reproduces Python test probabilities
and confusion counts. The offline current-classifier registry now references the
selected head. The adapter-data cache was regenerated with this head's routing
probabilities; its image/text vectors, labels, crop choices and counts are
unchanged. This does not train adapters or change production personalization.

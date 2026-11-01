# Research follow-up: exact joint-label prediction

Completed on 2026-11-01 for KeepVocab 1.12.20. **More than 90% exact label-set
accuracy remains unmet.** This adds 78 trained configurations to the preceding
[204-configuration search](../exact-accuracy-search/README.md), with original
labels, definitions, embeddings and partitions unchanged. No app classifier,
offline registry, routing cache or personal preference model is replaced.

## Internet research and the hypothesis

The primary [PCC paper, Dembczyński et al., ICML2010](https://icml.cc/Conferences/2010/papers/589.pdf)
distinguishes label-wise errors from exact-set errors. For exact-set loss,
the Bayes decision is the most likely complete label set under the joint
distribution. This need not equal separately thresholded marginal labels.
Estimated joint probabilities can be wrong, so the theory does not guarantee
an empirical gain or a 90% score for KeepVocab.

The [pairwise multilabel CRF paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC4410807/)
motivates compact label-dependency models. Here there are only six labels,
so enumerating all 64 assignments permits **exact likelihood and inference**.
Our small fixed pairwise model is a simplification, not a reproduction of that
paper's pseudolikelihood/structure-learning algorithm.

The [TabPFN small-data paper](https://www.nature.com/articles/s41586-024-08328-6)
is another candidate reference. Its published small-table results do not
validate our embedding task. It was **researched, not benchmarked or integrated**
in this run. Its paper's studied 500-feature setting also differs from our 512
coordinates. A [full kernel SVM](https://scikit-learn.org/stable/modules/generated/sklearn.svm.SVC.html)
is another researched alternative to the RBF-feature logistic model previously
tested; it is not represented as a new measured result here.

## What was implemented

- **Probabilistic classifier chains (PCC):** six logistic conditional models,
  with earlier hypothetical labels appended to the embedding features. At
  inference all 64 assignments are evaluated, rather than following one greedy
  chain path. Orders, label scales, L2 and feature transformations are tuned.
- **Pairwise conditional random field (CRF):** six feature-conditioned unary
  scores and15 global pairwise interactions. Exact joint log likelihood is
  optimized with L-BFGS-B and separate unary/interaction L2 strengths.
- **Matched independent controls:** identical CRF features/hyperparameters with
  interactions fixed to zero, isolating the contribution of label dependence.
- **Prior powerset models:** unchanged weights from three earlier finalists,
  comparing raw-joint MAP with raw-marginal0.5 decisions. Their earlier
  marginal calibrators are not applied to the64-way joint; this is a raw-joint
  decoder experiment, not a reproduction of calibrated prior probabilities.

Every model retains **six marginal probabilities** for future personalization.
MAP produces a complete label set only for the categorical decision/accuracy
check. It does not discard probabilities, choose one category, force one-hot
outputs or replace the representation supplied to a future personal ranker.

## Fixed search and selection

48 broad joint configurations,24 local refinements and6 matched independent
controls = **78 configurations**. Best two per joint family plus two matched
controls repeat seeds 7919/104729/130363: **90 CV runs /360 fold fits**. Convex
linear fits are deterministic across seeds; repetitions are not independent
evidence of stochastic stability. RBF centers use training-original rows only.

All models use the same original 890 training rows /750 original meaning units.
The 140 paraphrases share unit weight with their parents and remain in the same
connected folds. Four grouped training folds rank configurations by MAP exact
accuracy, then F1 and joint NLL. Each full fit compares fixed MAP and marginal0.5
decoders on the reused48 validation meanings, before opening either test.
No thresholds, epoch limits or class labels are tuned on test results.

Candidate selection uses three-seed mean validation exact accuracy, then F1
and joint NLL. The fixed exported seed is7919. The selected candidate is
**trial 49, linear-feature CRF with MAP decoding**, training-only standardization,
unary L2=0.16930515 and coupling L2=0.0001452993. It has **3,093 learned
classifier parameters**:512×6 weights,6 biases and15 interactions. Preprocessing
statistics are additional, as with the other heads. No phone latency/battery
measurement is claimed.

## Results: identical original targets

| Model / decoder | Validation exact, seed mean | Original 120 exact | Other 48 exact |
|---|---:|---:|---:|
| Selected CRF, joint MAP | 77.08% | **78.33% (94/120)** | **72.92% (35/48)** |
| Same CRF, independent marginal0.5 | 70.83% | 75.83% | 70.83% |
| Validation-selected PCC, MAP | 70.83% | 75.83% | 72.92% |
| Prior powerset family finalist, selected marginal0.5 | 75.00% | 74.17% | 81.25% |
| That same prior powerset model, MAP | 72.92% | 74.17% | 75.00% |
| Previous 32-unit reference | historical | 72.50% | 68.75% |

Each family row is selected using validation before test, not a different
winner chosen for each cohort. The prior-powerset row is not the globally
selected candidate. Its superior other 48 result cannot be substituted after
seeing tests; it remains far below 90 and has weaker original 120 performance.
MAP does not uniformly improve a learned model: its benefit depends on the
quality of the joint distribution.

For the selected CRF, adding interactions improves mean validation exact
accuracy from 66.67% for its matched independent control to 77.08%. Its grouped
CV exact accuracy is 76.13%. These scores remain adaptively selected across many
configurations; CV architecture selection itself is not nested. All validation
and test cohorts have historical exposure and supply regression checks, not
fresh blind evidence.

| Selected CRF / MAP | Exact | Macro F1 | Micro precision | Micro recall | BCE ↓ |
|---|---:|---:|---:|---:|---:|
| Original 120 | 78.33% | 84.91% | 88.81% | 82.64% | 0.1510 |
| Other 48 | 72.92% | 77.35% | 88.24% | 73.77% | 0.1864 |

The old reference's other 48 macro F1 is 80.01%; the selected CRF is worse on that
metric despite more exact predictions. Its other 48 relation F1 is 30.77%, versus
50.00% for the old head. This is a substantial class regression, so the compact
model is not promoted. The earlier preselected three-family ensemble remains
76.67% /75.00% exact on the same tests. The best individual original 120 score
seen in that earlier search was 79.17%, with only68.75% on other 48.

## Verification and remaining work

All recorded optimizer fits succeeded. Numerical tests check exact CRF and
binary conditional gradients, probability normalization, correct marginals,
serialization parity, the zero-coupling independent limit and examples where
MAP differs from marginal decisions. JavaScript independently reproduces all
64-state probabilities, six marginals and confusion counts for both decoders.
Parent/family isolation and unchanged original gold targets are checked.
The primary assistant reviewed Luna's read-only audit; no test-label leakage
or decoder-scoring defect was found. This is AI review, not human-expert gold.

The finite searches show a real route to evaluating dependencies and a compact
candidate, **not a configuration known to reach 90%**. Further progress should
compare independently reviewed original-policy data/label combinations and
alternative text representations with a new untouched grouped confirmation
set. Retain class metrics and probability quality alongside exact accuracy.

[Protocol](protocol.json), [trials](trials.json.gz), [OOF joint predictions](oof-joint.json.gz),
[selection](selection.json), [report](report.json) and compressed candidate
artifacts preserve source/data/model hashes, configurations, IDs and seeds.
Scripts refuse to overwrite frozen outputs or repeat the fixed test evaluation.

```sh
python scripts/test-meaning-joint.py
python scripts/train-meaning-joint-search.py --phase select --workers 6
python scripts/train-meaning-joint-search.py --phase evaluate
node --test tests/meaningJointSearch.test.mjs
```

Replay in an isolated copy with this experiment's outputs removed. Dependencies are the
existing `scripts/requirements-meaning-taxonomy.txt`; no new runtime dependency
or external model weights were installed.

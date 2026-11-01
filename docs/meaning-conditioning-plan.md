# Meaning-conditioned CLIP and personal image ranking

Status: dataset reviewed and classifier trained/evaluated offline. No classifier,
adapter, image-filter threshold, or personal MLP change is activated by this plan. Agreed in the project discussion
on 2026-10-31. This document supersedes the earlier three/four-category proposal.

## Scope and order

1. Prepare, inspect, and audit a six-category **meaning** dataset. Retain exact
   definitions, provenance, review decisions, and leakage-safe partitions.
2. Fit and evaluate a small probabilistic classifier on frozen CLIP text vectors.
   Retain all six outputs. Compare a regularized linear baseline before adding a
   larger classifier. Do not interpret earlier four-class scores as six-class
   performance.
3. Build a separate reviewed image–meaning training set with diverse positives
   and matched wrong depictions. Text-category annotations alone cannot train
   image–text adapters or establish semantic image accuracy.
4. Compare category-aware prompts/contrasts, image-only adapters, text-only
   adapters, and jointly trained image/text adapters against unchanged CLIP.
5. Evaluate personal ranking separately using actual user preferences. Begin
   with original image embeddings plus category probabilities; compare a small
   personal transform and an MLP. Add full meaning embeddings only if they help
   held-out user decisions.
6. Integrate only a validated candidate. A major app change follows AGENTS.md:
   version/cache/Android-code bump, tests/web build, macOS arm64 and Android
   releases, commit/tag/push, and GitHub assets. This initial preparation stage
   leaves the production model unchanged; it does not waive that workflow for
   any major change.

Steps 1 and 2 are complete as an offline pilot. The
[training report](meaning-taxonomy-training/README.md) records the coarse-to-fine
search, grouped evaluation, learned models and limitations. Image/text adapter
training and app integration remain subsequent milestones.

The [structured-head/capacity follow-up](meaning-taxonomy-training/structured-heads/README.md)
tests136 configurations including input-conditioned pairwise interactions,
shared nonlinear features, residual linear paths and an RBF-SVM reference.
The compact CRF remains the selected experimental model under frozen validation
guards. A separate fixed-budget66-fit capacity sweep spans540–531,477 learned
coefficients, three seeds and zero/0.001 L2 to examine the user's double-descent
hypothesis. Preserve all six probabilities. Training/validation curves are
diagnostic; reused validation and retired tests do not establish fresh accuracy.
No classifier, image/text adapter or personal ranker is activated by this work.

The follow-up [capacity/confidence diagnostics](meaning-taxonomy-training/diagnostics/README.md)
check real-batch memorization, learning curves, confident mistakes, probability
calibration, mobile head cost, and a further precision-targeted search. The
requested 97% validation precision/accuracy has **not** been established. Keep
all six probability outputs; a high cutoff must disclose lost recall/coverage.
The frozen original test is now retired for further model selection. Use new,
independently reviewed evaluation meanings for the next confirmation.

A separately reviewed 57-meaning training supplement raises the text training
count from 244 to 301 without changing the original labels or partitions. Its
fixed-configuration validation comparison records gains and regressions; it
does not automatically replace the original model. The crop fixture adds one
approved variant to each of 355 eligible training photos (710 reviewed positive
examples from 355 independent photos). Thirty other proposed crops were
excluded: 24 for unclear/incorrect evidence and six for meaning-group quarantine. Re-audit flagged original image labels before adapter training and
retain parent/meaning groups. Give an original and its crop a shared sampling
budget, such as half the parent's weight each, so augmentation does not silently
double positive loss weight relative to negatives. Crops enlarge image–meaning
training data, not text-category training data.

## Expanded classifier and reusable adapter data (2026-10-31)

The [expanded 1,000-example experiment](meaning-taxonomy-training/expanded-1000/README.md)
contains 590 training, 120 fresh validation, 120 fresh test, and 170 legacy
evaluation examples. Each training category has 115–126 positive memberships.
531 new text examples were authored and reviewed; five old quarantined meanings
remain outside the 1,000 usable rows. Original benchmark labels and model files
stay frozen. The current **offline conditioning head** is identified by
`tests/fixtures/meaning-taxonomy/current-classifier.json`.

The predeclared cheaper-model comparison selected the 32-unit head over logistic
regression. On the same fresh test, 32-unit exact match/macro-F1 are 70.00%/83.59%,
versus linear 60.83%/81.30%. Its advantage is larger than the practical tolerance
for replacing it with linear. This is not a 97% result or a production-usage
estimate. The selected head is one meaning classifier; no separate image
category classifier is planned. Production personal ranking is a distinct
model and is unchanged.

The [MLP-data conversion](clip-adapter-data.md) produces 2,241 explicit semantic
triplets and 954 positive point pairs, including 355 approved crops. All CLIP
vectors retain 512 coordinates; the three old MLP score fields are removed.
Only target-meaning vectors supply the six class probabilities. These examples
can train the planned per-category image/text transforms; text-category labels
alone and the classifier's own weights cannot train or substitute for those
transforms. The converted image holdouts are retired, so obtain fresh reviewed
image–meaning evaluation groups before adapter selection or integration.

## Targeted examples and regularization follow-up (2026-10-31)

The [1,420-row follow-up](meaning-taxonomy-training/regularized-expansion/README.md)
contains 280 newly reviewed meanings and 140 training-only paraphrases. The
primary assistant inspected every addition and corrected Luna drafts before
encoding. Materials, actions versus conditions, and physical/social relations
target the earlier error analysis. Close synonyms and derivatives inherit old
groups; old held-out groups stay retired. The 890 training rows represent 750
meaning units: each original/paraphrase pair shares one unit of loss weight.

Train-only grouped search compares exact weight-only L1, L2, and elastic-net for
linear and 32-unit heads. The selected 32-unit L2 coefficient is 0.0377165, versus
0.0106707 previously. On the same new 48-meaning test, exact match rises from
52.08% to 68.75%, micro precision from 73.02% to 87.04%, and macro F1 from 72.77%
to 80.01%. Recall is 77.05%. Both validation and test promotion gates pass, so
the offline registry and adapter-data routing probabilities use this head.
This is not app activation, adapter training, or a 97% result.

Linear L2 has slightly higher validation F1, but falls outside the predeclared
precision and worst-class tolerances; L1 adds sparsity without better validation
F1. Fixed-configuration data controls have better test F1/BCE than the selected
candidate, while the selected candidate has better exact match/precision. The
report retains that tradeoff; no candidate was reselected using test results.
Relations remain the main weakness (test F1 50%). Obtain new independent
evaluation groups before another round of targeted tuning. Text paraphrases
do not substitute for image crops or genuine image–meaning adapter examples.

## Dropout and grouped early stopping (2026-11-01)

The [controlled dropout follow-up](meaning-taxonomy-training/dropout/README.md)
compares 24 settings and repeats five finalist settings over three seeds, keeping
all labels fixed. Dropout gives small CV gains but lowers validation precision
and does not pass the replacement rules; the current L2 head remains selected.
Both previously inspected test cohorts are fixed regression checks, not fresh
confirmation. The primary-reviewed label audit records 15 unresolved policy
cases rather than an asserted label-accuracy percentage. Resolve process/result
and built-structure/place rules in a separate versioned annotation revision,
then obtain independent confirmation meanings before another generalization
claim. Dropout is training-only and adds no deployed parameters.

## Consistent annotation policy and fresh confirmation (2026-11-01)

The historical [policy-v2 revision](meaning-taxonomy-training/policy-v2/README.md)
proposes revised conventions for earlier pilots. It reviews 1,280 source meaning
units, revises 250 units (255 rows including known paraphrases), adds 360 reviewed
meanings and quarantines five unresolved source meanings. Old files remain
intact. The corpus has 1,780 rows, including 1,031 training rows (891 operational
meaning units), 60 fresh validation and 120 fresh test examples. Related records
share families; unit counts do not imply independently expert-adjudicated senses.

On the identical new 120-example v2 test, the old v1 head scores 50.00% exact
match / 77.00% macro F1; the selected v2 32-unit head scores 67.50% / 86.73%, and
the new linear head 62.50% / 84.23%. These are new target conventions and a new
cohort, not a regression comparison with the old 70% benchmark. The nonlinear
head wins the predeclared practical replacement rule. It retains L2 and global
temperature/bias calibration; per-class bias calibration did not establish a
large enough validation benefit to justify extra parameters. State and relation
remain the main weaknesses. No 97% result or human-expert label accuracy is
established. At that revision the registry and routing cache referred to the v2 head;
production personal ranking and CLIP image/text transforms remain unchanged.

## Original-policy normalization experiment (2026-11-01)

The user explicitly selected the original labeling policy and its 72.50%
benchmark. The [controlled experiment](meaning-taxonomy-training/normalization-original/README.md)
keeps all original labels, vectors and partitions fixed and tests 76 settings:
linear/MLP L-BFGS-B controls and 30 exact Adam BatchNorm/plain pairs, including
16/32/64 widths, four batch sizes, learning-rate/L2/weighting/scaling choices and
three-seed finalist confirmation. No dropout is introduced.

The validation-selected BN head reaches 74.17% exact / 86.45% macro F1 versus
72.50% / 84.44% for the original head on identical original 120 targets. But BN
loses CV F1 in 29/30 matched pairs, its selected configuration is below baseline
CV, and entity F1 falls 8.33 points on the other 48-meaning test. Both tests are
historically exposed regression sets. This candidate stays experimental.

The offline registry and routing cache are restored to the original-policy
32-unit L2 head. V2 artifacts remain historical. Next steps are independently
reviewed original-policy entity/relation contrasts and a new untouched grouped
confirmation set before promoting another head. Never change labels to match
predictions or silently switch policies in a performance comparison.

## Exact-accuracy target and research follow-up (2026-11-01)

The user clarified the goal as **more than 90% exact accuracy: all memberships
correct for each meaning**, rather than precision or per-label accuracy. The
[204-configuration search](meaning-taxonomy-training/exact-accuracy-search/README.md)
tests wider/deeper MLPs, activations, focal loss/smoothing, joint-label models,
RBF features, neighbors and ensembles. Selection freezes before regression tests.
Its preselected ensemble scores 76.67% original 120 / 75.00% other 48 exact.

The [research follow-up](meaning-taxonomy-training/joint-label-search/README.md)
tests 78 more PCC/CRF/control configurations and MAP versus marginal decoding,
based on primary research about exact-set decisions. All six probabilities are
retained. A compact 3,093-parameter CRF scores 78.33% / 72.92%, but regresses on
other 48 relation F1. No configuration reaches the requested target. No label,
encoder, split, registry, routing cache or production model is changed.

Next: independently reviewed original-policy relation/action/state combinations,
a new untouched grouped confirmation set, and a separately versioned experiment
with alternative text representations or CLIP adapters if these inputs plateau.
TabPFN and full kernel SVM were researched as references, not benchmarked here.
Do not reuse precision/Hamming accuracy as evidence that exact accuracy passed.

## Compact-head refinement (2026-11-01)

The [128-configuration refinement](meaning-taxonomy-training/joint-tuning/README.md)
tests relation/state-specific penalties, rare-label weighting, auxiliary label
loss, graph constraints, joint calibration and compact CRF ensembles. Original
labels, embeddings and partitions stay fixed. Calibration is nested within
outer CV training and folds into existing CRF coefficients for inference.

The selected original CRF with unary calibration improves original 120 F1 from
84.91% to 85.46% and probability loss from 0.1510 to 0.1419. Exact accuracy remains
78.33% / 72.92% on original 120 / other 48. It still fails other 48 class-level
acceptance checks relative to the original 32-unit reference. No activation or
registry change follows. Tuning can improve a fixed architecture, but this run
does not establish the requested 90% exact accuracy or a major precision gain.

## Categories describe required visual evidence

| Output ID | Evidence focus | Examples |
|---|---|---|
| `entity` | Recognizable organism, person, object, material, or substance | dog, blood, smoke, suitcase |
| `place` | Setting, environmental structure, room, or spatial layout | kitchen, mountain, bridge |
| `action` | Activity, event, movement, interaction, or changing process | drink, chase, bleed, falling rain |
| `state` | Appearance, condition, or posture | red, wet, closed, standing |
| `relation` | Defining configuration, contact, support, or roles between referents | beside, inside, holding |
| `abstract` | Core conceptual meaning requiring interpretation or nonvisual evidence | fairness, belief, obligation |

Label the selected definition, not the bare headword, POS, source domain, or
incidental objects in its likely photograph. A noun can describe a process and
a verb can describe a state. Entity does not mean solid object. An action does
not require a human. Static support/grasp is a relation; carrying also requires
movement. Label both categories only when both contribute meaningfully.

The outputs are **multilabel**: pet-as-companion may need entity + relation;
pet-as-stroking action + relation. A definition offering alternative depictions
(snow falling OR lying on the ground) can have multiple useful evidence routes;
do not require every surviving image to display every positive category.

`abstract` is not the model's uncertainty class. Low confidence, novel meanings,
and ambiguous definitions need a separate abstention/fallback policy. Physical
carriers of information (sign, book, flag) remain entities. Do not mark every
physical item abstract merely because its composition/history cannot be proved
from a still image. Record those visibility limits separately. A facial
expression is visible; the actual private feeling is not established by it.

## Dataset and review contract

The versioned fixture lives in `tests/fixtures/meaning-taxonomy/`. Its labels
concern **text meanings**, not image suitability or personal preference. The
legacy corpus contributes unique exact definitions rather than one duplicate
training row per gallery. New pilot definitions are explicitly AI-authored,
not copied dictionary entries and not human-expert ground truth.

Every record includes exact word/POS/definition, positive categories, a primary
category for inspection/stratification, required evidence, rationale, provenance,
original source split, final group/split, and a content-bound AI review. Review
all labels, especially state/action, entity/place, relation, and abstract edges.
Do not manufacture probability targets or claim independent human review.

Use connected groups across shared headwords and original meaning families.
Keep polysemous headwords, paraphrases and linked variants together. Preserve
original legacy split metadata. Quarantine components whose legacy examples
already cross train/validation/test; never silently turn a legacy evaluation
meaning into training data. Assign new groups before fitting, keep all group
members together, and lock the final dataset hash before training.

Audit full source coverage, unique exact meanings/IDs, allowed labels, primary
membership, per-class positive/negative coverage, review hashes, source hashes,
group isolation, and quarantined conflicts. These checks establish integrity,
not objective linguistic truth. AI-authored definitions and AI review can share
bias; broaden with independently reviewed real app meanings before deployment.

The existing production personal MLP currently concatenates the 512-coordinate
image vector, 512-coordinate meaning vector, and three scoring features. This
is distinct from the six-output category classifier. Image vector plus category
probabilities is a proposed smaller personal-ranker input, not an already
integrated change. Compare it with the existing inputs on the same held-out
user decisions before claiming that full meaning vectors help.

## First classifier: regularized multilabel logistic regression

Encode only the original definition prompt using the pinned MobileCLIP text
encoder; do not include gold category names, review rationales, required-evidence
text, or generated category-specific prompts in its inputs. That would leak the
answer or create a circular classifier → prompt → classifier path.

For each of six categories, predict `p[c] = sigmoid(w[c] · text + b[c])` and fit
binary cross-entropy plus L2 regularization. Each row has six reviewed binary
targets. These are independent membership estimates, so their sum need not be
one. Softmax over one exclusive label would discard legitimate overlap.

Keep the full probability vector. For adapter mixtures, derive nonnegative
weights from it and normalize only for that operation; keep the original
probabilities available. Soft outputs preserve uncertainty but are not
automatically calibrated. An uncertain classifier must retain general scoring
rather than eliminate a category or reject an image by itself.

Start with text-vector-only logistic regression. Compare POS as an optional
feature, with explicit noun-process/verb-state/polysemy stress tests. Estimate
class weights only on training data; avoid duplicating rows to balance classes.
Choose L2/threshold/calibration on validation groups; use test groups once for
the selected candidate. If validation is too small for reliable calibration,
report that and do not advertise calibrated probabilities.

Report each class's precision, recall, F1 and sample support; macro/micro F1,
multilabel exact match, unweighted BCE/Brier scores, and source-specific results.
Group cross-validation by connected families, not row-index modulo. Record
seeds, fixture/model/prompt hashes, split IDs, learned weights, and all settings.
Prefer the linear model unless a small nonlinear alternative reliably improves
held-out performance. This dataset is a pilot, not deployment proof.

## Category-aware prompting and genuine negative contrasts

Keep direct definitions plus several verified positive scenes. Use category
weights to propose relevant descriptions without enforcing one rigid template.
Action prompts describe the defining event; relation prompts identify argument
roles; place prompts retain environmental structure; state prompts retain the
condition. An empty scene is not a universally wrong action image: objects can
fall and rain can fall without people.

Only genuine incompatible depictions qualify as negatives for an exact target
pair. A different category, unchosen image, alternative dictionary wording, or
co-occurring action is not automatically wrong. Several meanings can fit the
same image. Mark unknown pairs unknown and exclude them from negative loss.
Target words such as sign, logo, diagram, or screenshot require explicit tests
before treating the global unwanted-content prompt as an exclusion.

## Cropping experiment (added 2026-10-31)

Test mild crops as a separate, optional **image** augmentation experiment after
the text-category dataset stage. Define the amount by **retained image area**:
retain 80–100% of the source area, preserve aspect ratio initially, and compare
uncropped training with at most one accepted variant per selected original.
Retaining 80% of both width and height retains only 64% of area; removing 20%
from every edge is more aggressive still. Do not confuse those operations.

The crop is a different pixel input, not an independent original photograph.
Check whether the defining evidence remains: mouth–cup contact for drinking,
both referents for beside, support/contact for holding, full identifying subject
for entities, setting/layout for places, and the relevant condition for states.
Small crops can invalidate any of these. Center crops are not automatically safe.
Only reviewed meaning-preserving variants inherit a semantic label. Reassess
personal preference independently; a different composition can change taste.

Split original photos/families first; generate variants only for training and
keep every derivative with its parent. Re-encode changed pixels with the same
encoder/preprocessing; record parent/pixel hashes, crop coordinates, retained
area, aspect ratio, seed, exact meaning and crop-review outcome. Do not copy the
parent embedding or infer a positive label from embedding proximity alone.
Reject crops losing decisive evidence and retain an audit reason. Count unique
originals separately from variants and weight/cap descendants so a crop-rich
photo does not dominate. Keep validation/test photographs untouched.

Measure embedding/score changes as diagnostics, then compare held-out semantic
precision/recall and gallery choices after adapter training. More variants or
larger embedding distance do not by themselves establish a benefit. Mild crops
may give nearly redundant vectors after the encoder's resize/padding. This is
an experiment to test, not a promised accuracy improvement.

## What an adapter is, and which sides are transformed

Let `x` be the frozen unit image vector and `t` the frozen unit definition or
prompt vector. Compute category probabilities from the **original target
meaning**, then use the same routing weights for both modalities:

```
x' = normalize(x + sum_c alpha[c] * U_image[c] * V_image[c] * x)
t' = normalize(t + sum_c alpha[c] * U_text[c]  * V_text[c]  * t)
score = cosine(x', t')
```

The image and text matrices have different parameters, trained jointly into a
compatible space. Start near identity with small low-rank residuals and constrain
update magnitude. Do not independently route the photograph into a different
category: a bottle must be evaluated under the target meaning "drinking".

Treat each positive/negative candidate text symmetrically under the **anchor
target's** routing for a comparable score; separately evaluate routing candidate
texts by their own meanings as an ablation rather than silently mixing metrics.
The category head always reads the unadapted target embedding.

Matrices mix/reweight learned feature directions, which need not correspond to
individual interpretable coordinates. Scaling a whole vector does not affect
cosine. Adapters cannot recover pixel evidence absent from the frozen vector.
These output adapters are not LoRA inside the CLIP backbone; encoder fine-tuning
would be a separate, more expensive experiment and requires re-encoding data.
Retain raw vectors for taste learning and as the unchanged fallback.

## Training image/text adapters

A triplet is **anchor meaning, suitable image, unsuitable image**. The anchor is
the reference, not a neutral example. Also use the reverse comparison: anchor
image, suitable meaning/prompt, genuinely incompatible meaning/prompt.

For this project's existing explicit reviewed comparisons, start with pairwise
logistic ranking loss:

`L_rank = log(1 + exp((score_negative - score_positive) / temperature))`.

Minimization makes the positive score exceed the negative score and updates
both image/text adapter sets by gradient descent. No arbitrary fixed similarity
margin is needed initially; fit temperature/regularization on validation only.
Compare triplet hinge loss (`max(0, margin + negative - positive)`) as an ablation.

As verified pools grow, compare symmetric multi-positive contrastive learning:
one exact meaning can have several positive photos across backgrounds, and one
photo can have several valid captions/meanings. Use the reviewed positive/negative
mask; do not make all other batch members negatives. Broad category membership
is **not** a semantic-positive label: drinking and pouring can both be actions
while being a crucial negative pair for a particular image.

Preserve the base geometry with identity/update regularization, diverse replay
examples across all categories, and a separate unchanged-model comparator.
Guard against collapse and domination by one class or background. All image
variants stay with their parent group; never generate variants before splitting.
No semantic labels become personal taste labels. No training on ambiguous pairs.

Evaluate image-only, text-only and joint adapters, prompts alone, and the combined
candidate. Report semantic precision/recall and per-category failures, complete
gallery choices, latency, memory, and regressions on non-action meanings. Learn
new score thresholds on validation only: existing 0.19/zero-margin thresholds
cannot be assumed valid after the geometry changes. Score or re-encode every
prompt consistently, including unwanted/contrast prompts, and version caches.

## Personalization and acceptance

The semantic gate remains an estimate and can make mistakes. Keep wrong-meaning
feedback separate from preference feedback. The personal ranker initially gets
the original image vector plus the six raw category probabilities (518 values
for the current 512-D encoder). Meaning-only inputs cannot rank candidate images
for the same target. Preserve full original meaning vectors for experiments.

Compare personal low-rank/diagonal transforms and an image+category MLP using
real user choices and unseen decision groups. Do not impose a fixed 50/50 semantic
and taste formula. Keep an MLP only when it improves held-out preference choices;
do not assume it is required. Changing the encoder/feature contract requires
versioned vectors and retraining or rejecting incompatible personal weights.

## Research basis and limits

- [CLIP, Radford et al.](https://proceedings.mlr.press/v139/radford21a.html)
  provides the image–text representation/alignment background.
- [Supervised Contrastive Learning, Khosla et al.](https://papers.nips.cc/paper/2020/hash/d89a66c7c80a29b1bdbab0f2a1a94af8-Abstract.html)
  motivates evaluating multi-positive supervision against triplet alternatives.

Those papers do not establish that this proposed taxonomy, MobileCLIP adapters,
dataset, or personal ranker improves KeepVocab. That remains an experiment.

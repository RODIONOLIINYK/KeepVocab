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

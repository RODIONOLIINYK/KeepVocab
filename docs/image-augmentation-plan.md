# Dataset expansion and nine-image paging — 1.12.10

The app keeps the current frozen MobileCLIP S0 (FP16 text / FP32 vision) and the
selected ≥0.19 / unwanted <0.20 filter. Search scores up to 30 candidates, then
personal ranking orders survivors. Both chooser flows initially show up to nine.
More reveals up to nine retained survivors first; when exhausted it searches
another provider page/concept, screens/ranks the new pool, excludes prior URLs,
and appends new results. The old 40-result retention cap is removed. Fewer than
nine passing images remain fewer than nine; rejected images do not fill gaps.
The library still lets the user explicitly change the visual interpretation.

The isolated browser harness verified 9 initial choices, then 18, 27, 30 cached
choices without another request, followed by 39 and 48 with one fresh request.
Its numbered graphics exercise pagination, not semantic quality. Automated tests
also exercise the real library callbacks, exclusions and duplicate-only results.
The installed app, real vocabulary and study statistics were not used.

## Review of the proposed augmentations

| Idea | Assessment |
|---|---|
| Mild brightness/gray/contrast changes | Useful as an invariance experiment, but the 24-photo pilot's median embedding cosine 0.9961 shows limited new visual evidence. Do not count variants as independent examples. |
| Darken an image to change sunny into cloudy | Does not reliably change weather. Invalidates some labels and may change personal aesthetic preference. |
| Resize | The encoder already resizes/pads to a fixed input; many resize variants collapse to nearly the same input. |
| Invert colors | Usually creates an unnatural distribution and can break color meanings. Not recommended as a default. |
| Pair an image with a different meaning and label zero | The strongest of these ideas for adding semantic negatives, **after verifying the mismatch**. Random pairs can still be valid for several meanings. It adds new supervision, not new independent photos. |
| Add unrelated memes | Useful for a modest distractor subset. A meme can still depict a target, so label the exact pair, not the entire format as wrong. |
| Add noise directly to the embedding | A possible small regularizer, not a reliable semantic augmentation. Large perturbations can move off the distribution of real encoder outputs. |

The best expansion combines new, diverse positive photos with difficult negative
examples. Easy unrelated negatives alone will not teach pouring versus drinking.
No augmentation should be selected merely because it moves the embedding farther.
Distance measures changed representation, not preserved meaning or usefulness.

## Recommended experiments

1. **Different real photos, same precise meaning.** Vary subject species/person,
   setting, camera angle, object appearance and photographic style while preserving
   the defining action/relation. Collect positives whose image embeddings are
   noticeably different, then verify them visually. This is the highest priority.
2. **Controlled synthetic scene families.** Generate a person carrying a bag in
   varied settings, viewpoints and styles. Explicitly require the bag to be held
   and transported. Independently reject images that merely put it beside the
   person. Each generated result needs a fresh embedding and visual review.
3. **Matched hard negatives.** Pair running with standing, carrying with beside,
   drinking with pouring, open door with closed door. Change one meaning-defining
   fact; label it wrong for the original meaning and suitable for another meaning
   only after separate verification. Avoid obvious unrelated objects dominating.
4. **Meaning-preserving background/viewpoint/style edits.** Preserve the complete
   actor, object and interaction. Crop/occlusion can remove decisive evidence;
   text, color, weather and lighting meanings require additional restrictions.
   Illustration variants should be a separately tracked domain, evaluated on real
   app photos as well.
5. **Small embedding regularization or same-meaning mixup**, only as a later
   ablation. Use verified same-meaning positives, keep original/variant groups
   together, and test whether the resulting artificial vectors help held-out
   ranking. Do not mix an unrelated meaning with label zero without inspection.

These are experiments, not established accuracy improvements. AugMix targets
corruption robustness ([paper](https://arxiv.org/abs/1912.02781)); that does not
establish relevance gains here. Fine-grained hard-negative supervision is explored
by FG-CLIP ([paper](https://proceedings.mlr.press/v267/xie25k.html)); its published
results do not demonstrate improvement in our frozen MobileCLIP/personal MLP.

Split original images/meaning families before generating variants. All derivatives
stay with their parent; preserve generator, prompt, seed, exact target definition,
review status and source hashes. Keep real app evaluation images untouched.
Mix verified negatives with sufficient positives and cap easy meme negatives to a
small experimental share. Determine any class weighting from training data only.
Personal preferences remain separate: an agent's semantic zero is not a user's
visual dislike, and unchanged images do not get positive taste labels by default.

## Added supplement

`tests/fixtures/image-negative-supplement` contains 36 reviewed negative pairs:
24 distinct existing TRAIN photos paired with unrelated TRAIN meanings, and 12
original SVG graphic memes paired with unrelated meanings. Photo URLs/hashes,
parent groups, exact target cases and two-reviewer judgments are preserved.
The original photos are reused source images, not 24 newly discovered photos.
Initial ambiguous meme captions were rejected; revised assets have a separate
hash-bound review, retaining the earlier audit. Agreement is not infallible truth.

The supplement is training-eligible semantic data, **not a trained model update**.
The current CLIP is unchanged, and these labels were not silently treated as
personal MLP preferences. The standalone explorer includes the new source and
reports available versus missing embeddings honestly. Dataset growth alone does
not establish improved generalization; a held-out training comparison is needed.

All 36 images were re-encoded with the unchanged cached FP16/FP32 encoder. The
current gate already rejects all 36 exact mismatched pairs (24/24 photos, 12/12
memes). This confirms they are easy distractors for this model, not a solution to
its action/relationship failures. The next useful expansion is diverse positive
examples and near-miss negatives. Run
`node scripts/audit-image-negative-supplement.mjs` to replay source split,
independent label/hash, prompt, vector norm and current-gate checks without
training or network access.

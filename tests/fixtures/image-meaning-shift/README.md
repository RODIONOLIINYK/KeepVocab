# Same-meaning, new-photo diagnostic

This is a separate allocation of the preserved semantic-photo corpus. It does
not replace the original meaning-disjoint dataset, its labels or embeddings.
`split.json` lists explicit gallery IDs, matched exposure pairs, exclusions and
SHA-256 hashes of the three preserved input files. Every original gallery is
accounted for either in an experiment arm or in `preservedOutsideExperimentIds`.
Some old validation/test galleries supply new experiment training; these heads
cannot be evaluated against the old held-out split as independent tests.

Both arms share a 170-gallery background. The seen arm adds one gallery for
each of 21 target meanings; the unseen arm adds one gallery from each of 21
other meaning families. Each has 191 training galleries and 97 meanings.
Validation and test each contain one separate gallery per target meaning.
All candidate photos are kept disjoint across training/validation/test, including
distractors and source identity aliases. A full-source difference-hash screen
found no near-duplicate pairs under its stated threshold.

Luna and Terra reviewed target meanings visibly from contact sheets, without
the proposed reference or model scores. All 102 proposed held-out galleries,
37 surviving target-exposure galleries and 29 surviving matched controls were
reviewed. An 18-gallery root spotcheck is recorded separately. Any uncertainty,
multiple valid photos or disagreement with the original reference excludes the
whole target/control group; 21 of the 51 proposed groups survive. The common
background retains historical labels and has not been relabeled in this run.

`audit/` retains primary classifications, blind indexes, metadata-only proposals,
source audit and every exclusion reason. Do not treat a disagreement as a
verified error in the historical label. Excluded/unused original records remain
available; flagged records need adjudication before future use as ground truth.
Raw photos and CLIP weights are not committed or shipped with the application.

Reproduce from tag `v1.12.7`, in the repository root:

```sh
node scripts/benchmark-image-meaning-shift.mjs --seed=78123
node scripts/benchmark-image-meaning-shift.mjs --seed=78124
node scripts/benchmark-image-meaning-shift.mjs --seed=78125
node scripts/benchmark-image-meaning-shift.mjs --aggregate
python3 -m pip install -r scripts/requirements-image-training.txt
python3 scripts/verify-meaning-shift.py work/meaning-shift/results work/meaning-shift/verification.json
python3 scripts/plot-meaning-shift.py work/meaning-shift/results/report.json work/meaning-shift/figures
```

Every fit starts from scratch; frozen CLIP is never retrained. The model and
optimizer recipe are unchanged from 1.12.6. All six fits/checkpoints must finish
before aggregate test scoring. Selected and final weights are offline artifacts;
no experimental head is activated. Seeds share the same 21 test meanings and
must not be counted as 63 independent examples.

This is a small retrospective regression study. Agreement-based curation and
easy unrelated distractors can make the set ceiling-limited; it cannot establish
the principal cause of real-app failures or personal-taste performance.

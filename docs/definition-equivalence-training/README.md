# Definition equivalence research reference

The current research reference, selected by the user on November 16, 2026, is
**v7 prefix + IDF · batch 16** (`E2_v7_bs16_prefix_idf_optionB`). Compare future
experiments against this variant. Changing the reference requires an explicit
record of the replacement configuration and its evaluation.

The machine-readable record is [reference.json](reference.json). The full saved
comparison is [reports/ablation-regularization-v6-v7-2026-11-16.json](reports/ablation-regularization-v6-v7-2026-11-16.json),
with a readable summary in [ABLATION_RESULTS_2026-11-16.md](ABLATION_RESULTS_2026-11-16.md).

## Pinned configuration

- Shared MiniLM-L6 encoder, fine-tuned on the dictionary-only v7 export.
- Batch size 16; learning rate `2e-5`; seed 42; maximum five epochs;
  encoder input limit 96 tokens; AdamW weight decay `0.01`.
- Evaluate pooled-cosine validation PR-AUC each epoch and restore the best
  checkpoint: epoch **4** in the saved run. Its encoder selection score
  (`0.7278488514604595`) is distinct from the final five-feature scorer score.
- Five-feature logistic scorer: pooled sentence cosine, symmetric mean token
  best-match, symmetric minimum token best-match, symmetric 25th percentile
  token best-match, and token-count ratio.
- Exclude the headword/POS prefix through the first colon from token matching.
  The encoder and pooled sentence vector still use the full input.
- Apply IDF weights only to the mean token-match feature. Compute document
  frequencies from unique training texts using tokenizer token IDs:
  `idf = 1 + log((N + 1) / (df + 0.5))`; unseen token IDs use `df = 0`.
- No label smoothing and no patience-based termination in this reference.
  Proposed changes must be separate experiments, preserving these results.

## Saved evaluation

| Metric | Validation | Test |
| --- | ---: | ---: |
| Pairs | 390 | 384 |
| Equivalent / distinct | 122 / 268 | 121 / 263 |
| Final scorer PR-AUC | 0.719699 | 0.719228 |
| Final scorer ROC-AUC | 0.831050 | 0.847060 |
| F1 at validation best-F1 threshold | 0.658333 | 0.621005 |
| TP / FP at that threshold | 79 / 39 | 68 / 30 |
| TP / FP at validation zero-FP threshold | 18 / 0 | 21 / 4 |

The validation-selected best-F1 threshold is `0.6957939863204956`; the
validation-selected zero-FP threshold is `0.9874299168586731`. Neither is a
probability guarantee. The zero-FP designation describes validation only.

This is a user-selected reference, rather than a claim that it leads every
metric. The batch-32 prefix + IDF run has the highest observed test PR-AUC in
this ablation suite. Small differences are exploratory: the test set has been
inspected repeatedly and these comparisons have not been replicated across
seeds. Labels are agent-reviewed, with `humanVerified: false`.

## Dataset and provenance

The pinned export is
`work/meaning-equivalence-domain/dictionary-only-2026-11-15/v7/`:
2,722 training pairs (674 equivalent, 2,048 distinct), 390 validation pairs,
and 384 test pairs. Training has 656 headwords; validation and test each have
60. Family-disjoint splits and dictionary extraction evidence are preserved.
Deterministic duplicate controls stay outside ML metrics.

On November 16, 2026, the following read-only validation passed with source
re-extraction verified and zero split overlaps:

```sh
node scripts/meaning-equivalence-domain/dictionary_only.mjs \
  --validate work/meaning-equivalence-domain/dictionary-only-2026-11-15/v7 \
  --for-training
```

Run that gate again before any future fitting or calibration. Every input
definition must be dictionary-extracted text with receipts, source hashes,
attribution, and licenses; generated paraphrases and contrasts are forbidden.

`reference.json` records SHA-256 hashes for the dataset, extraction ledger,
manifest, audit, implementation files, and source MiniLM model/tokenizer.
These large/local artifacts are not bundled in this commit; their paths and
hashes identify the existing local evidence. The commit records configuration
and results, and does not include a deployable trained checkpoint or change
the app's active model.

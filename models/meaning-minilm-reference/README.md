---
license: apache-2.0
language: en
library_name: transformers.js
base_model: sentence-transformers/paraphrase-MiniLM-L6-v2
tags:
  - onnx
  - semantic-similarity
  - keepvocab
---

# KeepVocab meaning merge reference

Fine-tuned shared MiniLM-L6 bi-encoder and five-feature logistic scorer for
comparing English dictionary meanings. Reference: `minilm-l6-v7-prefix-idf-bs16`.
This is the seed-42, restored epoch-4 reference, exported with FP16 weights and
FP32 inputs/outputs. No fitting or recalibration is performed by the export.

Use the tokenizer, encoder, and `scorer.json` together. Apply KeepVocab's
`meaningEmbeddingText` preprocessing, encode at most 96 tokens, and retain full
context for attention-mask mean pooling and L2 normalization. For token
matching, exclude special tokens and everything through the first colon;
fall back to all non-special tokens if no tokens remain. L2-normalize each
token vector. Features, in order: pooled cosine, symmetric IDF-weighted mean
token best match, symmetric minimum best match, symmetric 25th-percentile best
match (linear interpolation), and token-count ratio. IDF affects the mean only.
Apply the supplied logistic weights and bias without feature standardization.

The automatic merge threshold `0.9874299168586731` was selected on validation.
It produced 0 false merges on validation and **4 on test**; it is not a
guarantee. Validation/test PR-AUC: 0.719699 / 0.719228. Labels were independently
agent-reviewed, **not human-verified**. Research results are exploratory and
the test set has been inspected repeatedly. Explicit user judgments take
precedence; clustering must use complete linkage to avoid transitive merges.

Training used dictionary-tool-only v7 pairs with extraction receipts and
disjoint headword families. Training definitions and source datasets are not
included in this repository. No generated definitions were added for export.

Source, inference, export, and full reference record:
https://github.com/RODIONOLIINYK/KeepVocab

Upstream model: https://huggingface.co/sentence-transformers/paraphrase-MiniLM-L6-v2

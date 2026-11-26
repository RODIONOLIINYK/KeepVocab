# KeepVocab v8 MiniLM + Min/MaxLen

Local application model: seed 42, validation-selected v8 encoder and seven-feature
logistic scorer. No new fitting is performed during export. The frozen v7 model
remains in `models/meaning-minilm-reference`.

Use the tokenizer, FP16 ONNX encoder and scorer together. Apply production
`meaningEmbeddingText`, encode at most 96 tokens, mean-pool using the attention
mask, and L2-normalize. Token matching masks special tokens and the first-colon
prefix. The original five features are pooled cosine, symmetric IDF-weighted
mean best match, symmetric minimum best match, symmetric 25th-percentile best
match, and token-count ratio. Append `log1p(min words)` and `log1p(max words)`
from the full, untruncated comparison glosses, standardized with the supplied
training-only `lengthScaler`. Word counting follows Python's Unicode
`\b\w+(?:['’\-]\w+)*\b` expression. Preserve float32 length-feature arithmetic.
Only the final two columns are standardized. Apply all seven weights and bias.

The validation-only best-F1 threshold is **0.42793698608875275**, the midpoint of
`(0.4254998564720154, 0.4303741157054901]`. Original FP32 validation predictions:
F1 0.699793, precision 62.13%, recall 80.09% (169 TP, 103 FP). Held-out test:
F1 0.640371, precision 57.50%, recall 72.25% (138 TP, 102 FP). These are pairwise
metrics, not complete-linkage cluster metrics or guarantees of safe merging.
User judgments and complete-linkage constraints remain in force.

The dataset has 4,266 train, 656 validation and 642 test pairs. Exact headwords,
families, sense IDs, receipts, source-definition hashes, and preprocessed glosses
are disjoint across splits. One near-duplicate crosses train/test: “To a great
degree or extent” (`much`) versus “To a great extent or degree” (`substantially`).
Therefore exact disjointness does not prove semantic independence. Labels are
agent-reviewed, not human-verified; the repeatedly inspected test set is not a
fresh blind benchmark. Dataset text and research reports are not bundled.

The application installs checksum-pinned assets from its own local model
directory; no model publication or external repository push is required.
Upstream: sentence-transformers/paraphrase-MiniLM-L6-v2 (Apache-2.0; see LICENSE.txt).

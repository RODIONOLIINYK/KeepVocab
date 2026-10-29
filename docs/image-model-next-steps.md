# Image-model research review — 2026-10-29

The user supplied an external research report dated 2026-10-28. Its experiments,
acceptance targets and architecture proposals are recommendations, not measured
KeepVocab results or instructions to enable every proposed service.

## Recommendation

Separate exact-meaning verification from personal taste. A joint image/text
verifier can inspect whether the visible action, state or relationship is true;
a preference model then orders only the photographs accepted as suitable.
Include `fit`, `wrong`, `unclear` and an explicit all-wrong outcome. Do not
enable the rejected generic MLP or deepen it without independent evidence.

The current corrected regression result remains 107/120 for the app's CLIP
ranker and 105/120 with the generic MLP. This is neither a fresh hard-semantic
acceptance set nor evidence that another encoder or verifier will win.

## Verified external facts

- [Google's Gemini 3.8 Flash documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
  lists image input and structured output. It is a plausible cloud-verifier
  candidate, not a proven KeepVocab accuracy winner. An experiment would send
  one batch of diverse candidate thumbnails with the exact dictionary sense.
- [Current Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash)
  lists introductory paid rates of $0.75/M input and $3.75/M output/thinking
  tokens through 2026-12-31. The report's per-gallery cost is an estimate, not
  an observed invoice or a fixed cost across model media settings.
- [SigLIP2 Base P16/224](https://huggingface.co/google/siglip2-base-patch16-224)
  is Apache-2.0 and has an existing
  [ONNX conversion](https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/tree/main/onnx).
  It is worth comparing on identical candidate pools. Its browser precision,
  preprocessing parity, speed and hard-semantic accuracy remain unmeasured here.
- [CORE](https://arxiv.org/abs/2609.04083) reports an advantage for cross-attentive
  reranking on compositional benchmarks. That supports evaluating a joint
  verifier; its benchmark numbers are not KeepVocab accuracy or phone latency.
- Apple's current [MobileCLIP-S0 model card](https://huggingface.co/apple/MobileCLIP-S0)
  and [MobileCLIP2-S0 card](https://huggingface.co/apple/MobileCLIP2-S0) identify
  the weights as Apple AMLR. The [model-weight license](https://github.com/apple-aiml-research/ml-mobileclip/blob/main/LICENSE_MODELS)
  limits use to research and excludes product development and commercial use.
  The source-code license is separate. The pinned 2024 Xenova conversion says
  `license: other`; that is not affirmative evidence of commercial permission.
  Historical rights for that exact artifact have not been established here.
  Prioritize a permissive alternative or obtain appropriate rights before
  relying on these weights for product deployment.

## Code audit

The report correctly identifies waiting for all provider requests, a default
12-image visual shortlist out of up to 40, serial image inference, and persistent
embedding lookup only after thumbnail download/hash. Provider deadlines and a
small in-memory thumbnail cache already exist. True tensor batching and stable
provider-identity embedding lookup would be additional work.

Counterfactual scene scoring already exists; measure its coverage rather than
adding a duplicate mechanism. Semantic and preference training are separate,
but runtime does not yet restrict taste learning to independently verified-fit
alternatives. The optional Gemini reranker only orders four images and does not
provide rejection; production callers currently do not enable it.

The 1.12.1 startup change addresses worker retention and deferred cached warmup.
It does not implement provider streaming, tensor batching, a new encoder or a
cloud semantic gate.

## Next experiment

Measure provider coverage, local shortlist survival and semantic correctness
separately. Preserve the raw candidate pool before ranking. Use a fresh blind
evaluation with same-subject action/state/relation contrasts, competing senses,
and all-wrong galleries. Split by meaning family and photo identity; tune only
on development data. Report accepted-photo precision and all-wrong false
acceptance as well as first-choice accuracy.

Compare the corrected local baseline, a SigLIP2 candidate and a batch joint
verifier on the same pools. Precomputed same-checkpoint text vectors can avoid
shipping a large text tower for known meanings, but arbitrary user definitions
and generated scenes still need a text-embedding path. Measure phone load,
warm inference, peak memory, UI responsiveness and end-to-end latency before
choosing a mobile default. Download size alone does not establish memory cost.

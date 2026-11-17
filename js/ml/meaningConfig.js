export const MEANING_MODEL_ID = 'minilm-l6-v7-prefix-idf-bs16';
export const MEANING_MODEL_SHA256 = 'b82fa18b75097235c9def45a27916fe069b8c7f4885b283dc998f174ab43158b';
export const MEANING_MODEL_TAG = `${MEANING_MODEL_ID}:${MEANING_MODEL_SHA256}:fp16`;
// Validation-only best F1 with precision >60%; midpoint of the optimal score
// interval avoids putting a rounded FP16 positive exactly on the boundary.
export const MEANING_MERGE_THRESHOLD = 0.6916793788299911;
export const MEANING_REVIEW_THRESHOLD = 0.5;
export const MEANING_MAX_TOKENS = 96;
export const MEANING_MODEL_REPO = 'Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7';
export const MEANING_MODEL_REVISION = 'be8ee3e1076958149ee7a1e0ace8615d2c43ee86';
export const MEANING_MODEL_BASE = `https://huggingface.co/${MEANING_MODEL_REPO}/resolve/${MEANING_MODEL_REVISION}/`;
export const MEANING_CACHE = 'keepvocab-meaning-model-v1';

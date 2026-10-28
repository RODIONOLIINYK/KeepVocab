export const CLIP_MODEL = 'Xenova/mobileclip_s0';
export const CLIP_REVISION = '757d59c9c6870a76a4b0306f05f5061bca15c39f';
export const LEGACY_CLIP_TAG = `${CLIP_MODEL}@${CLIP_REVISION}:q8`;
// The model author requires fp32 for the vision tower; q8 vision destroys
// alignment with text. The text tower remains quantized for mobile memory.
export const CLIP_TEXT_DTYPE = 'q8';
export const CLIP_VISION_DTYPE = 'fp32';
export const CLIP_TAG = `${CLIP_MODEL}@${CLIP_REVISION}:text-q8-vision-fp32`;
export const CLIP_DIMENSION = 512;
export const CLIP_CACHE = 'keepvocab-clip-model-v1';
export const VECTOR_DB = 'keepvocab-clip-vectors-v1';
export const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
// Include the WASM runtime in the consent estimate and installed-file check.
export const MODEL_DOWNLOAD_MB = 150;
export const CLIP_MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'onnx/text_model_quantized.onnx', 'onnx/vision_model.onnx'];
export const CLIP_RUNTIME_URLS = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'].map(file => `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${file}`);
export const CLIP_DOWNLOAD_URLS = [...CLIP_MODEL_FILES.map(file => `https://huggingface.co/${CLIP_MODEL}/resolve/${CLIP_REVISION}/${file}`), ...CLIP_RUNTIME_URLS];

export const CLIP_MODEL = 'onnx-community/siglip2-base-patch16-256-ONNX';
export const CLIP_REVISION = 'd1114256522a37ffa257a0a58017348ab0058db2';
export const LEGACY_CLIP_TAG = 'Xenova/mobileclip_s0@757d59c9c6870a76a4b0306f05f5061bca15c39f:q8';
export const PREVIOUS_CLIP_TAG = 'Xenova/mobileclip_s0@757d59c9c6870a76a4b0306f05f5061bca15c39f:text-q8-vision-fp32';
export const ARCHIVED_FP16_CLIP_TAG = 'Xenova/mobileclip_s0@757d59c9c6870a76a4b0306f05f5061bca15c39f:text-fp16-vision-fp32';
export const ARCHIVED_CLIP_TAGS = [
  LEGACY_CLIP_TAG,
  PREVIOUS_CLIP_TAG,
  ARCHIVED_FP16_CLIP_TAG
];
export const CLIP_TEXT_DTYPE = 'q4f16';
export const CLIP_VISION_DTYPE = 'q4f16';
export const CLIP_TAG = `${CLIP_MODEL}@${CLIP_REVISION}:full-vocab-packed4-block64-standard-ops-v1:text-${CLIP_TEXT_DTYPE}-vision-${CLIP_VISION_DTYPE}`;
export const CLIP_DIMENSION = 768;
export const CLIP_CACHE = 'keepvocab-clip-model-v3';
export const VECTOR_DB = 'keepvocab-clip-vectors-v2';
export const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
// Include the WASM runtime in the consent estimate and installed-file check.
export const MODEL_DOWNLOAD_MB = 215;
export const MODEL_PAYLOAD_MB = 207.53;
export const CLIP_MODEL_BASE = 'https://raw.githubusercontent.com/RODIONOLIINYK/KeepVocab/v1.12.29/models/siglip2-compact-v1/';
export const CLIP_MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'onnx/text_model_q4f16.onnx', 'onnx/vision_model_q4f16.onnx'];
export const CLIP_RUNTIME_URLS = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'].map(file => `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${file}`);
export const COMPACT_RUNTIME_ASSET = { gzip: true, bytes: 26861777, sha256: '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082', parts: ['runtime.wasm.gz'] };
export const CLIP_DOWNLOAD_URLS = [...CLIP_MODEL_FILES.map(file => `${CLIP_MODEL_BASE}${file}`), ...CLIP_RUNTIME_URLS];
export const COMPACT_MODEL_ASSETS = {
  'onnx/text_model_q4f16.onnx': { gzip: true, bytes: 163230015, sha256: '3ddb5667293d12d3b84af944acbd8c91e49155b617ee8e71322040eaa2788e84',
    parts: ['text-model-1.bin', 'text-model-2.bin'] },
  'tokenizer.json': { gzip: true, bytes: 34363039, sha256: 'cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322', parts: ['tokenizer.json.gz'] },
  'onnx/vision_model_q4f16.onnx': { bytes: 54723009, sha256: 'e077a0e33fcc362a6e741a0c7571ba3044a4f8093bb0eaa9f93f54919191848a',
    parts: [`https://huggingface.co/${CLIP_MODEL}/resolve/${CLIP_REVISION}/onnx/vision_model_q4f16.onnx`] }
};

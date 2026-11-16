"""Export the saved reference checkpoint without fitting or recalibrating it.

Run with the research torch environment; the source run is the exact seed-42
control which reproduced the reference's epoch and validation PR-AUC.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil

os.environ['HF_HUB_OFFLINE'] = '1'
import onnx
import torch
from transformers import AutoModel, AutoTokenizer
from onnxruntime.transformers.float16 import convert_float_to_float16

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'work/meaning-equivalence-domain/smoothing-early-stopping-2026-11-16/eps-0.00-seed-42'
OUTPUT = ROOT / 'models/meaning-minilm-reference'
reference = json.loads((ROOT / 'docs/definition-equivalence-training/reference.json').read_text())
run = json.loads((SOURCE / 'run.json').read_text())
assert run['epsilon'] == 0 and run['seed'] == 42
assert run['training']['bestEpoch'] == reference['encoderTraining']['selectedEpoch']
assert run['validation']['rank']['prAuc'] == reference['savedEvaluation']['val']['prAuc']
for name, digest in run['artifacts'].items():
    assert hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == digest, name

OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'onnx').mkdir(exist_ok=True)
model = AutoModel.from_pretrained(SOURCE / 'encoder', local_files_only=True, attn_implementation='eager').eval()
tokenizer = AutoTokenizer.from_pretrained(SOURCE / 'encoder', local_files_only=True)

class Encoder(torch.nn.Module):
    def __init__(self, encoder):
        super().__init__()
        self.encoder = encoder
    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.encoder(input_ids=input_ids, attention_mask=attention_mask,
                            token_type_ids=token_type_ids, return_dict=False)[0]

sample = tokenizer(['model export'], return_tensors='pt')
fp32 = SOURCE / 'reference-export-fp32.onnx'
names = ['input_ids', 'attention_mask', 'token_type_ids', 'last_hidden_state']
with torch.no_grad():
    torch.onnx.export(Encoder(model), tuple(sample[name] for name in names[:3]), str(fp32),
                      input_names=names[:3], output_names=names[3:], opset_version=17,
                      dynamo=False, external_data=False,
                      dynamic_axes={name: {0: 'batch', 1: 'sequence'} for name in names})
graph = convert_float_to_float16(onnx.load(fp32), keep_io_types=True)
onnx.checker.check_model(graph)
onnx.save(graph, OUTPUT / 'onnx/model_fp16.onnx')
tokenizer.save_pretrained(OUTPUT)
model.config.save_pretrained(OUTPUT)
scorer = json.loads((SOURCE / 'scorer.json').read_text())
scorer.update(referenceId=reference['referenceId'], maxInputTokens=96,
              threshold=reference['savedEvaluation']['val']['zeroFpFromVal']['threshold'],
              reviewThreshold=reference['savedEvaluation']['val']['bestF1FromVal']['threshold'],
              comparisonVersion='semantic-qualifiers-v2',
              sourceEncoderSha256=run['artifacts']['encoder/model.safetensors'],
              sourceScorerSha256=run['artifacts']['scorer.json'],
              precision='fp16-weights-fp32-io',
              calibration='validation-selected; 0 validation and 4 test false merges',
              humanVerified=False)
(OUTPUT / 'scorer.json').write_text(json.dumps(scorer, separators=(',', ':')) + '\n')
shutil.copyfile(ROOT / 'js/ml/TRANSFORMERS-LICENSE.txt', OUTPUT / 'LICENSE.txt')
(OUTPUT / 'NOTICE.txt').write_text('Fine-tuned sentence-transformers/paraphrase-MiniLM-L6-v2 (Apache-2.0).\n'
    'Reference: minilm-l6-v7-prefix-idf-bs16; seed 42; restored epoch 4.\n'
    'Export only, no new training or calibration. FP16 weights with FP32 inputs/outputs.\n'
    'Dictionary-only v7 data; agent-reviewed labels, not human-verified.\n')
manifest = {p.relative_to(OUTPUT).as_posix(): {'bytes': p.stat().st_size,
            'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in OUTPUT.rglob('*') if p.is_file() and p.name != 'manifest.json'}
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'referenceId': reference['referenceId'], 'files': manifest}, indent=2))

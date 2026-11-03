"""Export full-vocabulary SigLIP 2 with real INT4 token-embedding weights.

Requires onnx and numpy. Input is the pinned upstream q4f16 model directory;
output is a reproducible release pack, never a training-data artifact.
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import shutil

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def export(source, output, block_size=64):
    output.mkdir(parents=True, exist_ok=True)
    (output / "onnx").mkdir(exist_ok=True)
    model = onnx.load(source / "onnx/text_model_q4f16.onnx")
    embedding = next(x for x in model.graph.initializer if x.name == "text_model.embeddings.token_embedding.weight")
    shape = list(embedding.dims)
    assert shape == [256000, 768], shape
    data = numpy_helper.to_array(embedding)
    # Affine blocks along each token's feature axis; no token is removed.
    blocks = data.astype(np.float32).reshape(256000, 768 // block_size, block_size)
    minimum = np.minimum(blocks.min(axis=2), 0)
    maximum = np.maximum(blocks.max(axis=2), 0)
    scales = np.maximum((maximum - minimum) / 15, 1e-7).astype(np.float32)
    zero = np.clip(np.rint(-minimum / scales), 0, 15).astype(np.uint8)
    quantized = np.clip(np.rint(blocks / scales[..., None]) + zero[..., None], 0, 15).astype(np.uint8).reshape(-1)
    packed = ((quantized[::2] & 15) | ((quantized[1::2] & 15) << 4)).astype(np.uint8)
    weight_name = embedding.name + "_int4"
    scale_name = embedding.name + "_scales"
    zero_name = embedding.name + "_zero"
    model.graph.initializer.remove(embedding)
    model.graph.initializer.extend([
        numpy_helper.from_array(packed.reshape(256000, 384), weight_name),
        numpy_helper.from_array(scales, scale_name),
        numpy_helper.from_array(zero, zero_name),
    ])
    node = next(n for n in model.graph.node if n.op_type == "Gather" and n.input[0] == embedding.name)
    # WASM lacks GatherBlockQuantized in its minimal CPU kernel set. Select only
    # the requested packed rows, then unpack their two nibbles using standard
    # operators. This retains real 4-bit storage without expanding all 256k rows.
    prefix = 'compact_embedding/'
    for name, value in [('sixteen', np.array(16, np.float32)), ('axis', np.array([3], np.int64)),
                        ('blocks_shape', np.array([0, 0, 768 // block_size, block_size], np.int64)),
                        ('output_shape', np.array([0, 0, 768], np.int64))]:
        model.graph.initializer.append(numpy_helper.from_array(value, prefix + name))
    nodes = []
    def add(op, inputs, output, **attrs):
        nodes.append(helper.make_node(op, [i if i in (weight_name, scale_name, zero_name, node.input[1]) else prefix + i for i in inputs],
                                      [prefix + output], name=prefix + output, **attrs))
    add('Gather', [weight_name, node.input[1]], 'packed_rows', axis=0)
    add('Cast', ['packed_rows'], 'bytes', to=TensorProto.FLOAT)
    add('Div', ['bytes', 'sixteen'], 'quotient')
    add('Floor', ['quotient'], 'high')
    add('Mul', ['high', 'sixteen'], 'high_shifted')
    add('Sub', ['bytes', 'high_shifted'], 'low')
    add('Unsqueeze', ['low', 'axis'], 'low_expanded')
    add('Unsqueeze', ['high', 'axis'], 'high_expanded')
    add('Concat', ['low_expanded', 'high_expanded'], 'interleaved', axis=3)
    add('Reshape', ['interleaved', 'blocks_shape'], 'quantized_blocks')
    add('Gather', [scale_name, node.input[1]], 'scale_rows', axis=0)
    add('Unsqueeze', ['scale_rows', 'axis'], 'scale_blocks')
    add('Gather', [zero_name, node.input[1]], 'zero_rows', axis=0)
    add('Cast', ['zero_rows'], 'zero_float', to=TensorProto.FLOAT)
    add('Unsqueeze', ['zero_float', 'axis'], 'zero_blocks')
    add('Sub', ['quantized_blocks', 'zero_blocks'], 'centered')
    add('Mul', ['centered', 'scale_blocks'], 'decoded')
    add('Reshape', ['decoded', 'output_shape'], 'embedding')
    nodes.append(helper.make_node('Cast', [prefix + 'embedding'], list(node.output), to=TensorProto.FLOAT16, name=prefix + 'fp16'))
    position = list(model.graph.node).index(node)
    model.graph.node.remove(node)
    for index, replacement in enumerate(nodes):
        model.graph.node.insert(position + index, replacement)
    onnx.checker.check_model(model)
    onnx.save(model, output / "onnx/text_model_q4f16.onnx")
    with open(output / "text-model.onnx.gz", "wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=6) as compressed:
            compressed.write((output / "onnx/text_model_q4f16.onnx").read_bytes())
    shutil.copyfile(source / "onnx/vision_model_q4f16.onnx", output / "onnx/vision_model_q4f16.onnx")
    for name in ["config.json", "preprocessor_config.json", "tokenizer_config.json"]:
        shutil.copyfile(source / name, output / name)
    # The full multilingual tokenizer is losslessly compressed for transport.
    with open(output / "tokenizer.json.gz", "wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=9) as compressed:
            compressed.write((source / "tokenizer.json").read_bytes())
    files = {}
    for file in sorted(output.rglob("*")):
        if file.is_file() and file.name not in ("manifest.json", "tokenizer.json"):
            files[str(file.relative_to(output))] = {"bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
    total = sum(item["bytes"] for name, item in files.items() if name != 'onnx/text_model_q4f16.onnx')
    assert total < 220_000_000, f"Model pack exceeds 220 MB: {total}"
    manifest = {"source": "onnx-community/siglip2-base-patch16-256-ONNX", "revision": "d1114256522a37ffa257a0a58017348ab0058db2",
                "format": f"full-vocab-packed4-block{block_size}-standard-ops-q4f16-v1", "vocabularySize": 256000, "dimension": 768,
                "downloadBytes": total, "files": files}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


def publishable_files(output, destination, runtime_wasm=None, runtime_module=None):
    """Shard the custom tower below GitHub's per-file limit; the vision stays upstream."""
    destination.mkdir(parents=True, exist_ok=True)
    data = (output / "text-model.onnx.gz").read_bytes()
    for index, offset in enumerate(range(0, len(data), 80_000_000)):
        (destination / f"text-model-{index + 1}.bin").write_bytes(data[offset:offset + 80_000_000])
    shutil.copyfile(output / "tokenizer.json.gz", destination / "tokenizer.json.gz")
    for name in ("config.json", "preprocessor_config.json", "tokenizer_config.json"):
        shutil.copyfile(output / name, destination / name)
    # Legal notices accompany the deployed model pack.
    deployed = pathlib.Path(__file__).resolve().parent.parent / "models/siglip2-compact-v1"
    for name in ("LICENSE", "NOTICE"):
        if (deployed / name).resolve() != (destination / name).resolve():
            shutil.copyfile(deployed / name, destination / name)
    manifest = json.loads((output / "manifest.json").read_text())
    if (runtime_wasm is None) != (runtime_module is None):
        raise ValueError("Supply both --runtime-wasm and --runtime-module")
    if runtime_wasm is not None:
        wasm = runtime_wasm.read_bytes()
        module = runtime_module.read_bytes()
        wasm_sha = hashlib.sha256(wasm).hexdigest()
        if len(wasm) != 26861777 or wasm_sha != "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082":
            raise ValueError("WASM does not match the pinned ONNX Runtime build")
        if len(module) != 53057 or hashlib.sha256(module).hexdigest() != "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611":
            raise ValueError("Runtime module does not match the pinned ONNX Runtime build")
        compressed_path = destination / "runtime.wasm.gz"
        with compressed_path.open("wb") as target:
            with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=9) as compressed:
                compressed.write(wasm)
        packed = compressed_path.read_bytes()
        manifest["runtime"] = {
            "source": "onnxruntime-web@1.31.0-dev.20260914-8d85527a0",
            "wasmBytes": len(wasm), "wasmSha256": wasm_sha,
            "compressedWasmBytes": len(packed), "compressedWasmSha256": hashlib.sha256(packed).hexdigest(),
            "moduleBytes": len(module),
        }
        manifest["totalDownloadBytes"] = manifest["downloadBytes"] + len(packed) + len(module)
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--publish-dir", type=pathlib.Path)
    parser.add_argument("--runtime-wasm", type=pathlib.Path)
    parser.add_argument("--runtime-module", type=pathlib.Path)
    args = parser.parse_args()
    if bool(args.runtime_wasm) != bool(args.runtime_module) or (args.runtime_wasm and not args.publish_dir):
        parser.error("--runtime-wasm and --runtime-module must be supplied together with --publish-dir")
    export(args.source, args.output)
    if args.publish_dir:
        publishable_files(args.output, args.publish_dir, args.runtime_wasm, args.runtime_module)

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || []);
}

export function bytesToBase64(value) {
  const bytes = asBytes(value);
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return globalThis.btoa(binary);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  throw new Error('Base64 encoding is unavailable.');
}

export function base64ToBytes(value) {
  const encoded = String(value || '');
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(encoded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(encoded, 'base64'));
  throw new Error('Base64 decoding is unavailable.');
}

export async function blobToBase64(blob) {
  return bytesToBase64(await blob.arrayBuffer());
}

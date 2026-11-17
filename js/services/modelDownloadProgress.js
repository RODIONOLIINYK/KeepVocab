export async function readModelDownload(response, { total = Number(response.headers.get('content-length')) || 0, onProgress = () => {} } = {}) {
  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    onProgress({ loaded: bytes.byteLength, total: total || bytes.byteLength });
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let loaded = 0, lastReported = 0;
  onProgress({ loaded, total });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      if (Date.now() - lastReported >= 80) { onProgress({ loaded, total }); lastReported = Date.now(); }
    }
  } finally { reader.releaseLock(); }
  onProgress({ loaded, total: total || loaded });
  return new Blob(chunks).arrayBuffer();
}
export function renderModelProgress(id, label) {
  return `<div id="${id}" class="model-download-progress" hidden><progress aria-label="${label}"></progress><span role="status" aria-live="polite"></span></div>`;
}
export function paintModelProgress(element, state) {
  if (!element) return;
  const busy = ['downloading', 'loading'].includes(state.phase);
  element.hidden = !busy;
  if (!busy) return;
  const progress = element.querySelector('progress'), label = element.querySelector('span'), detail = state.downloadProgress;
  if (detail?.stage === 'downloading' && detail.total > 0) {
    progress.max = detail.total; progress.value = Math.min(detail.loaded, detail.total);
    label.textContent = `${Math.floor(100 * progress.value / progress.max)}% · ${(detail.loaded / 1e6).toFixed(1)} / ${(detail.total / 1e6).toFixed(1)} MB`;
  } else {
    progress.removeAttribute('value');
    label.textContent = detail?.stage === 'verifying' ? 'Verifying download…' : 'Preparing model…';
  }
}

// Images may be remote HTTPS resources or saved raster data. Source credits are
// external links only; inline images must never become navigable credit links.
export function safeImageSourceUrl(value) {
  const text = String(value || '').trim();
  if (!/^https:\/\//i.test(text)) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function safeImageUrl(value) {
  const text = String(value || '').trim();
  const remote = safeImageSourceUrl(text);
  if (remote) return remote;
  const inline = text.match(/^data:image\/(jpeg|png|webp|gif);base64,([a-z0-9+/=\s]+)$/i);
  if (!inline) return '';
  const data = inline[2].replace(/\s/g, '');
  if (!data || data.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(data)) return '';
  return `data:image/${inline[1].toLowerCase()};base64,${data}`;
}

export function savedWordImage(word) {
  const url = safeImageUrl(word?.imageUrl);
  if (!url) return null;
  return {
    url,
    thumbnailUrl: url,
    sourceUrl: safeImageSourceUrl(word.imageSourceUrl) || safeImageSourceUrl(url),
    title: word.word || 'Saved visual cue',
    attribution: word.imageAttribution || '',
    license: word.imageLicense || '',
    searchQuery: word.imageSearchQuery || ''
  };
}

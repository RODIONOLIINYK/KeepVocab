import { optimizeFsrsChannel } from '../services/fsrsOptimizer.js';
self.onmessage = ({ data }) => {
  try {
    const results = {};
    for (const channel of ['recall', 'recognition', 'assisted']) results[channel] = optimizeFsrsChannel(data.events, channel, data.models?.[channel], {
      progress: detail => self.postMessage({ progress: detail })
    });
    self.postMessage({ results });
  } catch (error) { self.postMessage({ error: error.message || 'Memory training could not finish.' }); }
};

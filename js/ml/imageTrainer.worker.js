import { trainImagePersonalizer } from '../services/imagePersonalizer.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: trainImagePersonalizer(data.records, data.model, { ...data.options, initialization: data.initialization, progress: progress => self.postMessage({ progress }) }) }); }
  catch (error) { self.postMessage({ error: error.message || 'Photo preferences could not be updated.' }); }
};

import { PERSONALIZER_VERSION, PERSONALIZER_PARAMETERS } from '../services/imagePersonalizer.js';

// Public semantic judgments are not a user's personal taste. Historical rejected
// semantic experiments remain in docs/image-fusion-v2.md, outside the live head.
export const PRETRAINED_IMAGE_REPORT = Object.freeze({
  targetTask: 'semantic',
  personalizerVersion: PERSONALIZER_VERSION,
  parameters: PERSONALIZER_PARAMETERS,
  accepted: false,
  use: 'No public personal-preference weights; validated personal learning starts from saved choices.',
  archivedExperiment: 'docs/image-fusion-v2.md'
});
export function getPretrainedImageModel() { return null; }
export function getImagePersonalizerInitialization() { return null; }

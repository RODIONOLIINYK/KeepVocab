// Shared optimizer/model settings for full-data, memorization and personal learning.
// The app enforces a separate worker scheduling budget on mobile.
export const IMAGE_TRAINING_RECIPE = Object.freeze({
  "epochs": 600,
  "maxMilliseconds": 1800000,
  "regularization": 0,
  "maximumGradientNorm": 1,
  "patience": 20,
  "minimumImprovement": 0.00001,
  "outputOnly": false,
  "checkpoint": "last",
  "learningRate": 0.0002,
  "batchSize": 8
});
export const MOBILE_IMAGE_TRAINING_BUDGET_MS = 20000;

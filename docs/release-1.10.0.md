# KeepVocab 1.10.0

Image picking learns from normal choices in the background. Choosing one photo
no longer marks all the other photos wrong, and hiding a photo keeps the current
search prompt, page, and remaining suggestions.

- Removed model explanations, confidence messages, training counters, parameter
  tables, manual fitting, comparison games, and suitability questionnaires from
  ordinary screens. Image choices, search, save, and skip stay straightforward.
- Clear image matches can be suggested without requiring deliberate negative
  ratings or a minimum number of labels. The previous 0.90 preference cutoff was
  poorly matched to the fitted scores and has been removed. Semantic checks and
  a clear ranking lead still protect automatic suggestions.
- Relative preferences use only loaded, visible alternatives after a successful
  save. A less-preferred photo remains eligible. Hiding suppresses only that photo,
  including known resized Pexels/Unsplash copies.
- Synced feedback survives an open review. Cancelled/failed saves, hidden or
  unloaded alternatives, and stale meanings do not teach implicit preferences.
  Older synced clients safely ignore the new comparison records.

Validation: all 535 tests pass, including the real 52-label fitted-score regression,
ordinary-choice learning, simplified settings, same-prompt photo hiding, synced
feedback, and stale meaning safeguards. Web assets, Apple Silicon-only macOS
DMG/ZIP, and Android debug APK built for this version. Android version code: 48.

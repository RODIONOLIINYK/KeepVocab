# KeepVocab 1.9.8

Image suggestions now generate concrete photograph prompts for each selected meaning. Adding words, reviewing images, and opening the Library image chooser prepare missing prompts with the configured Gemini key. Saved custom searches remain selected, with generated scenes available alongside them.

- Image searches reuse prompts saved for the exact source meaning, including during searches that disable further AI requests. Initial imports batch generation and keep images distinct across meanings.
- Generation receives the selected definition, learner wording, usage restrictions, and other meanings to avoid. Duplicate depictions for sibling meanings in a batch are retried. Updated scene records replace the older generator's cached prompts.
- Scene descriptions retain their complete action, setting, and distinguishing details. Search queries preserve actions and negation instead of reducing every scene to three nouns.
- Dictionary misses automatically ask Gemini. An obvious typo such as “mesures” can return “measures,” with the correction shown before saving. Exact valid forms are preserved, and unrelated or unacknowledged substitutions are rejected.

Validation: all 517 tests pass, including mocked Gemini generation, reversed response IDs, cached prompt reuse, distinct meaning images, spelling correction, and persistence regressions. Web assets, Apple Silicon macOS DMG/ZIP, and the Android debug APK were built for this version. Android version code: 47.

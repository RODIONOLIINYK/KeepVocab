# KeepVocab 1.11.0

Image personalization now considers both the photo and the word's exact meaning.
The 32/16 MLP uses CLIP's image/text embeddings and semantic scores, learns from
ordinary saved photo choices, and updates in a background worker. No additional
labeling task or model diagnostics appear in the picker.

- Saved scene descriptions and custom queries reach CLIP consistently. Optional
  scene contrasts distinguish different actions or attributes of the same subject.
- Full-frame proportional resizing and neutral padding preserve image edges.
- Complete photo feedback is retained in IndexedDB and backed up to connected
  Google Drive in separate versioned chunks, replacing the 256-record cap.
- Candidates require independent validation/test improvement before activation;
  changed feedback and resets invalidate pending work. Stored scores are ranking
  values, not claimed probabilities of correctness.
- Created and visually annotated 90 real-photo choices across 30 meanings, with
  disjoint training/validation/test photos and meaning groups. The pretrained
  network overfit: test agreement was 9/18 versus CLIP's 13/18. Its ranking head
  is disabled. Trained hidden layers initialize a zero-output personal head;
  personal updates fit its final 17 parameters and must pass their own check.
- Tested the actual picker by saving 12 choices: 24 archived events, including
  12 relative comparisons and no automatically fabricated wrong-image labels.
- Slow correct answers no longer automatically become Hard. FSRS priority
  calibration now fits the same bounded correction used at inference. A new
  read-only CLI evaluates exported FSRS-6 weights on later review histories.

Validation: all 556 automated tests pass; real pinned CLIP encoders processed the
photo fixture; actual worker promotion/cancellation and browser picking were
checked. The Mac arm64 DMG/ZIP and Android debug APK built successfully. Android
version code: 49. No physical-phone performance or retention improvement is claimed.

Full method and measured limitations: [image choices and local learning](image-picking-review.md).

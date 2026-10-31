# KeepVocab 1.12.11

Replaces the fixed `unwanted < 0.20` CLIP cutoff with the relative comparison `selected > unwanted` while retaining `selected >= 0.19`.

Updates Gemini contrast generation to include cross-category / different-part-of-speech depictions of the same word (such as static objects or places when the selected meaning is an action verb) alongside near-miss wrong actions, forwards cached contrasts into local CLIP scoring, and prevents overlapping near-synonym dictionary definitions from acting as negative contrasts.

Validation: 651 automated tests; web, macOS arm64 DMG/ZIP and Android debug APK (version code 61).

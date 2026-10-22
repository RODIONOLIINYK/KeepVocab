# KeepVocab 1.9.2

This release removes blank vertical gaps between meaning cards and word cards in the Library and Match Sprint views, unifies the Today screen color palette with a vibrant Duolingo/Brilliant-inspired green and multi-accent icon system, adds a training dataset and model weights inspector in Settings, and ensures replacing an image when editing a word meaning deletes any prior positive training entry and records the replaced image as a negative label alongside the newly chosen positive label.

Validation: 462 automated tests and the web build pass. macOS packages are Apple Silicon arm64 only. Android version code: 41.

The macOS packages remain unsigned, matching the existing release configuration. The Android download uses the same debug signing certificate as prior releases.

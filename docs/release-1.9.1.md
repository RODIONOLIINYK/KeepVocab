# KeepVocab 1.9.1

This release refines the Today screen, Library cards and tools, and image selection flow. Motion follows the app's existing visual style, with reduced-motion support. Image galleries show the available choices together, and save/skip actions explain their effect. Image preference guidance now explains what feedback teaches the local model. The update also keeps repeat queues in urgency order.

Validation: 461 automated tests and the web build pass. macOS packages are Apple Silicon arm64 only; all 15 packaged Mach-O files are arm64. Android version code: 40. The DMG verifies, Android APK signing matches the prior debug release, and all 101 web assets match in the macOS ASAR and Android APK. Update metadata hashes and sizes match the packaged macOS installers.

The macOS packages remain unsigned, matching the existing release configuration. The Android download uses the same debug signing certificate as prior releases.

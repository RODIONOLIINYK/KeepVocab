# KeepVocab 1.12.4

Keeps FP16 text with FP32 vision, deferred background preparation, session worker
reuse, and the image-search and interface improvements released in 1.12.3.

Fixes cleanup when one of the two encoders fails during parallel loading. The
worker now waits for both load attempts to settle and disposes any successful
encoder before reporting failure, allowing retry or CPU fallback without leaving
an unowned model allocated.

A regression test reproduces both failure orders, including the other encoder
finishing late, and verifies cleanup plus a successful retry. The normal success
path still loads both encoders in parallel and retains them for the session.

Validation: 616/616 automated tests passed, along with web, macOS arm64 and
Android debug builds (version code 54). Packaged assets match the tested web
files. The real macOS updater successfully mounted, verified and staged this
release beside an installed copy in the user's Applications folder.

This correction does not change ranking scores or precision, and does not
establish physical-phone memory or performance measurements.

# KeepVocab 1.8.7

Mac and Android update checks now distinguish an available update, a genuinely
current installation, and a newer release with no compatible verified installer.
A missing architecture asset or checksum no longer produces “You are up to date”.
Settings explains the mismatch and offers a fixed, trusted release-download link.
Malformed version responses produce an error. Mac checks bypass HTTP caches.

Apple Silicon and Rosetta installations use the arm64 installer. Historical
universal installers remain recognized; no Intel or universal build is generated.

Mac versions through 1.8.3 only recognize universal installer filenames. Their
existing code cannot discover arm64-only releases. Install the arm64 DMG manually
once, quit the old app completely, and reopen KeepVocab from Applications.
Vocabulary and progress stay in Application Support and are preserved. Version
1.8.4 and newer support native architecture updates. Intel Macs have no new build.

392 automated tests pass, including missing/wrong-architecture installers,
missing digests, malformed version responses, and available/current states.
Android version code: 36. Web cache: v18700.

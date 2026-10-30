# KeepVocab 1.12.10

Image choosers now show up to nine screened, ranked images initially. More reveals
retained results in groups of up to nine before searching another pool. New
searches exclude seen images and pass through the same CLIP filter and personal
ranking. Removes the 40-image retention cap that discarded later results.

Keeps the current CLIP encoder and selected ≥0.19 / unwanted <0.20 threshold.
Adds 36 reviewed semantic negative pairs (24 train-source photos and 12 original
graphic memes) with independent Luna review, provenance and source grouping.
These examples are training-eligible; no CLIP or personal model was retrained.

Includes an augmentation proposal comparing the user's ideas with diverse real
positives, controlled synthetic scenes and matched hard negatives. No unmeasured
accuracy improvement is claimed.

Validation: 651 automated tests; isolated browser paging check through 48 results;
web, macOS arm64 DMG/ZIP and Android debug APK (version code 60). All 117 web
assets match both packaged applications byte for byte. Personal study data was
not used.

# Image picking: non-ML plan implementation

The non-ML portions of the supplied `image_picking_plan.md` are implemented in
1.8.6. No CLIP, ONNX, local language model, model downloads, personal neural head,
or confidence-based automatic acceptance is included.

## Saved scenes and fewer repeated requests

`prepareImageScenes` saves a typed `imageScenes` record on each exact meaning:
source-sense fingerprint, generator version, source, up to three scenes, and
generation date. Records survive restart and Drive backup. Rewording a learner
explanation preserves the original source identity; selecting a different meaning
invalidates scenes, previous image choices, and sense-specific feedback.

Concrete object senses and narrowly validated curated matches skip Gemini. A
generic fallback is not treated as a curated match. Uncached meanings batch in
groups of 12 (maximum 20), with stable request IDs, per-item validation, one partial
retry, shared in-flight requests, and a short failure cooldown. Successful items
remain cached when other items fail. Add Word, Library, and Visual Match use this
pipeline. Library prioritizes saved/generated scenes instead of hiding them behind
three generic built-in suggestions. Permanent no longer matches ephemeral scenes.

## Candidate search and small previews

Search retains a bounded pool of up to 40 candidates before lexical ranking.
Ranking uses sense-specific Good/Wrong feedback, suppresses repeated URLs/source
pages/normalized titles, and balances sources and scenes. No ignored image is
counted as a negative label.

Pexels uses medium previews, Wikimedia requests 640-pixel thumbnails, and other
providers prefer available thumbnails. Preview loading is bounded. **Compare
images with Gemini** in the Library editor explicitly enables the optional
ambiguity-gated vision fallback. It sends at most four decoded thumbnails, each
at most 384 pixels and 128 KB, with bounded source downloads and cache memory.
Actual browser canvas resizing is verified. CORS/decode failures retain lexical
results; full originals are never substituted into the vision request. Rankings
are cached by exact sense, model, and candidate list. Other saved meanings of the
same word are supplied as contrast for this explicit comparison.

## Explicit review and evaluation

Add Word and Library expose a grid with Keep, Next image, and Skip. Keep all
proposed images is explicit confirmation; Next requires another confirmation.
Only Apply persists choices. Library merges only image fields into current words,
so newer practice answers are preserved; changed meanings or independently
changed images are skipped. Scene-cache writes may occur during preparation.

Run `node scripts/evaluate-image-picking.mjs path/to/fixtures.json` for an offline
evaluation of explicitly checked candidate IDs. The fixture format is documented
in that script. Selected/Good/Wrong labels are kept separate from ranker inputs;
unlabeled candidates are not negatives. No fixtures means zero evaluated cases
and no accuracy claim. Synthetic regression results do not establish real-world
image-picking accuracy.

The original plan's model sizes, speed, token savings, and accuracy estimates are
planning assumptions, not measurements of this implementation.

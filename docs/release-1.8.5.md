# KeepVocab 1.8.5

## Shorter explanations

Long dictionary meanings now receive an optional short practice clue when Gemini
is configured. The target is 6–14 familiar English words, with a maximum of 18
words and 160 characters. Requests batch the verbose senses and cache accepted
clues across restarts. Short meanings do not make an extra AI request.

The original English definition stays unchanged. It remains the stable sense
identity and the input for semantic evaluation and image/context generation.
Practice and meaning pickers show the shorter clue. Library retains the full
definition in an expandable section, and offers **Shorten clue** for older entries.
Clues can also be written or edited manually without a Gemini key.

Clues must be shorter than the source and cannot contain the answer or its word
forms. The prompt preserves negation, usage restrictions, and other essential
qualifiers. Malformed, duplicate, circular, or overlong results are discarded;
the app never cuts off a definition to force it under the limit. Optional AI
failure leaves a valid dictionary entry usable. Editing the full meaning clears
an untouched stale clue; an explicitly edited clue can be bound to the new meaning.
Review history, schedules, examples, translations, and canonical sense IDs remain
intact when a clue is added.

## Gemini fallback

Dictionary misses and service failures continue through Gemini when a key is
configured. The response parser now separates Gemini thought summaries from final
JSON. Explicit token truncation receives one bounded retry with a larger budget;
partial meanings are never salvaged or cached. Entry requests use a structured
schema and request concise definitions directly, avoiding a second shortening
request for normal AI-generated meanings.

Straight and curly apostrophes can describe the same phrase without triggering
the spelling-correction rejection. Invalid input, unknown/non-English terms,
unconfigured/disabled AI, cancellation, authentication errors, and quota errors
remain explicit; they do not create fabricated vocabulary or unbounded retries.

## Apple Silicon only

The Mac build command and configured targets now contain only `arm64`. A build
hook rejects Intel and universal Mac targets, including command-line overrides.
The standing preference is recorded in [AGENTS.md](../AGENTS.md). Existing Intel
outputs were removed. Rejection tests use synthetic contexts; no Intel or universal
compilation was performed for this version.

No release was published and no installed application was replaced. Older
installations whose updater requires the retired universal filename need the
Apple Silicon installer manually, as described in [App updates](updates.md).

## Validation

- **340 automated tests pass** with `npm test`.
- **13 Electron renderer checks pass** using an isolated temporary profile, fake
  provider responses, and a fake API key. Checks exercise dictionary-to-Gemini
  fallback, final JSON following thought text, translation display, automatic
  short clues, stale-clue clearing, preserved review statistics, full-definition
  expansion, practice prompts, honest unknown-word errors, Quick Add, and layouts
  at 360, 390, 768, and 1280 pixels. Screenshots were visually inspected.
- Web packaging and offline-module coverage pass; `git diff --check` passes.
- Apple Silicon DMG/ZIP build and integrity checks pass. All 79 web files and 6
  desktop files match current source; all 15 native binaries contain only arm64.
  Installed app: **247.25 MB**; DMG: **112.14 MB**; ZIP: **110.51 MB**.
- Live paid Gemini requests were not used in development verification.

Version **1.8.5**, web cache **v18500**, Android version code **34**.

The supplied image plan was reviewed separately in
[Image-picking plan review](image-picking-review.md); no model downloads were added.

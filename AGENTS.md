# macOS builds

The user's standing preference is Apple Silicon only. Build and validate macOS
artifacts for `arm64` only. Never compile Intel (`x64`) or universal macOS builds,
including verification runs, command-line overrides, or release checks. Do not
restore Intel/universal targets or scripts or disable the architecture guard.

Test rejected architectures with synthetic hook contexts; do not invoke an Intel
or universal build to test the guard. Historical universal update assets may still
be accepted by the updater without generating new universal builds.

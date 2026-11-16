#!/bin/sh
# All paths are passed as arguments by the trusted main process, never shell code.
set -eu
old_pid=$1
target=$2
staged=$3
backup=$4
opener=$5
attempt=0
while kill -0 "$old_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 120 ]; then
    echo 'KeepVocab did not quit. The existing app has been left in place.'
    exit 1
  fi
  sleep 1
done
if [ ! -d "$target" ] || [ ! -d "$staged" ] || [ -e "$backup" ]; then
  echo 'Invalid replacement paths. The existing app has been left in place.'
  exit 1
fi
if ! /bin/mv "$target" "$backup"; then
  "$opener" -n "$target"
  exit 1
fi
if ! /bin/mv "$staged" "$target"; then
  /bin/mv "$backup" "$target"
  "$opener" -n "$target"
  exit 1
fi
# Downloads move with the app, rather than being copied into a retained backup.
# A failed launch restores them with the previous bundle.
models='Contents/Resources/model-cache'
if [ -d "$backup/$models" ]; then
  if ! /bin/mv "$backup/$models" "$target/$models"; then
    /bin/mv "$target" "$staged"
    /bin/mv "$backup" "$target"
    "$opener" -n "$target" || true
    exit 1
  fi
fi
if ! "$opener" -n "$target"; then
  if [ -d "$target/$models" ]; then /bin/mv "$target/$models" "$backup/$models"; fi
  /bin/mv "$target" "$staged"
  /bin/mv "$backup" "$target"
  "$opener" -n "$target" || true
  exit 1
fi
echo 'Updated and reopened KeepVocab. Previous app retained for recovery.'

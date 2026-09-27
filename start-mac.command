#!/bin/bash
# Starts Decision Council on a Mac.
#
# How to run it: open the Terminal app, type "bash " (with a space), drag this
# file into the Terminal window, then press Return. See README.md, step 4.

cd "$(dirname "$0")" || exit 1

pause() {
  echo
  read -r -p "Press Return to finish..." _
}

# Find Python 3.10 or newer. Newer, specific versions are tried first.
PYTHON=""
for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
  path="$(command -v "$candidate" 2>/dev/null)" || continue
  # On a Mac without developer tools, /usr/bin/python3 only pops up an
  # "install developer tools" box (and is too old anyway), so skip it.
  if [ "$(uname)" = "Darwin" ] && [ "$path" = "/usr/bin/python3" ] && ! xcode-select -p >/dev/null 2>&1; then
    continue
  fi
  if "$path" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
    PYTHON="$path"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo
  echo "Python 3.10 or newer was not found on this Mac."
  echo "Install it from https://www.python.org/downloads/ (README.md, step 1),"
  echo "then run this file again."
  pause
  exit 1
fi

"$PYTHON" launch.py || pause

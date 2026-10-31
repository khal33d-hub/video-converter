#!/bin/bash
# macOS: double-click to open the Video Converter.
cd "$(dirname "$0")/app" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PY=""
for p in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c "import tkinter" >/dev/null 2>&1; then
    PY="$p"; break
  fi
done

if [ -z "$PY" ]; then
  echo
  echo "Python (with Tk) is needed to run the Video Converter."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Install it now with Homebrew? [y/N] " ans
    if [[ "$ans" =~ ^[Yy] ]]; then
      brew install python-tk && exec "$0"
    fi
  else
    echo "Install Python from https://www.python.org/downloads/ and run this again."
  fi
  read -r -p "Press Return to close."
  exit 1
fi

if ! "$PY" -c "import core,sys; sys.exit(0 if core.find_tool('ffmpeg') else 1)"; then
  echo
  echo "ffmpeg is needed to do the converting."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Install it now with Homebrew? [y/N] " ans
    [[ "$ans" =~ ^[Yy] ]] && brew install ffmpeg
  else
    echo "Install Homebrew from https://brew.sh, then run:  brew install ffmpeg"
    read -r -p "Press Return to open the app anyway."
  fi
fi

nohup "$PY" app.py >/dev/null 2>&1 &
disown
echo "Video Converter is open. You can close this window."
exit 0

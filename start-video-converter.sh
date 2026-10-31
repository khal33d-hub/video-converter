#!/bin/bash
# Linux: run this (or the desktop shortcut) to open the Video Converter.
cd "$(dirname "$(readlink -f "$0")")/app" || exit 1

PY=""
for p in python3 python3.13 python3.12 python3.11 python3.10; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c "import tkinter" >/dev/null 2>&1; then
    PY="$p"; break
  fi
done

say() {
  # Show a message in a dialog if we're not in a terminal.
  if [ -t 1 ]; then echo "$1"
  elif command -v zenity >/dev/null 2>&1; then zenity --error --text="$1"
  elif command -v notify-send >/dev/null 2>&1; then notify-send "Video Converter" "$1"
  else echo "$1" >&2; fi
}

if [ -z "$PY" ]; then
  say "Python with Tk is needed. Install it with:  sudo apt install python3 python3-tk ffmpeg"
  exit 1
fi

exec "$PY" app.py

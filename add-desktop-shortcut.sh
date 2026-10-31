#!/bin/bash
# Linux: adds "Video Converter" to your applications menu and desktop.
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
chmod +x "$HERE/start-video-converter.sh"
ENTRY="[Desktop Entry]
Type=Application
Name=Video Converter
Comment=Convert videos to other formats and GIFs
Exec=\"$HERE/start-video-converter.sh\"
Icon=$HERE/app/icon.png
Terminal=false
Categories=AudioVideo;Video;"

mkdir -p "$HOME/.local/share/applications"
echo "$ENTRY" > "$HOME/.local/share/applications/video-converter.desktop"
chmod +x "$HOME/.local/share/applications/video-converter.desktop"

DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
ON_DESKTOP=""
if [ -d "$DESKTOP" ]; then
  ON_DESKTOP=" and desktop"
  echo "$ENTRY" > "$DESKTOP/video-converter.desktop"
  chmod +x "$DESKTOP/video-converter.desktop"
  gio set "$DESKTOP/video-converter.desktop" metadata::trusted true 2>/dev/null
fi
echo "Added Video Converter to your applications menu${ON_DESKTOP}."

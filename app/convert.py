"""Command-line version of the converter, handy for scripts.

Examples:
  python convert.py clip.mov --to mp4
  python convert.py clip.mp4 --to gif --start 3 --length 4 --width 400 --fps 15
  python convert.py *.avi --to webm --quality High --out converted/
"""

from __future__ import annotations

import argparse
import sys

import core


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Convert videos to other formats or GIFs.")
    ap.add_argument("files", nargs="+", help="input video files")
    ap.add_argument("--to", dest="fmt", choices=core.FORMATS, default="mp4")
    ap.add_argument("--quality", choices=list(core.QUALITY), default="Medium")
    ap.add_argument("--width", type=int, help="resize to this width in pixels")
    ap.add_argument("--start", help="start at, e.g. 12 or 1:30")
    ap.add_argument("--length", help="how much to keep, e.g. 5 or 0:45")
    ap.add_argument("--no-audio", action="store_true", help="drop the audio track")
    ap.add_argument("--fps", type=int, default=12, help="GIF frame rate (default 12)")
    ap.add_argument("--no-loop", action="store_true", help="GIF plays once")
    ap.add_argument("--out", help="output folder (default: next to each input)")
    a = ap.parse_args(argv)

    opts = core.Options(
        fmt=a.fmt, quality=a.quality, width=a.width,
        start=core.parse_time(a.start), duration=core.parse_time(a.length),
        keep_audio=not a.no_audio, gif_fps=a.fps, gif_loop=not a.no_loop,
    )

    failed = 0
    for src in a.files:
        dst = core.output_path_for(src, opts.fmt, a.out)
        print(f"{src} -> {dst}")

        def show(frac):
            print(f"\r  {frac * 100:5.1f}%", end="", flush=True)

        try:
            core.Job(src, dst, opts).run(show)
            print("\r  done   ")
        except core.ConversionError as e:
            failed += 1
            print(f"\r  failed: {e}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

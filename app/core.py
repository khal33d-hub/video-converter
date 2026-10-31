"""Conversion engine: builds ffmpeg commands and runs them with progress.

No third-party Python packages are needed; everything is handed to ffmpeg,
which must be installed and on PATH (or next to this file).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

# Output formats offered in the app, in display order.
FORMATS = ["mp4", "webm", "mkv", "mov", "avi", "gif"]

# Extensions accepted as input (anything ffmpeg can read works; this list only
# drives the file picker filter and folder scanning).
INPUT_EXTENSIONS = {
    ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".flv",
    ".mpg", ".mpeg", ".ts", ".mts", ".m2ts", ".3gp", ".ogv", ".gif",
}

# Quality presets map to x264/VP9 CRF values (lower = better and bigger) and
# to an mpeg4 qscale for AVI (lower = better).
QUALITY = {
    "High": {"x264": 18, "vp9": 24, "mpeg4": 2},
    "Medium": {"x264": 23, "vp9": 32, "mpeg4": 4},
    "Small file": {"x264": 28, "vp9": 40, "mpeg4": 8},
}


@dataclass
class Options:
    fmt: str = "mp4"
    quality: str = "Medium"
    width: Optional[int] = None          # resize to this width, keep aspect
    start: Optional[float] = None        # seconds to skip at the start
    duration: Optional[float] = None     # seconds to keep
    keep_audio: bool = True
    gif_fps: int = 12
    gif_loop: bool = True


class ConversionError(Exception):
    pass


def _here() -> Path:
    # Works both as a script and when frozen with PyInstaller.
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


def _common_dirs() -> list[Path]:
    """Where installers put ffmpeg, for when PATH hasn't caught up yet
    (e.g. just after `winget install`, or an app launched from Finder)."""
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA", "")
        return [Path(local) / "Microsoft" / "WinGet" / "Links",
                Path(r"C:\ffmpeg\bin"), Path(r"C:\Program Files\ffmpeg\bin")]
    return [Path("/opt/homebrew/bin"), Path("/usr/local/bin"), Path("/usr/bin"),
            Path("/snap/bin")]


def find_tool(name: str) -> Optional[str]:
    """Find ffmpeg/ffprobe next to the app, on PATH, or in common places."""
    exe = name + (".exe" if os.name == "nt" else "")
    here = _here()
    for folder in (here, here / "bin", here.parent / "bin", here.parent / "ffmpeg"):
        if (folder / exe).is_file():
            return str(folder / exe)
    found = shutil.which(name)
    if found:
        return found
    for folder in _common_dirs():
        if (folder / exe).is_file():
            return str(folder / exe)
    return None


def _no_window_flags() -> int:
    # Stop a console window flashing up for every conversion on Windows.
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def probe_duration(path: str) -> Optional[float]:
    """Duration of a media file in seconds, or None if it can't be read."""
    ffprobe = find_tool("ffprobe")
    if ffprobe:
        try:
            out = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, timeout=30,
                creationflags=_no_window_flags(),
            ).stdout.strip()
            return float(out)
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
    # Fall back to parsing ffmpeg's banner.
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        return None
    try:
        err = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", path],
            capture_output=True, text=True, timeout=30,
            creationflags=_no_window_flags(),
        ).stderr
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if not m:
        return None
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


def output_path_for(src: str, fmt: str, out_dir: Optional[str] = None) -> str:
    """Pick an output path that never overwrites an existing file."""
    src_path = Path(src)
    folder = Path(out_dir) if out_dir else src_path.parent
    candidate = folder / f"{src_path.stem}.{fmt}"
    n = 1
    while candidate.exists() or candidate.resolve() == src_path.resolve():
        candidate = folder / f"{src_path.stem} ({n}).{fmt}"
        n += 1
    return str(candidate)


def _scale_filter(width: Optional[int]) -> Optional[str]:
    if not width:
        return None
    # -2 keeps the aspect ratio and an even height, which H.264 requires.
    return f"scale={int(width)}:-2:flags=lanczos"


def build_command(src: str, dst: str, opts: Options) -> list[str]:
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        raise ConversionError(
            "ffmpeg was not found. Install it and make sure it is on your PATH "
            "(see README.md)."
        )
    fmt = opts.fmt.lower()
    if fmt not in FORMATS:
        raise ConversionError(f"Unsupported output format: {fmt}")

    cmd = [ffmpeg, "-hide_banner", "-y", "-nostdin"]
    if opts.start:
        cmd += ["-ss", f"{opts.start:g}"]
    cmd += ["-i", src]
    if opts.duration:
        cmd += ["-t", f"{opts.duration:g}"]

    q = QUALITY.get(opts.quality, QUALITY["Medium"])

    if fmt == "gif":
        width = opts.width or 480
        fps = max(1, int(opts.gif_fps))
        # One pass that builds a custom palette and dithers with it: far
        # better colour than ffmpeg's default 256-colour GIF.
        graph = (
            f"[0:v]fps={fps},scale={int(width)}:-1:flags=lanczos,split[a][b];"
            "[a]palettegen=stats_mode=diff[p];"
            "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
        )
        cmd += ["-filter_complex", graph, "-loop", "0" if opts.gif_loop else "-1"]
    else:
        vf = _scale_filter(opts.width)
        if vf:
            cmd += ["-vf", vf]
        if fmt in ("mp4", "mov", "mkv"):
            cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", str(q["x264"]),
                    "-pix_fmt", "yuv420p"]
            audio = ["-c:a", "aac", "-b:a", "160k"]
            if fmt in ("mp4", "mov"):
                cmd += ["-movflags", "+faststart"]
        elif fmt == "webm":
            cmd += ["-c:v", "libvpx-vp9", "-crf", str(q["vp9"]), "-b:v", "0",
                    "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"]
            audio = ["-c:a", "libopus", "-b:a", "128k"]
        else:  # avi
            cmd += ["-c:v", "mpeg4", "-q:v", str(q["mpeg4"]), "-tag:v", "XVID"]
            audio = ["-c:a", "libmp3lame", "-q:a", "3"]
        # Map the first video stream and, optionally, the first audio stream
        # if one exists ("?" makes it optional).
        cmd += ["-map", "0:v:0"]
        if opts.keep_audio:
            cmd += ["-map", "0:a:0?"] + audio
        else:
            cmd += ["-an"]

    cmd += ["-progress", "pipe:1", "-nostats", dst]
    return cmd


ProgressFn = Callable[[float], None]


class Job:
    """A single running conversion that can be cancelled from another thread."""

    def __init__(self, src: str, dst: str, opts: Options):
        self.src, self.dst, self.opts = src, dst, opts
        self._proc: Optional[subprocess.Popen] = None
        self.cancelled = False

    def cancel(self) -> None:
        self.cancelled = True
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()

    def run(self, on_progress: Optional[ProgressFn] = None) -> str:
        if not os.path.isfile(self.src):
            raise ConversionError(f"File not found: {self.src}")
        cmd = build_command(self.src, self.dst, self.opts)

        total = probe_duration(self.src)
        if total is not None:
            if self.opts.start:
                total = max(0.0, total - self.opts.start)
            if self.opts.duration:
                total = min(total, self.opts.duration)

        Path(self.dst).parent.mkdir(parents=True, exist_ok=True)
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, errors="replace", creationflags=_no_window_flags(),
        )

        # Read stderr on a side thread so a chatty ffmpeg can't fill the pipe
        # and deadlock while we read progress from stdout.
        err_lines: list[str] = []
        t = threading.Thread(
            target=lambda: err_lines.extend(self._proc.stderr), daemon=True
        )
        t.start()

        assert self._proc.stdout is not None
        for line in self._proc.stdout:
            key, _, val = line.strip().partition("=")
            # out_time_us (and, confusingly, out_time_ms) are microseconds.
            if key in ("out_time_us", "out_time_ms") and total:
                try:
                    secs = int(val) / 1_000_000
                except ValueError:
                    continue
                if on_progress:
                    on_progress(min(1.0, max(0.0, secs / total)))
            elif key == "progress" and val == "end" and on_progress:
                on_progress(1.0)

        code = self._proc.wait()
        t.join(timeout=5)

        if self.cancelled:
            _remove_quietly(self.dst)
            raise ConversionError("Cancelled")
        if code != 0:
            _remove_quietly(self.dst)
            tail = "".join(err_lines[-12:]).strip() or f"ffmpeg exited with code {code}"
            raise ConversionError(tail)
        return self.dst


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def parse_time(text: str) -> Optional[float]:
    """Accept '90', '1:30', '00:01:30.5' or '' (meaning not set)."""
    text = (text or "").strip()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) > 3:
        raise ValueError(f"Can't read time '{text}'")
    secs = 0.0
    for p in parts:
        secs = secs * 60 + float(p)
    if secs < 0:
        raise ValueError(f"Time can't be negative: '{text}'")
    return secs

"""Video & GIF Converter: a small desktop app around ffmpeg.

Run with:  python app.py
"""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
from pathlib import Path
from tkinter import filedialog, messagebox
import tkinter as tk
from tkinter import ttk

import core

# Drag and drop is optional: it needs `pip install tkinterdnd2`.
try:
    from tkinterdnd2 import DND_FILES, TkinterDnD  # type: ignore
    _Root = TkinterDnD.Tk
    HAS_DND = True
except ImportError:
    _Root = tk.Tk
    HAS_DND = False


if sys.platform == "win32":
    FFMPEG_HINT = ("Close this app and double-click 'Start Video Converter.bat' "
                   "again: it offers to install ffmpeg for you.")
elif sys.platform == "darwin":
    FFMPEG_HINT = "Install it from Terminal with:  brew install ffmpeg"
else:
    FFMPEG_HINT = "Install it from a terminal with:  sudo apt install ffmpeg"


class App(_Root):
    def __init__(self) -> None:
        super().__init__()
        self.title("Video & GIF Converter")
        try:
            self._icon = tk.PhotoImage(file=str(Path(__file__).with_name("icon.png")))
            self.iconphoto(True, self._icon)
        except tk.TclError:
            pass
        self.minsize(760, 680)
        self.geometry("860x740")

        self.files: dict[str, str] = {}      # tree item id -> source path
        self.events: queue.Queue = queue.Queue()
        self.worker: threading.Thread | None = None
        self.job: core.Job | None = None
        self.stop_requested = False
        self.last_output_dir: str | None = None

        self._build_ui()
        self._on_format_change()
        self.after(100, self._drain_events)

        if not core.find_tool("ffmpeg"):
            self.after(200, lambda: messagebox.showwarning(
                "ffmpeg not found",
                "This app needs ffmpeg to convert files, but it isn't installed "
                "or couldn't be found.\n\n" + FFMPEG_HINT,
            ))

    # ---------- layout ----------

    def _build_ui(self) -> None:
        pad = {"padx": 10, "pady": 6}
        style = ttk.Style(self)
        if "clam" in style.theme_names() and sys.platform.startswith("linux"):
            style.theme_use("clam")
        style.configure("Big.TButton", padding=(16, 8))
        style.configure("Horizontal.TProgressbar", background="#2f7de1", thickness=14)

        # Files
        files = ttk.LabelFrame(self, text="Files")
        files.pack(fill="both", expand=True, **pad)

        cols = ("name", "status")
        self.tree = ttk.Treeview(files, columns=cols, show="headings", height=6,
                                 selectmode="extended")
        self.tree.heading("name", text="File")
        self.tree.heading("status", text="Status")
        self.tree.column("name", width=520, anchor="w")
        self.tree.column("status", width=160, anchor="w")
        scroll = ttk.Scrollbar(files, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew", padx=(8, 0), pady=8)
        scroll.grid(row=0, column=1, sticky="ns", pady=8, padx=(0, 8))
        files.rowconfigure(0, weight=1)
        files.columnconfigure(0, weight=1)

        btns = ttk.Frame(files)
        btns.grid(row=1, column=0, columnspan=2, sticky="w", padx=8, pady=(0, 8))
        ttk.Button(btns, text="Add files…", command=self.add_files).pack(side="left")
        ttk.Button(btns, text="Add folder…", command=self.add_folder).pack(side="left", padx=6)
        ttk.Button(btns, text="Remove", command=self.remove_selected).pack(side="left")
        ttk.Button(btns, text="Clear", command=self.clear_files).pack(side="left", padx=6)
        hint = "Tip: drag files onto the list" if HAS_DND else ""
        ttk.Label(btns, text=hint, foreground="grey").pack(side="left", padx=10)

        if HAS_DND:
            self.tree.drop_target_register(DND_FILES)
            self.tree.dnd_bind("<<Drop>>", self._on_drop)
        self.tree.bind("<Delete>", lambda _e: self.remove_selected())

        # Options
        opts = ttk.LabelFrame(self, text="Convert to")
        opts.pack(fill="x", **pad)
        for c in range(6):
            opts.columnconfigure(c, weight=1 if c % 2 else 0)

        self.fmt = tk.StringVar(value="mp4")
        self.quality = tk.StringVar(value="Medium")
        self.width = tk.StringVar()
        self.start = tk.StringVar()
        self.duration = tk.StringVar()
        self.keep_audio = tk.BooleanVar(value=True)
        self.gif_fps = tk.StringVar(value="12")
        self.gif_loop = tk.BooleanVar(value=True)

        def label(text, r, c):
            ttk.Label(opts, text=text).grid(row=r, column=c, sticky="w", padx=(8, 4), pady=5)

        label("Format", 0, 0)
        fmt_box = ttk.Combobox(opts, textvariable=self.fmt, values=core.FORMATS,
                               state="readonly", width=10)
        fmt_box.grid(row=0, column=1, sticky="w", pady=5)
        fmt_box.bind("<<ComboboxSelected>>", lambda _e: self._on_format_change())

        label("Quality", 0, 2)
        self.quality_box = ttk.Combobox(opts, textvariable=self.quality,
                                        values=list(core.QUALITY), state="readonly", width=12)
        self.quality_box.grid(row=0, column=3, sticky="w", pady=5)

        label("Width (px)", 0, 4)
        ttk.Entry(opts, textvariable=self.width, width=10).grid(row=0, column=5, sticky="w", pady=5)

        label("Start at", 1, 0)
        ttk.Entry(opts, textvariable=self.start, width=12).grid(row=1, column=1, sticky="w", pady=5)
        label("Length", 1, 2)
        ttk.Entry(opts, textvariable=self.duration, width=12).grid(row=1, column=3, sticky="w", pady=5)
        self.audio_chk = ttk.Checkbutton(opts, text="Keep audio", variable=self.keep_audio)
        self.audio_chk.grid(row=1, column=4, columnspan=2, sticky="w", padx=8)

        label("GIF frame rate", 2, 0)
        self.fps_spin = ttk.Spinbox(opts, from_=1, to=50, textvariable=self.gif_fps, width=6)
        self.fps_spin.grid(row=2, column=1, sticky="w", pady=5)
        self.loop_chk = ttk.Checkbutton(opts, text="Loop forever", variable=self.gif_loop)
        self.loop_chk.grid(row=2, column=2, columnspan=2, sticky="w", padx=8)

        self.help_lbl = ttk.Label(opts, foreground="grey", wraplength=740, justify="left")
        self.help_lbl.grid(row=3, column=0, columnspan=6, sticky="w", padx=8, pady=(0, 8))

        # Output folder
        out = ttk.LabelFrame(self, text="Save to")
        out.pack(fill="x", **pad)
        self.same_folder = tk.BooleanVar(value=True)
        self.out_dir = tk.StringVar()
        ttk.Radiobutton(out, text="Same folder as each file", value=True,
                        variable=self.same_folder,
                        command=self._on_out_mode).grid(row=0, column=0, sticky="w", padx=8, pady=5)
        ttk.Radiobutton(out, text="This folder:", value=False,
                        variable=self.same_folder,
                        command=self._on_out_mode).grid(row=1, column=0, sticky="w", padx=8, pady=5)
        self.out_entry = ttk.Entry(out, textvariable=self.out_dir)
        self.out_entry.grid(row=1, column=1, sticky="ew", pady=5)
        self.out_btn = ttk.Button(out, text="Browse…", command=self.pick_out_dir)
        self.out_btn.grid(row=1, column=2, padx=8, pady=5)
        out.columnconfigure(1, weight=1)
        self._on_out_mode()

        # Progress + actions
        bottom = ttk.Frame(self)
        bottom.pack(fill="x", **pad)
        self.status = tk.StringVar(value="Add some files to get started.")
        ttk.Label(bottom, textvariable=self.status).pack(anchor="w")
        self.progress = ttk.Progressbar(bottom, mode="determinate", maximum=100)
        self.progress.pack(fill="x", pady=6)

        actions = ttk.Frame(bottom)
        actions.pack(fill="x")
        self.convert_btn = ttk.Button(actions, text="Convert", style="Big.TButton",
                                      command=self.start_conversion)
        self.convert_btn.pack(side="right")
        self.cancel_btn = ttk.Button(actions, text="Cancel", command=self.cancel,
                                     state="disabled")
        self.cancel_btn.pack(side="right", padx=6)
        self.open_btn = ttk.Button(actions, text="Open output folder",
                                   command=self.open_output, state="disabled")
        self.open_btn.pack(side="left")

    # ---------- option helpers ----------

    def _on_format_change(self) -> None:
        is_gif = self.fmt.get() == "gif"
        self.fps_spin.configure(state="normal" if is_gif else "disabled")
        self.loop_chk.configure(state="normal" if is_gif else "disabled")
        self.audio_chk.configure(state="disabled" if is_gif else "normal")
        self.quality_box.configure(state="disabled" if is_gif else "readonly")
        if is_gif:
            self.help_lbl.configure(text=(
                "GIFs get big quickly: keep them short (set a Length such as 5) "
                "and narrow (Width defaults to 480). Times can be seconds (90) "
                "or minutes:seconds (1:30)."))
        else:
            self.help_lbl.configure(text=(
                "Leave Width, Start at and Length empty to keep the original size "
                "and the whole video. Times can be seconds (90) or minutes:seconds (1:30)."))

    def _on_out_mode(self) -> None:
        state = "disabled" if self.same_folder.get() else "normal"
        self.out_entry.configure(state=state)
        self.out_btn.configure(state=state)

    def _read_options(self) -> core.Options:
        width_txt = self.width.get().strip()
        width = None
        if width_txt:
            if not width_txt.isdigit() or int(width_txt) < 16:
                raise ValueError("Width must be a whole number of pixels (16 or more).")
            width = int(width_txt)
        try:
            fps = int(self.gif_fps.get())
        except ValueError:
            raise ValueError("GIF frame rate must be a whole number.")
        if not 1 <= fps <= 50:
            raise ValueError("GIF frame rate must be between 1 and 50.")
        start = core.parse_time(self.start.get())
        duration = core.parse_time(self.duration.get())
        if duration is not None and duration <= 0:
            raise ValueError("Length must be more than zero.")
        return core.Options(
            fmt=self.fmt.get(), quality=self.quality.get(), width=width,
            start=start, duration=duration, keep_audio=self.keep_audio.get(),
            gif_fps=fps, gif_loop=self.gif_loop.get(),
        )

    # ---------- file list ----------

    def _add_paths(self, paths) -> None:
        existing = set(self.files.values())
        for p in paths:
            p = os.path.abspath(p)
            if os.path.isdir(p):
                self._add_paths(sorted(
                    str(f) for f in Path(p).iterdir()
                    if f.is_file() and f.suffix.lower() in core.INPUT_EXTENSIONS
                ))
                continue
            if not os.path.isfile(p) or p in existing:
                continue
            iid = self.tree.insert("", "end", values=(p, "Ready"))
            self.files[iid] = p
            existing.add(p)
        self._update_idle_status()

    def add_files(self) -> None:
        pattern = " ".join(f"*{e}" for e in sorted(core.INPUT_EXTENSIONS))
        paths = filedialog.askopenfilenames(
            title="Choose videos",
            filetypes=[("Video files", pattern), ("All files", "*.*")],
        )
        self._add_paths(paths)

    def add_folder(self) -> None:
        folder = filedialog.askdirectory(title="Choose a folder of videos")
        if folder:
            self._add_paths([folder])

    def _on_drop(self, event) -> None:
        self._add_paths(self.tk.splitlist(event.data))

    def remove_selected(self) -> None:
        if self._busy():
            return
        for iid in self.tree.selection():
            self.tree.delete(iid)
            self.files.pop(iid, None)
        self._update_idle_status()

    def clear_files(self) -> None:
        if self._busy():
            return
        self.tree.delete(*self.tree.get_children())
        self.files.clear()
        self._update_idle_status()

    def pick_out_dir(self) -> None:
        folder = filedialog.askdirectory(title="Save converted files to")
        if folder:
            self.out_dir.set(folder)

    def _update_idle_status(self) -> None:
        if self._busy():
            return
        n = len(self.files)
        self.status.set("Add some files to get started." if n == 0
                        else f"{n} file{'s' if n != 1 else ''} ready.")

    # ---------- conversion ----------

    def _busy(self) -> bool:
        return self.worker is not None and self.worker.is_alive()

    def start_conversion(self) -> None:
        if self._busy():
            return
        if not self.files:
            messagebox.showinfo("Nothing to convert", "Add one or more files first.")
            return
        if not core.find_tool("ffmpeg"):
            messagebox.showerror("ffmpeg not found",
                                 FFMPEG_HINT)
            return
        try:
            opts = self._read_options()
        except ValueError as e:
            messagebox.showerror("Check your settings", str(e))
            return

        out_dir = None
        if not self.same_folder.get():
            out_dir = self.out_dir.get().strip()
            if not out_dir:
                messagebox.showerror("Choose a folder", "Pick a folder to save to, "
                                     "or choose 'Same folder as each file'.")
                return

        items = list(self.tree.get_children())
        for iid in items:
            self.tree.set(iid, "status", "Waiting")
        self.stop_requested = False
        self.convert_btn.configure(state="disabled")
        self.cancel_btn.configure(state="normal")
        self.open_btn.configure(state="disabled")
        self.progress["value"] = 0

        jobs = [(iid, self.files[iid]) for iid in items]
        self.worker = threading.Thread(target=self._run_all, args=(jobs, opts, out_dir),
                                       daemon=True)
        self.worker.start()

    def _run_all(self, jobs, opts: core.Options, out_dir) -> None:
        done = failed = 0
        total = len(jobs)
        for i, (iid, src) in enumerate(jobs):
            if self.stop_requested:
                self.events.put(("row", iid, "Skipped"))
                continue
            dst = core.output_path_for(src, opts.fmt, out_dir)
            self.events.put(("row", iid, "Converting…"))
            self.events.put(("status", f"Converting {i + 1} of {total}: {Path(src).name}"))
            self.job = core.Job(src, dst, opts)

            def on_progress(frac, iid=iid, i=i):
                self.events.put(("row", iid, f"{frac * 100:.0f}%"))
                self.events.put(("progress", (i + frac) / total * 100))

            try:
                self.job.run(on_progress)
                done += 1
                self.last_output_dir = str(Path(dst).parent)
                self.events.put(("row", iid, f"Done → {Path(dst).name}"))
            except core.ConversionError as e:
                if self.stop_requested:
                    self.events.put(("row", iid, "Cancelled"))
                else:
                    failed += 1
                    self.events.put(("row", iid, "Failed"))
                    self.events.put(("error", Path(src).name, str(e)))
            self.events.put(("progress", (i + 1) / total * 100))
        self.job = None
        self.events.put(("finished", done, failed))

    def cancel(self) -> None:
        self.stop_requested = True
        if self.job:
            self.job.cancel()
        self.status.set("Cancelling…")

    def _drain_events(self) -> None:
        try:
            while True:
                ev = self.events.get_nowait()
                kind = ev[0]
                if kind == "row" and self.tree.exists(ev[1]):
                    self.tree.set(ev[1], "status", ev[2])
                elif kind == "status":
                    self.status.set(ev[1])
                elif kind == "progress":
                    self.progress["value"] = ev[1]
                elif kind == "error":
                    messagebox.showerror(f"Couldn't convert {ev[1]}", ev[2][-1500:])
                elif kind == "finished":
                    _, done, failed = ev
                    msg = f"Finished: {done} converted"
                    if failed:
                        msg += f", {failed} failed"
                    if self.stop_requested:
                        msg += " (cancelled)"
                    self.status.set(msg + ".")
                    self.convert_btn.configure(state="normal")
                    self.cancel_btn.configure(state="disabled")
                    if self.last_output_dir:
                        self.open_btn.configure(state="normal")
        except queue.Empty:
            pass
        self.after(100, self._drain_events)

    def open_output(self) -> None:
        folder = self.last_output_dir
        if not folder:
            return
        if sys.platform == "win32":
            os.startfile(folder)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])


if __name__ == "__main__":
    App().mainloop()

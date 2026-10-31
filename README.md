# Video Converter

A desktop app for converting videos from one format to another, or turning them into GIFs. It runs on your own computer (Windows, macOS or Linux), and nothing is uploaded anywhere.

- **Outputs:** MP4, WebM, MKV, MOV, AVI and GIF
- **Inputs:** almost anything: MP4, MOV, MKV, WebM, AVI, WMV, FLV, MPEG, TS, 3GP, GIF…
- Convert lots of files at once (add files or a whole folder)
- Quality presets (High, Medium, Small file), resize by width, and trim with **Start at** and **Length**
- GIFs use a custom colour palette for each clip, so they look far better than a basic conversion; choose the frame rate and whether they loop
- Live progress, Cancel, and an **Open output folder** button
- It never overwrites a file: if `clip.mp4` already exists you get `clip (1).mp4`

## Put it on your computer

Keep this whole folder together, somewhere permanent such as your Documents folder, then follow the steps for your system. The first time, the launcher checks for the two free things the app needs (**Python** and **ffmpeg**) and offers to install anything that's missing.

### Windows

1. Double-click **`Start Video Converter.bat`**.
   - If Windows says "Windows protected your PC", click **More info**, then **Run anyway**.
   - If it offers to install Python or ffmpeg, press **Y**. After installing Python, double-click the launcher again.
2. For a desktop icon, double-click **`Add Desktop Shortcut (Windows).bat`** once. From then on, open the app from the **Video Converter** icon on your desktop. You can also right-click that icon and choose **Pin to Start** or **Pin to taskbar**.

### macOS

1. Right-click **`Start Video Converter.command`** and choose **Open**, then **Open** again. You only need to right-click the first time, because macOS checks files downloaded from the internet. After that, a double-click is enough.
   - The launcher uses [Homebrew](https://brew.sh) to install Python and ffmpeg if they're missing. If you don't have Homebrew, install it first.
2. For a Dock icon: once the app is open, right-click its icon in the Dock and choose **Options › Keep in Dock**. Or drag `Start Video Converter.command` into the right-hand side of the Dock.

### Linux

1. Install what it needs (Debian/Ubuntu):

   ```bash
   sudo apt install python3 python3-tk ffmpeg
   ```

2. Run `add-desktop-shortcut.sh` once. **Video Converter** then appears in your applications menu and on your desktop. You can also start it directly with `start-video-converter.sh`.

### If ffmpeg can't be installed

Download ffmpeg yourself and put `ffmpeg` and `ffprobe` (`ffmpeg.exe` and `ffprobe.exe` on Windows) in a folder called `bin` inside this folder. The app looks there first.

### Optional: drag and drop

To drop files straight onto the list, run this once:

```bash
pip install tkinterdnd2
```

## Using it

1. **Add files…** (or **Add folder…**)
2. Pick a **Format** and, if you like, quality, width, start and length
3. Choose where to save
4. Click **Convert**

**Tips for GIFs.** GIFs get large fast. Keep them short (a **Length** of 3 to 6 seconds) and narrow (**Width** 320 to 480; it defaults to 480). A frame rate of 10 to 15 is smooth enough for most clips. Times can be typed as seconds (`90`) or minutes:seconds (`1:30`).

### Which format should I pick?

| Format | Good for | Video / audio |
|---|---|---|
| MP4 | Plays almost everywhere: phones, web, WhatsApp, editors | H.264 / AAC |
| WebM | Websites; smaller files at the same quality, slower to make | VP9 / Opus |
| MKV | Archiving; holds lots of tracks | H.264 / AAC |
| MOV | Apple apps (iMovie, Final Cut, QuickTime) | H.264 / AAC |
| AVI | Old players and devices | MPEG-4 (Xvid) / MP3 |
| GIF | Short silent loops for chats, docs and READMEs | GIF, no audio |

## Command line (optional)

The same engine works from a terminal, which is handy for scripts:

```bash
python app/convert.py holiday.mov --to mp4
```

```bash
python app/convert.py clip.mp4 --to gif --start 3 --length 4 --width 400 --fps 15
```

```bash
python app/convert.py *.avi --to webm --quality High --out converted
```

Run `python app/convert.py --help` for every option.

## What's in this folder

| File | What it does |
|---|---|
| `Start Video Converter.bat` | Opens the app on Windows |
| `Add Desktop Shortcut (Windows).bat` | Adds a desktop icon on Windows |
| `Start Video Converter.command` | Opens the app on macOS |
| `start-video-converter.sh` | Opens the app on Linux |
| `add-desktop-shortcut.sh` | Adds it to the Linux applications menu and desktop |
| `app/app.py` | The app window |
| `app/core.py` | Builds the ffmpeg commands and tracks progress |
| `app/convert.py` | Command-line version |
| `app/icon.png`, `app/icon.ico` | App icon |

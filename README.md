# Video Converter

A Windows desktop app for converting videos to MP4, WebM, MKV, MOV, AVI or GIF. Everything happens on your computer, and ffmpeg is built in, so there's nothing else to install.

## Download

Get **Video-Converter-Setup.exe** from the [Releases page](../../releases/latest) and run it. It adds Video Converter to your desktop and Start menu.

If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. This appears because the app isn't signed with a paid certificate.

## Using it

1. Drag videos onto the window, or click **Add videos**.
2. Pick a format.
3. Optionally change the quality, size or trim.
4. Click **Convert**.

## The code

| Path | What it does |
|---|---|
| `main.js` | Opens the window and runs conversions |
| `preload.js` | Connects the window to the rest of the app |
| `src/ffmpeg.js` | Reads videos, makes thumbnails and runs ffmpeg |
| `renderer/` | The interface |
| `assets/icon.png` | App icon |

To run it from the code, install [Node.js](https://nodejs.org/) and run these in this folder:

```bash
npm install
```

```bash
npm start
```

Every push to `main` builds a new `Video-Converter-Setup.exe` and puts it on the Releases page. To publish a new version, change `version` in `package.json` first.

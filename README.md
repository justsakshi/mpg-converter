# MPG → MP4 Batch Converter

A web app that lets you upload a folder of `.mpg` files and download them all converted to `.mp4` in a ZIP.

Built with Node.js + Express + FFmpeg. Deploy-ready for Render.

---

## Deploy to Render (free tier)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "init: mpg to mp4 converter"
gh repo create mpg-converter --public --push --source=.
```

Or create a repo manually on github.com and push.

### 2. Deploy on Render

1. Go to [render.com](https://render.com) and sign in
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml` — click **Create Web Service**
5. Wait ~3 minutes for the first deploy (it installs FFmpeg)
6. Your URL will be: `https://mpg-to-mp4-converter.onrender.com`

---

## Run locally

```bash
# Install FFmpeg (macOS)
brew install ffmpeg

# Install FFmpeg (Ubuntu/Debian)
sudo apt-get install ffmpeg

# Install dependencies
npm install

# Start server
npm start
# → http://localhost:3000
```

---

## How it works

1. Select or drag-drop multiple `.mpg` files
2. Files upload to the server
3. FFmpeg converts each file to H.264/AAC MP4 sequentially
4. Progress bar updates via polling
5. Download a `.zip` containing all converted files
6. Files are deleted from the server after download

## Notes

- Render free tier sleeps after 15 min of inactivity (first request takes ~30s to wake)
- For large files or heavy use, upgrade to Render Starter ($7/mo) for always-on
- Max upload size is not set by default — add `multer` limits if needed

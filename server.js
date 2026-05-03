const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");
const archiver = require("archiver");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

console.log("FFmpeg path:", ffmpegStatic);
console.log("FFprobe path:", ffprobeStatic.path);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const jobs = {};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = req.jobId;
    const dir = path.join(__dirname, "uploads", jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".mpg", ".mpeg", ".mpe", ".m1v", ".m2v"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Skipping non-MPG file: ${file.originalname}`));
    }
  },
});

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/upload", (req, res, next) => {
  req.jobId = uuidv4();
  next();
}, (req, res, next) => {
  upload.array("files")(req, res, () => next());
}, async (req, res) => {
  try {
    const jobId = req.jobId;
    const files = req.files || [];

    if (!files.length) {
      return res.status(400).json({ error: "No valid MPG files uploaded." });
    }

    const outputDir = path.join(__dirname, "outputs", jobId);
    fs.mkdirSync(outputDir, { recursive: true });

    jobs[jobId] = { total: files.length, done: 0, errors: [], status: "processing" };

    res.json({ jobId, total: files.length });

    for (const file of files) {
      const inputPath = file.path;
      const baseName = path.basename(file.originalname, path.extname(file.originalname));
      const outputPath = path.join(outputDir, `${baseName}.mp4`);

      await new Promise((resolve) => {
        ffmpeg(inputPath)
          .outputOptions(["-c:v libx264", "-preset fast", "-crf 22", "-c:a aac", "-b:a 128k", "-movflags +faststart"])
          .save(outputPath)
          .on("end", () => { jobs[jobId].done++; resolve(); })
          .on("error", (err) => {
            console.error(`FFmpeg error on ${file.originalname}:`, err.message);
            jobs[jobId].errors.push({ file: file.originalname, error: err.message });
            jobs[jobId].done++;
            resolve();
          });
      });
    }

    jobs[jobId].status = "done";
    fs.rmSync(path.join(__dirname, "uploads", jobId), { recursive: true, force: true });

  } catch (err) {
    console.error("Upload handler error:", err);
    // res already sent, just log
  }
});

app.get("/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/download/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs[jobId];
  if (!job || job.status !== "done") {
    return res.status(400).json({ error: "Job not ready or not found." });
  }

  const outputDir = path.join(__dirname, "outputs", jobId);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="converted_${jobId.slice(0, 8)}.zip"`);

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(res);
  archive.directory(outputDir, false);
  archive.finalize();

  archive.on("end", () => {
    setTimeout(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
      delete jobs[jobId];
    }, 5000);
  });
});

// Global error handler — always return JSON, never HTML
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`MPG Converter running on port ${PORT}`);
});
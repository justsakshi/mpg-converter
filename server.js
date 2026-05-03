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

// Increase payload limits
app.use(express.json({ limit: "10mb" }));
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

const upload = multer({ storage });

app.get("/health", (req, res) => res.json({ ok: true, ffmpeg: ffmpegStatic }));

// Step 1: Upload files, get a jobId back immediately
app.post("/upload", (req, res, next) => {
  req.jobId = uuidv4();
  next();
}, (req, res, next) => {
  upload.array("files")(req, res, () => next());
}, (req, res) => {
  const jobId = req.jobId;
  const files = (req.files || []).filter(f =>
    [".mpg", ".mpeg", ".mpe", ".m1v", ".m2v"].includes(path.extname(f.originalname).toLowerCase())
  );

  if (!files.length) {
    return res.status(400).json({ error: "No valid MPG files found in upload." });
  }

  const outputDir = path.join(__dirname, "outputs", jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  jobs[jobId] = { total: files.length, done: 0, errors: [], status: "processing", log: [] };

  // Respond immediately — client starts polling
  res.json({ jobId, total: files.length });

  // Convert in background — completely detached from the request
  setImmediate(() => convertFiles(jobId, files, outputDir));
});

async function convertFiles(jobId, files, outputDir) {
  for (const file of files) {
    const inputPath = file.path;
    const baseName = path.basename(file.originalname, path.extname(file.originalname));
    const outputPath = path.join(outputDir, `${baseName}.mp4`);

    console.log(`[${jobId}] Converting: ${file.originalname}`);

    await new Promise((resolve) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-c:v libx264",
          "-preset ultrafast",  // fastest preset — key for free tier
          "-crf 28",            // slightly lower quality = much faster
          "-c:a aac",
          "-b:a 96k",
          "-movflags +faststart",
        ])
        .save(outputPath)
        .on("progress", (p) => {
          if (p.percent) {
            console.log(`[${jobId}] ${file.originalname}: ${Math.round(p.percent)}%`);
          }
        })
        .on("end", () => {
          console.log(`[${jobId}] Done: ${file.originalname}`);
          jobs[jobId].done++;
          jobs[jobId].log.push({ file: file.originalname, status: "done" });
          resolve();
        })
        .on("error", (err) => {
          console.error(`[${jobId}] Error on ${file.originalname}:`, err.message);
          jobs[jobId].errors.push({ file: file.originalname, error: err.message });
          jobs[jobId].done++;
          jobs[jobId].log.push({ file: file.originalname, status: "error", error: err.message });
          resolve();
        });
    });

    // Clean up input file as we go
    try { fs.unlinkSync(inputPath); } catch (_) {}
  }

  jobs[jobId].status = "done";
  console.log(`[${jobId}] All done. ${jobs[jobId].errors.length} errors.`);

  // Clean up uploads folder
  try {
    const uploadDir = path.join(__dirname, "uploads", jobId);
    if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });
  } catch (_) {}
}

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

  const archive = archiver("zip", { zlib: { level: 3 } });
  archive.pipe(res);
  archive.directory(outputDir, false);
  archive.finalize();

  archive.on("end", () => {
    setTimeout(() => {
      try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (_) {}
      delete jobs[jobId];
    }, 10000);
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`MPG Converter running on port ${PORT}`);
});
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveImages } from "./resolveImages.js";
import { writeTextFiles } from "./writeTextFiles.js";
import { buildFilterGraph } from "./buildFilterGraph.js";
import { generateGeminiVoiceover } from "./geminiVoiceover.js";
import { formatPriceLine, formatBedroomsLine, formatMetaLine, formatContactLine } from "./loadConfig.js";

/**
 * Renders one property video.
 *
 * @param {object} baseCfg   output of loadBaseConfig() — brand/video constants.
 *                            baseCfg.musicPath (local file or null) should
 *                            already be resolved once by the caller, since
 *                            it's shared across a whole batch run.
 * @param {object} property  { outputName, location, priceKes, priceUsd, bedrooms, images, contactNumber? }
 * @param {object} opts      { tmpRoot, outputDir }
 */
export async function renderVideo(baseCfg, property, opts) {
  const { outputName, location, priceKes, priceUsd, bedrooms, images, contactNumber, description } = property;
  if (!outputName) throw new Error("Property is missing outputName.");

  const runTmpDir = path.join(opts.tmpRoot, outputName);
  fs.rmSync(runTmpDir, { recursive: true, force: true });
  fs.mkdirSync(runTmpDir, { recursive: true });

  console.log(`\n▶ ${outputName}`);
  console.log(`  downloading ${images.length} image(s)...`);
  const imagePaths = await resolveImages(images, path.join(runTmpDir, "images"));
  const voiceoverPath = await generateGeminiVoiceover(baseCfg, imagePaths, property, runTmpDir);
  const resolvedDescription = description || (voiceoverPath ? fs.readFileSync(path.join(runTmpDir, "text", "voiceover.txt"), "utf8") : "");

  const bedroomsLine = formatBedroomsLine(bedrooms);
  const textFiles = writeTextFiles(path.join(runTmpDir, "text"), {
    brand: baseCfg.brandName,
    location: location || "",
    bedrooms: bedroomsLine,
    meta: formatMetaLine(bedroomsLine, location || ""),
    price: formatPriceLine(priceKes),
    contact: formatContactLine(contactNumber || baseCfg.contactNumber),
    city: baseCfg.cityLine,
    description: resolvedDescription,
  });

  const { inputArgs, filterComplex, totalDuration, hasLogo, imageInputCount } = buildFilterGraph(
    imagePaths,
    baseCfg,
    textFiles
  );

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const outputPath = path.join(opts.outputDir, `${outputName}.mp4`);

  const args = ["-y", ...inputArgs];

  // Background music (optional, shared across the whole batch run).
  // -stream_loop -1 loops the track indefinitely so it always covers
  // the full video regardless of the source clip's length; the output
  // -t below then trims everything — video and audio — to size.
  let musicIndex = null;
  if (baseCfg.musicPath) {
    musicIndex = imageInputCount + (hasLogo ? 1 : 0);
    args.push("-stream_loop", "-1", "-i", baseCfg.musicPath);
  }

  let voiceoverIndex = null;
  if (voiceoverPath) {
    voiceoverIndex = imageInputCount + (hasLogo ? 1 : 0) + (musicIndex !== null ? 1 : 0);
    args.push("-i", voiceoverPath);
  }

  let finalFilterComplex = filterComplex;
  if (musicIndex !== null && voiceoverIndex !== null) {
    finalFilterComplex +=
      `;[${musicIndex}:a]volume=0.18[music];[${voiceoverIndex}:a]volume=1.4[voice];` +
      "[music][voice]amix=inputs=2:duration=longest:dropout_transition=2[aout]";
  }

  args.push("-filter_complex", finalFilterComplex, "-map", "[vout]");

  if (voiceoverIndex !== null) {
    args.push(
      "-map",
      musicIndex !== null ? "[aout]" : `${voiceoverIndex}:a`,
      "-c:a",
      "aac",
      "-b:a",
      "128k"
    );
  } else if (musicIndex !== null) {
    const fadeStart = Math.max(0, totalDuration - 1.2);
    args.push("-map", `${musicIndex}:a`, "-af", `afade=t=out:st=${fadeStart.toFixed(3)}:d=1.2`, "-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }

  args.push(
    "-r",
    String(baseCfg.fps),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    totalDuration.toFixed(3),
    outputPath
  );

  console.log(`  rendering (${totalDuration.toFixed(1)}s, ${baseCfg.width}x${baseCfg.height})...`);
  await runFfmpeg(args);
  console.log(`  ✔ ${outputPath}`);

  return outputPath;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
    proc.on("error", reject);
  });
}
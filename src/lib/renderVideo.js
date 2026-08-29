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
 * @param {object} property  { outputName, location, priceKes, priceUsd, bedrooms, sqm, images, contactNumber? }
 * @param {object} opts      { tmpRoot, outputDir }
 */
export async function renderVideo(baseCfg, property, opts) {
  const { outputName, location, priceKes, priceUsd, bedrooms, sqm, images, contactNumber, description } = property;
  if (!outputName) throw new Error("Property is missing outputName.");

  const runTmpDir = path.join(opts.tmpRoot, outputName);
  fs.rmSync(runTmpDir, { recursive: true, force: true });
  fs.mkdirSync(runTmpDir, { recursive: true });

  console.log(`\n▶ ${outputName}`);
  console.log(`  downloading ${images.length} image(s)...`);
  const imagePaths = await resolveImages(images, path.join(runTmpDir, "images"));

  // One narration sentence + TTS clip per image (or null if voiceover is
  // disabled/fails), so each image's on-screen time can be paced to match
  // what's actually being said about it — see generateGeminiVoiceover.js.
  const voiceoverClips = await generateGeminiVoiceover(baseCfg, imagePaths, property, runTmpDir);

  // Per-image display duration: at least IMAGE_DURATION (readability
  // floor), stretched to cover the spoken clip when narration for that
  // image runs longer. Falls back to a flat IMAGE_DURATION for every
  // image when there's no voiceover at all — identical to the old
  // single-DUR behavior.
  const imageDurations = voiceoverClips
    ? imagePaths.map((_, i) => Math.max(voiceoverClips[i].duration, baseCfg.imageDuration))
    : imagePaths.map(() => baseCfg.imageDuration);

  const bedroomsLine = formatBedroomsLine(bedrooms);
  const textFiles = writeTextFiles(path.join(runTmpDir, "text"), {
    brand: baseCfg.brandName,
    location: location || "",
    bedrooms: bedroomsLine,
    meta: formatMetaLine(bedroomsLine, location || "", sqm),
    price: formatPriceLine(priceKes, priceUsd, baseCfg.usdRate),
    contact: formatContactLine(contactNumber || baseCfg.contactNumber),
    city: baseCfg.cityLine,
    description: description || "",
  });

  const imageInputCount = imagePaths.length;
  const hasLogo = Boolean(baseCfg.logoPath);
  // Voiceover wavs are passed as inputs right after images + logo, so
  // buildFilterGraph knows their ffmpeg input index for the apad+concat
  // chain it builds internally.
  const voiceoverInputStartIndex = imageInputCount + (hasLogo ? 1 : 0);

  const { inputArgs, filterComplex, totalDuration, hasVoiceover, imageInputCount: n } = buildFilterGraph(
    imagePaths,
    baseCfg,
    textFiles,
    {
      imageDurations,
      voiceover: voiceoverClips
        ? {
            inputStartIndex: voiceoverInputStartIndex,
            spokenDurations: voiceoverClips.map((c) => c.duration),
          }
        : null,
    }
  );

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const outputPath = path.join(opts.outputDir, `${outputName}.mp4`);

  const args = ["-y", ...inputArgs];

  // Per-image voiceover wavs, in the same order buildFilterGraph expects
  // (right after images + logo, before music).
  if (voiceoverClips) {
    for (const clip of voiceoverClips) {
      args.push("-i", clip.path);
    }
  }

  // Background music (optional, shared across the whole batch run).
  // -stream_loop -1 loops the track indefinitely so it always covers
  // the full video regardless of the source clip's length; the output
  // -t below then trims everything — video and audio — to size.
  let musicIndex = null;
  if (baseCfg.musicPath) {
    musicIndex = voiceoverInputStartIndex + (voiceoverClips ? voiceoverClips.length : 0);
    args.push("-stream_loop", "-1", "-i", baseCfg.musicPath);
  }

  let finalFilterComplex = filterComplex;
  if (musicIndex !== null && hasVoiceover) {
    finalFilterComplex +=
      `;[${musicIndex}:a]volume=0.18[music];[voice]volume=1.4[voiceout];` +
      "[music][voiceout]amix=inputs=2:duration=longest:dropout_transition=2[aout]";
  }

  args.push("-filter_complex", finalFilterComplex, "-map", "[vout]");

  if (hasVoiceover) {
    args.push(
      "-map",
      musicIndex !== null ? "[aout]" : "[voice]",
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
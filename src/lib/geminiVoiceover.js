import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EdgeTTS } from "node-edge-tts";
import { formatPriceLine, formatBedroomsLine } from "./loadConfig.js";

const execFileAsync = promisify(execFile);
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Generates one narration sentence + one TTS audio clip PER IMAGE, so the
 * video's per-image display duration can be paced to match what's being
 * said about that image. Returns null (voiceover disabled or failed) or
 * an array — one entry per image, in order:
 *   { path: string, duration: number }  // duration in seconds, read back
 *                                        // from the actual rendered file
 *                                        // via ffprobe
 *
 * Script generation (vision) still uses Gemini — ONE batched call
 * covering all photos at once. Audio synthesis uses edge-tts instead of
 * Gemini's TTS: it's a free, unofficial wrapper around Microsoft Edge's
 * cloud voice engine — no API key, no quota, no billing, ever. See the
 * note at the bottom of this file for how it compares to Gemini TTS.
 */
export async function generateGeminiVoiceover(cfg, imagePaths, property, runTmpDir) {
  if (!cfg.geminiVoiceover || !cfg.geminiApiKey) return null;

  try {
    const audioDir = path.join(runTmpDir, "voiceover");
    fs.mkdirSync(audioDir, { recursive: true });

    const sentences = await generateAllSentences(cfg, imagePaths, property);

    const clips = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const audioPath = path.join(audioDir, `${i}.mp3`);
      await synthesizeSpeechEdge(cfg, sentences[i], audioPath);
      const duration = await probeDurationSeconds(audioPath);
      clips.push({ path: audioPath, duration });
    }

    const scriptPath = path.join(runTmpDir, "text", "voiceover.txt");
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, sentences.join(" "), "utf8");

    return clips;
  } catch (error) {
    console.warn(`  Voiceover skipped: ${error.message}`);
    return null;
  }
}

/**
 * ONE vision call covering every photo, asking for one sentence per photo
 * back as a JSON array. Fed the exact strings the video overlays on
 * screen (same formatters renderVideo.js uses for price/bedrooms) so the
 * narration can't quote different numbers than what's actually displayed.
 */
async function generateAllSentences(cfg, imagePaths, property) {
  const priceLine = property.priceKes ? formatPriceLine(property.priceKes) : "";
  const bedroomsLine = formatBedroomsLine(property.bedrooms);
  const locationLine = property.location || "";
  const descriptionLine = property.description || "";

  const onScreenFacts = [
    bedroomsLine && `Bedrooms (on-screen text): "${bedroomsLine}"`,
    locationLine && `Location (on-screen text): "${locationLine}"`,
    priceLine && `Price (on-screen text): "${priceLine}"`,
    descriptionLine && `Description (on-screen text): "${descriptionLine}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const instructions =
    `This is a real-estate listing with ${imagePaths.length} photos, attached below in this exact order. ` +
    `The video overlays the following text on screen for the whole video:\n` +
    `${onScreenFacts || "(no on-screen text configured for this property)"}\n\n` +
    `Write ONE natural, confident voice-over sentence (12-20 words) PER PHOTO, describing only what is ` +
    `actually visible in that specific photo — do not invent facts, dimensions, or amenities that aren't ` +
    `visible. Do not include a phone number in any sentence.\n\n` +
    `IMPORTANT — stay consistent with what's on screen: if a sentence mentions the number of bedrooms, ` +
    `the location, or the price, it MUST use exactly the on-screen text given above, word for word. Never ` +
    `state a different bedroom count, location, or price than what's listed above.\n\n` +
    (priceLine
      ? `The very last sentence must close with a natural call-to-action that states the price exactly as "${priceLine}".\n\n`
      : "") +
    `Return ONLY a raw JSON array of exactly ${imagePaths.length} strings, one sentence per photo, in the ` +
    `same order the photos were given. No markdown, no code fences, no commentary — just the JSON array.`;

  const parts = [
    { text: instructions },
    ...imagePaths.map((imagePath) => ({
      inlineData: {
        mimeType: mimeTypeFor(imagePath),
        data: fs.readFileSync(imagePath).toString("base64"),
      },
    })),
  ];

  const response = await callGemini(cfg.geminiVisionModel, cfg.geminiApiKey, { contents: [{ parts }] });
  return parseSentenceArray(extractText(response), imagePaths.length);
}

/** Strips a ```json fence if Gemini wraps the array in one, then parses and length-checks it. */
function parseSentenceArray(rawText, expectedCount) {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Gemini did not return valid JSON for the narration script: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Gemini narration response was not a JSON array.");
  }
  if (parsed.length !== expectedCount) {
    throw new Error(`Gemini returned ${parsed.length} sentences but there are ${expectedCount} images.`);
  }
  return parsed.map((sentence) => String(sentence).trim());
}

function extractText(response) {
  const text = response.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim();
  if (!text) throw new Error("Gemini returned no narration text");
  return text;
}

async function callGemini(model, apiKey, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${API_ROOT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();

    const details = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    const error = new Error(`Gemini API returned HTTP ${response.status}: ${details}`);
    error.retryable = response.status >= 500 || response.status === 429;
    if (!error.retryable || attempt === 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

/**
 * edge-tts writes MP3 straight to disk — free, no API key, no quota.
 * Set EDGE_TTS_VOICE / EDGE_TTS_RATE / EDGE_TTS_PITCH in .env if you want
 * to override the defaults (see loadConfig.js — add cfg.edgeVoice etc.
 * there if they aren't wired up yet; falls back sensibly if they're not).
 * Full voice list: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts
 */
async function synthesizeSpeechEdge(cfg, sentence, outPath) {
  const tts = new EdgeTTS({
    voice: cfg.edgeVoice || "en-US-AriaNeural",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    rate: cfg.edgeRate || "default",
    pitch: cfg.edgePitch || "default",
    volume: cfg.edgeVolume || "default",
  });
  await tts.ttsPromise(sentence, outPath);
}

/** Reads exact audio duration via ffprobe — works for mp3/wav/anything ffmpeg can read. */
async function probeDurationSeconds(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`Could not read duration for ${filePath}`);
  return duration;
}
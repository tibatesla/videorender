import fs from "node:fs";
import path from "node:path";

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Generates a short property narration and Gemini TTS audio when enabled. */
export async function generateGeminiVoiceover(cfg, imagePaths, property, runTmpDir) {
  if (!cfg.geminiVoiceover || !cfg.geminiApiKey) return null;

  try {
    const script = await generateDescription(cfg, imagePaths, property);
    const textDir = path.join(runTmpDir, "text");
    fs.mkdirSync(textDir, { recursive: true });
    fs.writeFileSync(path.join(textDir, "voiceover.txt"), script, "utf8");

    const audio = await synthesizeSpeech(cfg, script);
    const audioPath = path.join(runTmpDir, "voiceover.wav");
    fs.writeFileSync(audioPath, createWav(audio.data, audio.sampleRate));
    return audioPath;
  } catch (error) {
    console.warn(`  Gemini voiceover skipped: ${error.message}`);
    return null;
  }
}

async function generateDescription(cfg, imagePaths, property) {
  const parts = [
    {
      text: `Write a natural, confident real-estate voice-over for this listing. Describe the visible rooms and features in the order the photos should be shown, from the first image to the last. Keep it between 45 and 75 words. Do not invent an address, dimensions, amenities, or facts that are not visible. Do not include a price or phone number; those are displayed on screen. Listing context: ${property.bedrooms || ""} bedrooms, ${property.location || ""}.`,
    },
  ];
  for (const imagePath of imagePaths) {
    parts.push({
      inlineData: {
        mimeType: mimeTypeFor(imagePath),
        data: fs.readFileSync(imagePath).toString("base64"),
      },
    });
  }

  const response = await callGemini(cfg.geminiVisionModel, cfg.geminiApiKey, {
    contents: [{ parts }],
  });
  const text = response.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim();
  if (!text) throw new Error("Gemini returned no narration text");
  return text;
}

async function synthesizeSpeech(cfg, script) {
  const response = await callGemini(cfg.geminiTtsModel, cfg.geminiApiKey, {
    contents: [{ parts: [{ text: script }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: cfg.geminiVoice },
        },
      },
    },
  });
  const audioPart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
  if (!audioPart?.inlineData?.data) throw new Error("Gemini returned no audio");
  return {
    data: Buffer.from(audioPart.inlineData.data, "base64"),
    sampleRate: 24000,
  };
}

async function callGemini(model, apiKey, body) {
  const response = await fetch(`${API_ROOT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Gemini API returned HTTP ${response.status}`);
  }
  return response.json();
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function createWav(pcmData, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

import "dotenv/config";
import fs from "node:fs";
import { loadBaseConfig } from "./lib/loadConfig.js";
import { resolveMusic } from "./lib/resolveImages.js";
import { renderVideo } from "./lib/renderVideo.js";

// Usage: node src/batch.js [path/to/properties.json]
const propertiesFile = process.argv[2] || "./properties/example-properties.json";

const baseCfg = loadBaseConfig(process.env);
// Music is resolved ONCE and reused for every property in this run —
// it's a campaign-level choice, not a per-property one.
baseCfg.musicPath = await resolveMusic(process.env.MUSIC_URL, "./tmp/_shared");

const properties = JSON.parse(fs.readFileSync(propertiesFile, "utf8"));

if (!Array.isArray(properties) || properties.length === 0) {
  console.error(`✖ ${propertiesFile} must contain a non-empty JSON array of properties.`);
  process.exit(1);
}

const results = { done: [], failed: [] };

for (const property of properties) {
  try {
    const outputPath = await renderVideo(baseCfg, property, {
      tmpRoot: "./tmp",
      outputDir: "./output",
    });
    results.done.push(outputPath);
  } catch (err) {
    console.error(`✖ ${property.outputName || "(unnamed)"} failed: ${err.message}`);
    results.failed.push(property.outputName || "(unnamed)");
  }
}

console.log(`\nDone: ${results.done.length} rendered, ${results.failed.length} failed.`);
if (results.failed.length) {
  console.log("Failed:", results.failed.join(", "));
  process.exit(1);
}

import "dotenv/config";
import { loadBaseConfig } from "./lib/loadConfig.js";
import { resolveMusic } from "./lib/resolveImages.js";
import { renderVideo } from "./lib/renderVideo.js";

const baseCfg = loadBaseConfig(process.env);
baseCfg.musicPath = await resolveMusic(process.env.MUSIC_URL, "./tmp/_shared");

const property = {
  outputName: process.env.OUTPUT_NAME || "property",
  location: process.env.PROPERTY_LOCATION || "",
  priceKes: process.env.PRICE_KES || "",
  priceUsd: process.env.PRICE_USD || "",
  bedrooms: process.env.BEDROOMS || "",
  description: process.env.DESCRIPTION || "",
  images: (process.env.IMAGES || "").split(",").map((s) => s.trim()).filter(Boolean),
};

renderVideo(baseCfg, property, {
  tmpRoot: "./tmp",
  outputDir: "./output",
}).catch((err) => {
  console.error("✖ Render failed:", err.message);
  process.exit(1);
});

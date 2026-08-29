import fs from "node:fs";
import path from "node:path";

/**
 * Reads the constant, brand/video-level settings out of process.env.
 * These are the values that stay the same across every property video.
 */
export function loadBaseConfig(env = process.env) {
  const required = ["FONT_HEADER", "FONT_BOLD", "FONT_REGULAR"];
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing required .env value: ${key}`);
  }

  const logoPath = env.LOGO_PATH && fs.existsSync(path.resolve(env.LOGO_PATH)) ? path.resolve(env.LOGO_PATH) : null;
  if (env.LOGO_PATH && !logoPath) {
    console.warn(`⚠ LOGO_PATH (${env.LOGO_PATH}) not found — rendering without a logo.`);
  }

  return {
    brandName: (env.BRAND_NAME || "CHESTONE PROPERTIES").toUpperCase(),
    contactNumber: env.CONTACT_NUMBER || "",
    // Shown under the logo on the outro card. Override with CITY_LINE
    // in .env if Chestone ever lists outside Nairobi.
    cityLine: env.CITY_LINE || "Nairobi, Kenya",
    logoPath,
    fontHeader: path.resolve(env.FONT_HEADER),
    fontBold: path.resolve(env.FONT_BOLD),
    fontRegular: path.resolve(env.FONT_REGULAR),
    // 1080x1920 (9:16) — full-screen vertical, right for TikTok/Reels/
    // Stories/Google vertical ads. Override in .env if you ever need
    // square (1080x1080) or 4:5 feed (1080x1350) instead.
    width: parseInt(env.WIDTH || "1080", 10),
    height: parseInt(env.HEIGHT || "1920", 10),
    fps: parseInt(env.FPS || "30", 10),
    imageDuration: parseFloat(env.IMAGE_DURATION || "3.5"),
    transitionDuration: parseFloat(env.TRANSITION_DURATION || "0.7"),
    motionScale: Math.max(1, parseFloat(env.MOTION_SCALE || "1.08")),
    descriptionMode: ["top", "bottom", "none"].includes(env.DESCRIPTION_MODE)
      ? env.DESCRIPTION_MODE
      : "bottom",
    // KES→USD rate used when a property doesn't supply its own priceUsd.
    // Override with USD_RATE in .env as the shilling moves.
    usdRate: parseFloat(env.USD_RATE || "129"),
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiVisionModel: env.GEMINI_VISION_MODEL || "gemini-3.6-flash",
    geminiTtsModel: env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts",
    geminiVoice: env.GEMINI_VOICE || "Kore",
    geminiVoiceover: env.GEMINI_VOICEOVER === "true",
    // musicPath is resolved separately (async, see resolveMusic) and
    // attached onto this object by index.js / batch.js before use.
    musicPath: null,
  };
}

/**
 * Formats "15M" into the on-screen price line, e.g.
 * "From KES 15M (~$116,000)". Trimmed from "Starting from" to "From"
 * and USD is now included (it used to be dropped for space — that's
 * fine now that the whole info block sits in one compact container).
 *
 * @param {string|number} priceKes  KES value already in millions, e.g. "15" or 15
 * @param {number} [priceUsd]       optional precomputed USD figure; if
 *                                   omitted, it's derived from priceKes
 *                                   using usdRate (KES millions * 1,000,000 / rate).
 * @param {number} [usdRate]        KES-per-USD rate, only used when priceUsd is omitted.
 */
export function formatPriceLine(priceKes, priceUsd, usdRate) {
  // Strip a trailing "M" or "m" that callers sometimes include so we
  // don't double-up and produce "17.5MM".
  const kesRaw = String(priceKes || "").trim().replace(/m$/i, "");
  const kesMillions = parseFloat(kesRaw);
  const usd =
    priceUsd !== undefined && priceUsd !== null && priceUsd !== ""
      ? Number(priceUsd)
      : Number.isFinite(kesMillions) && usdRate
      ? Math.round((kesMillions * 1_000_000) / usdRate)
      : null;

  const usdSuffix = Number.isFinite(usd) ? ` (~$${usd.toLocaleString()})` : "";
  return `From KES ${kesRaw}M${usdSuffix}`;
}

/**
 * Formats a bedroom count into the small "X-Bedroom" line. Accepts a
 * number (2, 3, 4...) or an already-formatted string — pass whatever's
 * easiest coming from .env or the properties JSON.
 */
export function formatBedroomsLine(bedrooms) {
  if (bedrooms === undefined || bedrooms === null || bedrooms === "") return "";
  const asString = String(bedrooms).trim();
  return /bedroom/i.test(asString) ? asString : `${asString}-Bedroom`;
}

/**
 * Formats a raw square-metre figure into "230sqm". Blank stays blank.
 */
export function formatSqmLine(sqm) {
  if (sqm === undefined || sqm === null || sqm === "") return "";
  const asString = String(sqm).trim();
  return /sqm/i.test(asString) ? asString : `${asString}sqm`;
}

/**
 * Combines bedrooms + sqm + a SHORT location (area only, no city) into
 * one compact line, e.g. "2-Bedroom | 230sqm | Westlands" — matching
 * the reference layout. City is intentionally dropped here (it still
 * lives on the outro card via cityLine) since the area name alone is
 * enough context and saves horizontal space in the compact container.
 * Handles any side being blank.
 */
export function formatMetaLine(bedroomsLine, location, sqm) {
  const sqmLine = formatSqmLine(sqm);
  const shortLocation = (location || "").split(",")[0].trim();
  return [bedroomsLine, sqmLine, shortLocation].filter(Boolean).join(" | ");
}

/** Formats a raw phone number into "Call: +254 726 111133". Blank stays blank. */
export function formatContactLine(number) {
  if (!number) return "";
  return /^call/i.test(number.trim()) ? number : `Call: ${number}`;
}
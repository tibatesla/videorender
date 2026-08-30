import { escapePathForFilter } from "./ffmpegEscape.js";

// Chestone brand palette — kept fixed here rather than in .env since
// these are identity constants, not per-run settings.
const BRAND_NAVY = "0x0B1F3B";
const BRAND_GOLD = "0xC9A24B";
const BRAND_WHITE = "white";

/**
 * Builds the ffmpeg -i input args + filter_complex string for a
 * branded property slideshow: images crossfade into each other, with
 * a navy brand bar (logo + name) on top and a centered info block
 * (brand / price / bedrooms+location / contact) for the full
 * duration of the video.
 *
 * @param {string[]} imagePaths          local image files, in order
 * @param {object}   cfg                 resolved base config (loadConfig.js)
 * @param {object}   textFiles           text line names -> local .txt file paths
 * @param {object}   [pacing]            optional per-image / voiceover pacing
 * @param {number[]} pacing.imageDurations   seconds each image is shown, one
 *                                            per image. Defaults to
 *                                            cfg.imageDuration for every
 *                                            image when omitted — same
 *                                            behavior as before per-image
 *                                            pacing existed.
 * @param {object}   [pacing.voiceover]  when present, wires up per-image
 *                                            narration clips as a single
 *                                            padded+concatenated audio
 *                                            track that lines up with each
 *                                            image's on-screen window.
 * @param {number}   pacing.voiceover.inputStartIndex  ffmpeg input index of
 *                                            the FIRST voiceover wav (they
 *                                            must be passed as consecutive
 *                                            -i args right after this index,
 *                                            one per image, in order).
 * @param {number[]} pacing.voiceover.spokenDurations  actual spoken length
 *                                            of each per-image clip, so the
 *                                            gap up to imageDurations[i] can
 *                                            be padded with silence.
 * @returns {{ inputArgs: string[], filterComplex: string, totalDuration: number, hasLogo: boolean, imageInputCount: number, hasVoiceover: boolean }}
 */
export function buildFilterGraph(imagePaths, cfg, textFiles, pacing = {}) {
  const {
    width: W,
    height: H,
    fps: FPS,
    imageDuration,
    clipTrimDuration,
    transitionDuration: TRANS,
    logoPath,
    descriptionMode,
    motionScale,
  } = cfg;
  const n = imagePaths.length;
  const hasLogo = Boolean(logoPath);

  const DEFAULT_DUR = pacing.isVideoClips ? clipTrimDuration : imageDuration;
  const imageDurations = pacing.imageDurations || imagePaths.map(() => DEFAULT_DUR);
  const voiceover = pacing.voiceover || null;
  const hasVoiceover = Boolean(voiceover);

  // Per-image ffmpeg input clip length: its own on-screen duration, plus
  // a trailing overlap window for crossfading into the NEXT image (the
  // last image doesn't need the extra tail since nothing follows it).
  const clipDuration = imageDurations.map((d, i) => (i < n - 1 ? d + TRANS : d));

  // Cumulative "solo" start time of each image — i.e. the point in the
  // timeline where image i's crossfade-in begins. This generalizes the
  // old `DUR * i` offset math to variable per-image durations.
  const cumulativeStart = [0];
  for (let i = 1; i < n; i++) {
    cumulativeStart.push(cumulativeStart[i - 1] + imageDurations[i - 1]);
  }

  // Total time occupied by the image sequence: every image's own
  // duration, plus one trailing TRANS for the final crossfade-out (same
  // shape as the old DUR*(n-1) + (DUR+TRANS) formula, generalized).
  const imagesDuration =
    n === 1 ? imageDurations[0] : imageDurations.reduce((sum, d) => sum + d, 0) + TRANS;

  // After the last photo, hold on a centered logo over a navy card —
  // only when a logo is actually configured, since there'd be nothing
  // to show otherwise.
  const OUTRO_DURATION = 2;
  const totalDuration = imagesDuration + (hasLogo ? OUTRO_DURATION : 0);

  const inputArgs = [];
  imagePaths.forEach((p, i) => {
    if (pacing.isVideoClips) {
      inputArgs.push("-t", clipDuration[i].toFixed(3), "-i", p);
    } else {
      inputArgs.push("-loop", "1", "-t", clipDuration[i].toFixed(3), "-i", p);
    }
  });
  const logoInputIndex = n;
  if (hasLogo) {
    inputArgs.push("-i", logoPath);
  }

  const filterParts = [];

  // 1) Normalize every input to the target resolution/FPS.
  //    For images, we add a slow diagonal camera move.
  //    For clips, we just scale/crop to fit without distorting.
  for (let i = 0; i < n; i++) {
    if (pacing.isVideoClips) {
      filterParts.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},format=yuv420p,setsar=1[img${i}]`
      );
    } else {
      const motionW = Math.ceil(W * motionScale);
      const motionH = Math.ceil(H * motionScale);
      const direction = i % 2 === 0 ? "1" : "-1";
      filterParts.push(
        `[${i}:v]scale=${motionW}:${motionH}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H}:x='(in_w-out_w)*(0.5+${direction}*0.35*sin(2*PI*t/${clipDuration[i].toFixed(3)}))':` +
          `y='(in_h-out_h)*(0.5+0.35*cos(2*PI*t/${clipDuration[i].toFixed(3)}))',` +
          `fps=${FPS},format=yuv420p,setsar=1[img${i}]`
      );
    }
  }

  // 2) Chain crossfades between consecutive images, each starting at
  //    that image's cumulative offset instead of a fixed DUR*i.
  let baseLabel;
  if (n === 1) {
    baseLabel = "img0";
  } else {
    let prev = "img0";
    for (let i = 1; i < n; i++) {
      const out = i === n - 1 ? "xfaded" : `x${i}`;
      const offset = cumulativeStart[i].toFixed(3);
      filterParts.push(`[${prev}][img${i}]xfade=transition=fade:duration=${TRANS}:offset=${offset}[${out}]`);
      prev = out;
    }
    baseLabel = "xfaded";
  }

  // 3) Overlay the logo (top-left), only during the intro window — it
  //    sits on the top bar, so it disappears with it and reappears
  //    full-size in the outro card instead of floating alone. Timed off
  //    the FIRST image's own duration, since that's the only image the
  //    top bar/logo are shown over.
  let afterLogoLabel = baseLabel;
  const introDuration = Math.min(imageDurations[0], 3);
  if (hasLogo) {
    const logoH = Math.round(H * 0.065);
    filterParts.push(`[${logoInputIndex}:v]scale=-1:${logoH}[logo]`);
    filterParts.push(`[${baseLabel}][logo]overlay=x=36:y=32:enable='lt(t\\,${introDuration})'[withlogo]`);
    afterLogoLabel = "withlogo";
  }

  // 4) Top brand bar stays boxed (it's only up during the intro, see
  //    below). The main info block — brand name / price / bedrooms+
  //    location / contact — is now stacked around the VERTICAL CENTER
  //    of the frame instead of hugging the bottom edge, so it lands on
  //    the visually important middle of the shot regardless of what's
  //    happening near the bottom (player UI, furniture, etc). Each
  //    line still gets its own tight, semi-transparent backdrop
  //    (drawtext's box option) so it stays readable no matter how
  //    light or busy the photo is underneath.
  const topBarH = Math.round(H * 0.085);
  const brandX = hasLogo ? Math.round(H * 0.055) + 60 : 36;

  // Larger, cleaner fonts — premium card feel.
  const brandFontSize = Math.round(topBarH * 0.34);
  const blockBrandFontSize = Math.round(H * 0.020);
  const smallFontSize = Math.round(H * 0.018);
  const metaFontSize = Math.round(H * 0.020);
  const priceFontSize = Math.round(H * 0.030);

  // Line height for each row in the stacked block.
  const lineGap = 1.4;
  const blockBrandH = Math.round(blockBrandFontSize * lineGap);
  const priceH = Math.round(priceFontSize * lineGap);
  const metaH = Math.round(metaFontSize * lineGap);
  const contactH = Math.round(smallFontSize * lineGap);
  const padding = Math.round(H * 0.022);
  const blockH = padding * 2 + blockBrandH + priceH + metaH + contactH;
  const blockW = Math.round(W * 0.78);
  const blockX = Math.round((W - blockW) / 2);
  const blockY = Math.round((H - blockH) / 2); // vertically centred

  let cursorY = blockY + padding;
  const brandBlockY = cursorY;
  cursorY += blockBrandH;
  const priceY = cursorY;
  cursorY += priceH;
  const metaY = cursorY;
  cursorY += metaH;
  const contactY = cursorY;

  const descriptionFontSize = Math.round(H * 0.018);
  const descriptionY = Math.round(H * 0.11);

  const topBarEnable = `lt(t\\,${introDuration})`;

  const chain = [
    `drawbox=x=0:y=0:w=${W}:h=${topBarH}:color=${BRAND_NAVY}:t=fill:enable='${topBarEnable}'`,
    `drawtext=fontfile=${escapePathForFilter(cfg.fontHeader)}:textfile=${escapePathForFilter(
      textFiles.brand
    )}:fontsize=${brandFontSize}:fontcolor=${BRAND_WHITE}:x=${brandX}:y=(${topBarH}-text_h)/2:enable='${topBarEnable}'`,

    // ── CENTRE INFO BLOCK (commented out) ──────────────────────────────
    // Uncomment below to re-enable the white box + text overlay.
    //
    // // ONE box behind all four lines — white, semi-transparent, centred.
    // `drawbox=x=${blockX}:y=${blockY}:w=${blockW}:h=${blockH}:color=white@0.88:t=fill`,
    //
    // // All text: bold, black — clearly readable on the white background.
    // `drawtext=fontfile=${escapePathForFilter(cfg.fontHeader)}:textfile=${escapePathForFilter(
    //   textFiles.brand
    // )}:fontsize=${blockBrandFontSize}:fontcolor=black:x=(${W}-text_w)/2:y=${brandBlockY}`,
    // `drawtext=fontfile=${escapePathForFilter(cfg.fontBold)}:textfile=${escapePathForFilter(
    //   textFiles.price
    // )}:fontsize=${priceFontSize}:fontcolor=black:x=(${W}-text_w)/2:y=${priceY}`,
    // `drawtext=fontfile=${escapePathForFilter(cfg.fontBold)}:textfile=${escapePathForFilter(
    //   textFiles.meta
    // )}:fontsize=${metaFontSize}:fontcolor=black:x=(${W}-text_w)/2:y=${metaY}`,
    // `drawtext=fontfile=${escapePathForFilter(cfg.fontBold)}:textfile=${escapePathForFilter(
    //   textFiles.contact
    // )}:fontsize=${smallFontSize}:fontcolor=black:x=(${W}-text_w)/2:y=${contactY}`,
    // ───────────────────────────────────────────────────────────────────
  ].join(",");

  const descriptionFilter = textFiles.description && descriptionMode !== "none"
    ? `drawtext=fontfile=${escapePathForFilter(cfg.fontRegular)}:textfile=${escapePathForFilter(
        textFiles.description
      )}:fontsize=${descriptionFontSize}:fontcolor=${BRAND_WHITE}:x=(${W}-text_w)/2:y=${
        descriptionMode === "top" ? descriptionY : Math.round(contactY + smallFontSize * 2.2)
      }`
    : "";
  const fullChain = descriptionFilter ? `${chain},${descriptionFilter}` : chain;

  // 5) Outro: after all property photos, hold on a centered logo over a
  //    plain navy card for OUTRO_DURATION seconds, with the contact
  //    number and city underneath it. Appended after the main
  //    bars+photos output via concat. Skipped entirely when there's no
  //    logo (nothing to anchor the card around). Logo is sized larger
  //    here than the small top-left mark, since this card is the one
  //    moment it's the sole focus.
  if (hasLogo) {
    filterParts.push(`[${afterLogoLabel}]${fullChain}[main]`);
    const outroLogoH = Math.round(H * 0.45);
    const outroLogoBottom = Math.round((H + outroLogoH) / 2);
    const outroContactY = outroLogoBottom + Math.round(H * 0.035);
    const outroCityY = outroContactY + Math.round(H * 0.032);
    filterParts.push(
      `color=c=${BRAND_NAVY}:s=${W}x${H}:d=${OUTRO_DURATION}:r=${FPS},format=yuv420p,setsar=1[outrobg]`
    );
    filterParts.push(`[${logoInputIndex}:v]scale=-1:${outroLogoH}[logooutro]`);
    filterParts.push(`[outrobg][logooutro]overlay=(W-w)/2:(H-h)/2[outrologo]`);
    const outroChain = [
      // Outro card keeps gold contact/city on the navy background —
      // gold reads better against solid navy than white does; this is
      // a separate, deliberate choice from the white text used over
      // busy photos in the main block above.
      `drawtext=fontfile=${escapePathForFilter(cfg.fontBold)}:textfile=${escapePathForFilter(
        textFiles.contact
      )}:fontsize=${Math.round(smallFontSize * 1.35)}:fontcolor=${BRAND_GOLD}:x=(${W}-text_w)/2:y=${outroContactY}`,
      `drawtext=fontfile=${escapePathForFilter(cfg.fontRegular)}:textfile=${escapePathForFilter(
        textFiles.city
      )}:fontsize=${smallFontSize}:fontcolor=${BRAND_GOLD}:x=(${W}-text_w)/2:y=${outroCityY}`,
    ].join(",");
    filterParts.push(`[outrologo]${outroChain}[outro]`);
    filterParts.push(`[main][outro]concat=n=2:v=1:a=0[vout]`);
  } else {
    filterParts.push(`[${afterLogoLabel}]${fullChain}[vout]`);
  }

  // 6) Voiceover audio: one wav per image, each padded with silence up
  //    to that image's own on-screen duration, then concatenated. This
  //    keeps clip i's audio starting exactly at cumulativeStart[i] —
  //    i.e. lined up with when image i actually appears — without any
  //    separate timing/offset filter needed; sequential concat of
  //    correctly-padded clips reproduces that timeline by construction.
  if (hasVoiceover) {
    for (let i = 0; i < n; i++) {
      const inputIndex = voiceover.inputStartIndex + i;
      const padAmount = Math.max(0, imageDurations[i] - voiceover.spokenDurations[i]);
      filterParts.push(`[${inputIndex}:a]apad=pad_dur=${padAmount.toFixed(3)}[voice${i}]`);
    }
    const voiceInputs = Array.from({ length: n }, (_, i) => `[voice${i}]`).join("");
    filterParts.push(`${voiceInputs}concat=n=${n}:v=0:a=1[voice]`);
  }

  return {
    inputArgs,
    filterComplex: filterParts.join(";\n"),
    totalDuration,
    hasLogo,
    hasVoiceover,
    imageInputCount: n,
  };
}
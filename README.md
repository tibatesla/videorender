# Chestone Video Generator

Turns a set of property photos into a branded, mobile-first marketing
video: images crossfade into each other, navy top bar with logo + brand
name, navy bottom bar with location / bedrooms / price (KES + USD) /
contact number. 1080x1920 (9:16) — full-screen on TikTok, Reels/Stories,
Facebook, and Google vertical ads.

## 1. Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and set what's constant across every property:

- `BRAND_NAME`, `LOGO_PATH`, `CONTACT_NUMBER`
- `FONT_HEADER` / `FONT_BOLD` / `FONT_REGULAR` — Bebas Neue + Poppins
  are already in `assets/fonts/`
- `MUSIC_URL` — optional, URL or local path to a background track.
  Leave blank for silent. It's resolved once per run and reused across
  every property in a batch, so change it whenever you have a new
  track — no per-property wiring needed.
- `WIDTH` / `HEIGHT` / `FPS` / `IMAGE_DURATION` / `TRANSITION_DURATION`
  — defaults are 1080x1920. Brand colors (navy/white/gold) are fixed in
  `src/lib/buildFilterGraph.js` rather than `.env`, since they're brand
  identity, not something you'd change per run.

`DESCRIPTION_MODE` can be `bottom`, `top`, or `none`. The optional listing
`description` is shown near the call-to-action, below the brand bar, or not
at all. `MOTION_SCALE=1.08` adds subtle camera movement to each photo.

Set `GEMINI_API_KEY` and `GEMINI_VOICEOVER=true` to generate narration from
the supplied images using Gemini vision and Gemini TTS.

Drop the real Chestone logo (transparent PNG) at `assets/logo.png`,
replacing the placeholder "CP" mark that's there now.

Requires `ffmpeg` on PATH (`ffmpeg -version` to check).

## 2. One property at a time

Fill in the bottom of `.env`:

```
PROPERTY_LOCATION=Karen, Nairobi
PRICE_KES=15M
PRICE_USD=116,000
BEDROOMS=3
OUTPUT_NAME=villa-karen-01
IMAGES=https://res.cloudinary.com/.../1.jpg,https://res.cloudinary.com/.../2.jpg,...
```

`IMAGES` is comma-separated and processed in the order given — that's
your photo order in the video. URLs or local file paths both work.
`BEDROOMS` accepts a plain number (`2`, `3`, `4`) and renders as
`"3-Bedroom"` — it's the small line above the price, not the big one.

```bash
npm start
```

Output lands in `output/villa-karen-01.mp4`.

## 3. Many properties at once (this is the one you'll actually use)

A single `.env` can only hold one property's worth of location/price/
bedrooms/images at a time — that doesn't scale once you're batching
many listings. So per-property data goes in a JSON file instead; `.env`
still holds everything constant (brand, fonts, video settings, music).

Edit `properties/example-properties.json` (or make your own file):

```json
[
  {
    "outputName": "villa-karen-01",
    "location": "Karen, Nairobi",
    "priceKes": "45M",
    "priceUsd": "348,000",
    "bedrooms": 4,
    "description": "A refined residence with bright living spaces and generous bedrooms, designed for relaxed modern living.",
    "images": [
      "https://res.cloudinary.com/.../1.jpg",
      "https://res.cloudinary.com/.../2.jpg",
      "https://res.cloudinary.com/.../3.jpg"
    ]
  },
  {
    "outputName": "apartment-kilimani-02",
    "location": "Kilimani, Nairobi",
    "priceKes": "12M",
    "priceUsd": "93,000",
    "bedrooms": 2,
    "images": ["https://res.cloudinary.com/.../1.jpg", "..."],
    "contactNumber": "+254 700 111222"
  }
]
```

`contactNumber` is optional per property — omit it and it falls back to
`CONTACT_NUMBER` in `.env`. Same pattern would work for a per-property
logo override later if you ever need one.

`description` is optional and can be supplied manually. Gemini-generated
voice-over text is used as the description when no manual description exists.

```bash
npm run batch                                  # uses properties/example-properties.json
npm run batch ./properties/my-listings.json     # or point at any file
```

Each property renders to `output/<outputName>.mp4`. One failing
property (bad image URL, etc.) doesn't stop the rest — failures are
listed at the end.

## 4. Try it immediately without real photos

`test-images/` has 3 placeholder JPGs and `output/demo-sample.mp4` is
what they produce, so you can see the layout before wiring in real
Cloudinary links and a real track. `.env` as shipped already points
`IMAGES` at `test-images/`, so:

```bash
node src/index.js
```

reproduces the demo.

## How it works / how to extend

- `src/lib/resolveImages.js` — downloads each image URL (or copies a
  local path) into a numbered temp folder so ordering is guaranteed;
  same underlying fetch function resolves the music track.
- `src/lib/buildFilterGraph.js` — builds the ffmpeg `filter_complex`:
  cover-crop each image to the frame → crossfade (`xfade`) them
  together → overlay logo → draw the navy top/bottom bars and text.
  Brand colors (`BRAND_NAVY` / `BRAND_GOLD` / `BRAND_WHITE`) are
  constants at the top of this file.
- `src/lib/writeTextFiles.js` — writes each text line (brand, location,
  bedrooms, price, contact) to its own `.txt` file and ffmpeg reads it
  via `textfile=`, instead of inlining text into the filter string.
  Avoids fragile escaping for locations/prices with commas, apostrophes,
  etc.
- `src/lib/renderVideo.js` — orchestrates one property end to end:
  images, text, optional Gemini narration, optional looped/trimmed music,
  and spawns ffmpeg.
- `src/lib/geminiVoiceover.js` — generates the narration script and WAV audio.

Easy to add later if you want it:
- **Ken Burns pan/zoom** on each photo (`zoompan` filter) instead of
  static crossfades — the per-image filter chain in
  `buildFilterGraph.js` is the place to add it.
- **Per-property logo override**, same pattern as `contactNumber`.

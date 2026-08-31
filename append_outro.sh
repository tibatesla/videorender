#!/bin/bash
set -e

# ==============================================================================
# 🎬 CHESTONE VIDEO BRANDING TOOL (OUTRO APPENDER)
# ==============================================================================

# 1. LOAD VARIABLES FROM .ENV (Safely handles spaces)
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    if [[ -n "$key" && "$key" != \#* ]]; then
      export "$key"="$value"
    fi
  done < <(grep -v '^#' .env | tr -d '\r')
fi

# 2. VALIDATE INPUTS
INPUT_VID=${RAW_VIDEO_PATH:-"raw_video.mp4"}
OUTPUT_VID=${OUTPUT_VIDEO_PATH:-"branded_output.mp4"}

if [ ! -f "$INPUT_VID" ]; then
  echo "❌ Error: Video not found at '$INPUT_VID'."
  echo "Please check the RAW_VIDEO_PATH variable in your .env file."
  exit 1
fi

LOGO_PATH=${LOGO_PATH:-"assets/logo.png"}
FONT_BOLD=${FONT_BOLD:-"assets/fonts/Poppins-SemiBold.ttf"}
FONT_REGULAR=${FONT_REGULAR:-"assets/fonts/Poppins-Regular.ttf"}

# Fetch details from .env (fallback to placeholders if empty)
PROP_NAME="${PROPERTY_NAME:-Chestone Property}"
LOC="${PROPERTY_LOCATION:-Nairobi}"
BEDS="${BEDROOMS:-}"
if [ -n "$BEDS" ]; then
  META_TEXT="${BEDS} Bedroom | ${LOC}"
else
  META_TEXT="${LOC}"
fi

# Make sure KES is included if they just wrote "17M"
PRICE_RAW="${PRICE_KES:-TBD}"
if [[ "$PRICE_RAW" == *"KES"* ]]; then
  PRICE_TEXT="From ${PRICE_RAW}"
else
  PRICE_TEXT="From KES ${PRICE_RAW}"
fi

PHONE="+254 726 111133"
EMAIL="info@chestoneproperties.com"
WEBSITE="chestoneproperties.com"
MUSIC_PATH="${MUSIC_URL:-}"

echo "▶ Probing raw video duration..."
ORIG_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_VID")
ORIG_DUR=$(printf "%.2f" $ORIG_DUR)

OUTRO_DUR=10.0
TOTAL_DUR=$(echo "$ORIG_DUR + $OUTRO_DUR" | bc -l)
FADE_START=$(echo "$TOTAL_DUR - 2.0" | bc -l)

echo "  Original Duration : ${ORIG_DUR}s"
echo "  Appending Outro   : 10.00s"
echo "  Final Target      : ${TOTAL_DUR}s"

# Check if the source video has audio to prevent ffmpeg errors
HAS_AUDIO=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "$INPUT_VID" || echo "")
HAS_MUSIC=""
if [ -n "$MUSIC_PATH" ] && [ -f "$MUSIC_PATH" ]; then
  HAS_MUSIC="yes"
fi

AUDIO_FILTER=""
HAS_AOUT=""

# Audio Mixing Logic
if [ -n "$HAS_AUDIO" ] && [ -n "$HAS_MUSIC" ]; then
  echo "  🎵 Found Original Audio + Background Music (Mixing Both)"
  # [0:a] is original, [2:a] is music
  AUDIO_FILTER="[0:a]apad=pad_dur=${OUTRO_DUR}[orig_a]; [2:a]volume=0.3,atrim=0:${TOTAL_DUR},afade=t=out:st=${FADE_START}:d=2[bgm]; [orig_a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout];"
  HAS_AOUT="yes"
elif [ -n "$HAS_AUDIO" ] && [ -z "$HAS_MUSIC" ]; then
  echo "  🎵 Found Original Audio (Padding Silence for Outro)"
  AUDIO_FILTER="[0:a]apad=pad_dur=${OUTRO_DUR}[aout];"
  HAS_AOUT="yes"
elif [ -z "$HAS_AUDIO" ] && [ -n "$HAS_MUSIC" ]; then
  echo "  🎵 Found Background Music Only"
  # Video has no audio, just use the music mapped to [1:a] (since logo is 1:v)
  # Actually, wait, if logo is input 1, music is input 2.
  AUDIO_FILTER="[2:a]volume=0.3,atrim=0:${TOTAL_DUR},afade=t=out:st=${FADE_START}:d=2[aout];"
  HAS_AOUT="yes"
else
  echo "  🔇 No audio found in video and no music provided."
fi

# 3. BUILD TEXT OVERLAYS FOR THE OUTRO CARD
DRAW_TITLE="drawtext=fontfile='${FONT_BOLD}':text='Chestone Properties':fontcolor=0xC9A24B:fontsize=65:x=(w-text_w)/2:y=670"
DRAW_LOC="drawtext=fontfile='${FONT_REGULAR}':text='Location\\: ${LOC}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=760"
DRAW_UNITS="drawtext=fontfile='${FONT_BOLD}':text='${UNIT_RANGE}':fontcolor=0xC9A24B:fontsize=50:x=(w-text_w)/2:y=850"
DRAW_PRICE="drawtext=fontfile='${FONT_BOLD}':text='${PRICE_RANGE}':fontcolor=0xC9A24B:fontsize=55:x=(w-text_w)/2:y=930"
DRAW_TERMS="drawtext=fontfile='${FONT_REGULAR}':text='${DEPOSIT} | ${BALANCE_TERMS}':fontcolor=white:fontsize=35:x=(w-text_w)/2:y=1020"

DRAW_PHONE="drawtext=fontfile='${FONT_BOLD}':text='${PHONE}':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=1300"
DRAW_EMAIL="drawtext=fontfile='${FONT_REGULAR}':text='${EMAIL}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=1400"
DRAW_WEB="drawtext=fontfile='${FONT_REGULAR}':text='${WEBSITE}':fontcolor=0xC9A24B:fontsize=45:x=(w-text_w)/2:y=1500"

TEXT_CHAIN="${DRAW_TITLE},${DRAW_LOC},${DRAW_UNITS},${DRAW_PRICE},${DRAW_TERMS},${DRAW_PHONE},${DRAW_EMAIL},${DRAW_WEB}"

echo "▶ Generating '$OUTPUT_VID'..."

FFMPEG_CMD=(ffmpeg -y -hide_banner -loglevel warning -stats)
FFMPEG_CMD+=(-i "$INPUT_VID" -i "$LOGO_PATH")

if [ -n "$HAS_MUSIC" ]; then
  FFMPEG_CMD+=(-stream_loop -1 -i "$MUSIC_PATH")
fi

# 4. BUILD IN-VIDEO STICKER OVERLAYS
LOC=$(echo "${PROPERTY_LOCATION:-Kileleshwa}" | tr -d '"' | sed 's/, Nairobi//g' | sed 's/ Nairobi//g')
UNIT_RANGE=$(echo "${UNIT_RANGE:-1, 2, 3 & 4 Bedroom}" | tr -d '"' | sed 's/[Bb]edroom/BR/g' | sed 's/[Bb]ed/BR/g' | sed 's/ & / \& /g')
PRICE_RANGE=$(echo "${PRICE_RANGE:-KES 6.5M - 17M}" | tr -d '"')
DEPOSIT=$(echo "${DEPOSIT:-20% Deposit}" | tr -d '"' | sed 's/Deposit/Dep/g' | sed 's/%/\\%/g')
BALANCE_TERMS=$(echo "${BALANCE_TERMS:-Balance in 48 Months}" | tr -d '"' | sed 's/Balance/Bal./g' | sed 's/Months/Mos./g')
PHONE_CLEAN=$(echo "${PHONE}" | tr -d '"')

# Tighter background box (w=800, h=250) + uniform spacing (+45px)
# Make absolutely sure DEPOSIT has \\% for ffmpeg drawtext inline evaluation
DEPOSIT_SAFE=$(echo "${DEPOSIT:-20% Deposit}" | tr -d '"' | sed 's/Deposit/Dep/g' | sed 's/%/\\\\%/g')

STICKER_BOX="drawbox=x=180:y=530:w=720:h=255:color=white@0.95:t=fill"
DRAW_S1="drawtext=fontfile='${FONT_BOLD}':text='Chestone Properties':fontcolor=black:fontsize=45:x=(w-text_w)/2:y=540"
DRAW_S2="drawtext=fontfile='${FONT_BOLD}':text='${LOC}':fontcolor=black:fontsize=45:x=(w-text_w)/2:y=588"
DRAW_S3="drawtext=fontfile='${FONT_BOLD}':text='${UNIT_RANGE} | ${PRICE_RANGE}':fontcolor=black:fontsize=45:x=(w-text_w)/2:y=636"
DRAW_S4="drawtext=fontfile='${FONT_BOLD}':text='${DEPOSIT_SAFE} | ${BALANCE_TERMS}':fontcolor=black:fontsize=45:x=(w-text_w)/2:y=684"
DRAW_S5="drawtext=fontfile='${FONT_BOLD}':text='Call ${PHONE_CLEAN}':fontcolor=black:fontsize=45:x=(w-text_w)/2:y=732"

STICKER_FILTER="${STICKER_BOX},${DRAW_S1},${DRAW_S2},${DRAW_S3},${DRAW_S4},${DRAW_S5}"

FILTER_COMPLEX="${AUDIO_FILTER}"
FILTER_COMPLEX+="[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v_base];"
FILTER_COMPLEX+="[1:v]scale=-1:300[logo_o];"
FILTER_COMPLEX+="[v_base]${STICKER_FILTER}[v_wm];"
FILTER_COMPLEX+="[v_wm]tpad=stop_duration=${OUTRO_DUR}:color=black[vpad];"
FILTER_COMPLEX+="color=c=0x0B1F3B:s=1080x1920:d=${OUTRO_DUR}:r=30[outro_bg];"
FILTER_COMPLEX+="[outro_bg][logo_o]overlay=(W-w)/2:350,${TEXT_CHAIN}[outro_card];"
FILTER_COMPLEX+="[vpad][outro_card]overlay=x=0:y=0:enable='gte(t,${ORIG_DUR})'[vout]"

FFMPEG_CMD+=(-filter_complex "$FILTER_COMPLEX")
FFMPEG_CMD+=(-map "[vout]")

if [ -n "$HAS_AOUT" ]; then
  FFMPEG_CMD+=(-map "[aout]")
fi

FFMPEG_CMD+=(-c:v libx264 -preset fast -crf 26 -maxrate 2.5M -bufsize 5M -c:a aac -b:a 128k -movflags +faststart -t ${TOTAL_DUR} "$OUTPUT_VID")

# Execute
"${FFMPEG_CMD[@]}"

echo "✔ Done! Output saved to $OUTPUT_VID"

import re

with open("append_outro.sh", "r") as f:
    content = f.read()

target = r"""STICKER_BOX="drawbox=x=180:y=530:w=720:h=255:color=white@0.95:t=fill"
DRAW_S1="drawtext=fontfile='${FONT_BOLD}':text='Chestone Properties':fontcolor=black:fontsize=38:x=(w-text_w)/2:y=550"
DRAW_S2="drawtext=fontfile='${FONT_REGULAR}':text='${LOC}':fontcolor=black:fontsize=38:x=(w-text_w)/2:y=595"
DRAW_S3="drawtext=fontfile='${FONT_BOLD}':text='${UNIT_RANGE} | ${PRICE_RANGE}':fontcolor=black:fontsize=38:x=(w-text_w)/2:y=640"
DRAW_S4="drawtext=fontfile='${FONT_REGULAR}':text='${DEPOSIT_SAFE} | ${BALANCE_TERMS}':fontcolor=black:fontsize=38:x=(w-text_w)/2:y=685"
DRAW_S5="drawtext=fontfile='${FONT_BOLD}':text='Call ${PHONE_CLEAN}':fontcolor=black:fontsize=38:x=(w-text_w)/2:y=730"
"""

replacement = r"""STICKER_BOX="drawbox=x=180:y=530:w=720:h=255:color=white@0.95:t=fill"
DRAW_S1="drawtext=fontfile='${FONT_BOLD}':text='Chestone Properties':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=542"
DRAW_S2="drawtext=fontfile='${FONT_REGULAR}':text='${LOC}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=588"
DRAW_S3="drawtext=fontfile='${FONT_BOLD}':text='${UNIT_RANGE} | ${PRICE_RANGE}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=634"
DRAW_S4="drawtext=fontfile='${FONT_REGULAR}':text='${DEPOSIT_SAFE} | ${BALANCE_TERMS}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=680"
DRAW_S5="drawtext=fontfile='${FONT_BOLD}':text='Call ${PHONE_CLEAN}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=726"
"""

if target in content:
    new_content = content.replace(target, replacement)
    with open("append_outro.sh", "w") as f:
        f.write(new_content)
    print("Success")
else:
    print("Target block not found. Checking if it was already modified...")

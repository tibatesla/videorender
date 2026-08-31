import re

with open("append_outro.sh", "r") as f:
    content = f.read()

target = r"""DRAW_S2="drawtext=fontfile='${FONT_REGULAR}':text='${LOC}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=588"
DRAW_S3="drawtext=fontfile='${FONT_BOLD}':text='${UNIT_RANGE} | ${PRICE_RANGE}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=634"
DRAW_S4="drawtext=fontfile='${FONT_REGULAR}':text='${DEPOSIT_SAFE} | ${BALANCE_TERMS}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=680"
"""

replacement = r"""DRAW_S2="drawtext=fontfile='${FONT_BOLD}':text='${LOC}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=588"
DRAW_S3="drawtext=fontfile='${FONT_BOLD}':text='${UNIT_RANGE} | ${PRICE_RANGE}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=634"
DRAW_S4="drawtext=fontfile='${FONT_BOLD}':text='${DEPOSIT_SAFE} | ${BALANCE_TERMS}':fontcolor=black:fontsize=42:x=(w-text_w)/2:y=680"
"""

if target in content:
    new_content = content.replace(target, replacement)
    with open("append_outro.sh", "w") as f:
        f.write(new_content)
    print("Success")
else:
    print("Target block not found. Checking if it was already modified...")

# Builds web/fonts/drawing-sans-canvas.woff2, the file Excalidraw loads for font id 9 (see web/vite.config.ts).
# usage: python scripts/subset-canvas-font.py node_modules/pretendard/dist/web/static/woff2 web/fonts
# needs fonttools==4.68.0 and brotli==1.2.1 (pip install fonttools==4.68.0 brotli==1.2.1); other versions write different bytes.
# Pretendard Regular 1.3.9 subset to Basic Latin + Latin-1 + common punctuation/arrows, Hangul Jamo + compatibility Jamo,
# and the 2,350 syllables of KS X 1001. Kept: kern + GPOS/GSUB needed for them; hinting dropped.
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

DESCRIPTION = "Subset of Pretendard 1.3.9 (https://github.com/orioncactus/pretendard), renamed because Pretendard is a Reserved Font Name."

src, out = sys.argv[1], sys.argv[2]
latin = "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2039,U+203A,U+20A9,U+20AC,U+2122,U+2190-2193,U+2212,U+2460-2473,U+25A0-25CF"
jamo = "U+1100-11FF,U+3130-318F"
# KS X 1001 Hangul: EUC-KR rows 0xB0..0xC8, 94 cells each.
ksx = []
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try:
            ksx.append(ord(bytes([hi, lo]).decode("euc_kr")))
        except UnicodeDecodeError:
            pass
assert len(ksx) == 2350, len(ksx)
unicodes = subset.parse_unicodes(latin + "," + jamo) + ksx

opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["kern"]
# Keep the copyright (0) and license (13, 14) records so the notice travels with the file.
opts.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]  # 10 is written below
opts.notdef_outline = True
opts.hinting = False
opts.desubroutinize = True
font = TTFont(f"{src}/Pretendard-Regular.woff2")
s = subset.Subsetter(opts)
s.populate(unicodes=unicodes)
s.subset(font)
# OFL: a modified version must not carry the reserved font name.
names = {1: "Drawing Sans", 2: "Regular", 3: "Drawing Sans Canvas Regular (subset)", 4: "Drawing Sans Canvas Regular", 6: "DrawingSansCanvas-Regular"}
for rec in font["name"].names:
    if rec.nameID in names:
        rec.string = names[rec.nameID]
# The source is credited in the description (ID 10); no font name record (1/3/4/6) carries "Pretendard".
font["name"].setName(DESCRIPTION, 10, 3, 1, 0x409)
if "CFF " in font:
    cff = font["CFF "].cff
    cff.fontNames[0] = "DrawingSansCanvas-Regular"
    top = cff.topDictIndex[0]
    for k in ("FullName", "FamilyName"):
        if hasattr(top, k): setattr(top, k, "Drawing Sans")
font.flavor = "woff2"
font.recalcTimestamp = False  # keep the source head.modified so a rerun writes the same bytes
font.save(f"{out}/drawing-sans-canvas.woff2")
print(len(font.getBestCmap()), "chars")

# usage: python scripts/subset-clean-font.py <pretendard static woff2 dir> <out dir>
# needs fonttools==4.68.0 and brotli==1.2.1 (pip install fonttools==4.68.0 brotli==1.2.1); other versions write different bytes.
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

DESCRIPTION = "Subset of Pretendard 1.3.9 (https://github.com/orioncactus/pretendard), renamed because Pretendard is a Reserved Font Name."

src, out = sys.argv[1], sys.argv[2]
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+20A9,U+20AC,U+2122,U+2190-2193,U+2212"
for name, weight in (("Regular", 400), ("SemiBold", 600)):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern"]
    # Keep the copyright (0) and license (13, 14) records so the notice travels inside every exported SVG.
    opts.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]  # 10 is written below
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    font = TTFont(f"{src}/Pretendard-{name}.woff2")
    s = subset.Subsetter(opts)
    s.populate(unicodes=subset.parse_unicodes(UNICODES))
    s.subset(font)
    # OFL: a modified version must not carry the reserved font name.
    names = {1: "Drawing Sans", 2: name, 3: f"Drawing Sans {name} (subset)", 4: f"Drawing Sans {name}", 6: f"DrawingSans-{name}"}
    for rec in font["name"].names:
        if rec.nameID in names:
            rec.string = names[rec.nameID]
    # The source is credited in the description (ID 10); no font name record (1/3/4/6) carries "Pretendard".
    font["name"].setName(DESCRIPTION, 10, 3, 1, 0x409)
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames[0] = f"DrawingSans-{name}"
        top = cff.topDictIndex[0]
        for k in ("FullName", "FamilyName"):
            if hasattr(top, k): setattr(top, k, "Drawing Sans")
    font.flavor = "woff2"
    font.recalcTimestamp = False  # keep the source head.modified so a rerun writes the same bytes
    font.save(f"{out}/drawing-sans-latin-{weight}.woff2")
    print(name, len(font.getBestCmap()), "chars")

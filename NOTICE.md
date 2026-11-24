# Third-party notices

Atelier bundles parts of the following projects. Icons are copied by `scripts/build-icons.mjs` as SVG data into
`shared/render/icon-data.ts` (a small always-loaded set) and `shared/render/icon-packs/` (the full sets, loaded on
demand). `shared/render/icon-packs/THIRD-PARTY.md` lists every bundled icon set with its version, icon count and
licence or terms.

## Lucide (`lucide-static`)

https://lucide.dev — used for general outline icons.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Simple Icons (`simple-icons`)

https://simpleicons.org — used for technology logos.

Simple Icons is released under CC0 1.0 Universal (public domain dedication):
https://creativecommons.org/publicdomain/zero/1.0/

Only icons without a separate per-icon licence (or with CC0-1.0) are bundled; the generator
refuses the others. The logos are trademarks of their respective owners. Their use here does
not imply endorsement, and each brand's own guidelines apply. Simple Icons never supplies AWS,
Google Cloud or Azure logos; those come from the vendors' own sets below.

## Cloud architecture icons (AWS, Microsoft Azure, Google Cloud)

The official architecture icon packages, imported by `scripts/import-cloud-icons.mjs` into
`shared/vendor/icons/` (sanitized SVG, unaltered artwork and colours) and drawn only inside diagrams:

- AWS Architecture Icons (https://aws.amazon.com/architecture/icons/). AWS permits customers and partners to use
  them to create architecture diagrams. Amazon Web Services, AWS and the service names are trademarks of
  Amazon.com, Inc. or its affiliates.
- Azure Architecture Icons (https://learn.microsoft.com/azure/architecture/icons/), under the Microsoft Terms of
  Use shipped in the package: for architectural diagrams, training materials or documentation; not cropped, flipped
  or rotated. Microsoft, Azure and the product names are trademarks of the Microsoft group of companies.
- Google Cloud icons (https://cloud.google.com/icons), for architecture diagrams that show Google Cloud products.
  Google Cloud and the product names are trademarks of Google LLC.

Versions and icon counts: `shared/render/icon-packs/THIRD-PARTY.md`. Icon names follow the names used by the
Eraser diagram syntax (`aws-ec2`, `postgres`); no Eraser icon files are copied.

## shadcn/ui

https://ui.shadcn.com — the component sources in `web/src/components/ui/` and `web/src/lib/utils.ts` are adapted
from shadcn/ui (new-york style).

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## UI font

Pretendard 1.3.9 (`pretendard` npm package, https://github.com/orioncactus/pretendard) is bundled with the app. The app
itself fetches no font from outside: every font file is a local build asset served by the Atelier server.

- Copyright (c) 2021-2023, Kil Hyung-jin (https://github.com/orioncactus/pretendard), with Reserved Font Name 'Pretendard'.
  (The license file says 2021; the font files' copyright record says 2023.)
  SIL Open Font License, Version 1.1. License text (with the copyright line): `shared/render/fonts/drawing-sans-OFL.txt`.
- UI text: the page loads Pretendard (Latin and Hangul) through Vite from the npm package (`web/src/index.css`).
- Block drawings and exported SVG/PNG embed modified subsets that are renamed "Drawing Sans", because modified versions
  may not use the Reserved Font Name. The copyright and license records stay inside each font file.
  - Latin: Pretendard Regular and SemiBold, cut down to Basic Latin, Latin-1 and common punctuation by
    `scripts/subset-clean-font.py` (fonttools 4.68.0). Files `shared/render/fonts/drawing-sans-latin-{400,600}.woff2`,
    embedded as base64 in `shared/render/font-clean.ts`.
  - Hangul and other characters outside that Latin set: at runtime the browser fetches the static Pretendard woff
    dynamic-subset files of the npm package (local build assets, `web/src/fonts/hangulFace.ts`), cuts them down to the
    glyphs the drawing uses, renames them "Drawing Sans" and embeds them in the block drawing and in exported SVG/PNG.
- Canvas text uses a cut-down copy of Pretendard Regular 1.3.9, renamed "Drawing Sans". File
  `web/fonts/drawing-sans-canvas.woff2`, built by `scripts/subset-canvas-font.py` (fonttools 4.68.0) from the
  `pretendard` npm package: Basic Latin, Latin-1, common punctuation, Hangul Jamo and the 2,350 KS X 1001 syllables.
  The other 8,822 modern syllables (for example 똠, 햏, 뷁, 쌰, 펲) are not in it and are drawn by a fallback font.
  Served in place of Excalidraw's Liberation Sans file (`web/vite.config.ts`, `FONT_OVERRIDES`).

## eraser-diagrams (`@eraserlabs/layout`, `@eraserlabs/utils`)

https://github.com/eraserlabs/eraser-diagrams, commit `6bde2841f1fb3368716d18e038aefa2214aa295f`.
`packages/layout/src` and `packages/utils/src` (without tests) are vendored in
`shared/vendor/eraser-layout/` for edge routing and label placement (#733); the local changes are listed
in `shared/vendor/eraser-layout/README.md`. That code also carries parts of RBush 4.0.1 (MIT,
Copyright (c) 2016 Vladimir Agafonkin) and Quickselect 3.0.0 (ISC, Copyright (c) 2018, Vladimir
Agafonkin); their notices are in `shared/vendor/eraser-layout/THIRD_PARTY_NOTICES.md` and `licenses/`.

```
MIT License

Copyright (c) 2026 Eraser Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## react-git-log (`@tomplum/react-git-log`)

https://github.com/TomPlum/react-git-log — draws the commit lanes of the 브랜치 tab (#877). Bundled into the web
build. Licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0); the full text
ships in `node_modules/@tomplum/react-git-log/LICENSE`. Copyright (c) Thomas Plumpton. Not modified.

#!/usr/bin/env python3
"""Generate the Hearth color schemes for both clients.

Every scheme is Ember re-lit: each token keeps Ember's OKLCH lightness and
its chroma *relationship*, and only the hue families move. That is what
keeps the schemes feeling like one app: the same warmth curve, the same
soft-wash-to-ink distances, a different fire in the grate.

After derivation, a repair loop nudges lightness until the contrast pairs
the app depends on actually pass WCAG:

  foreground/background >= 7      muted/background >= 4.5
  muted/surface2 >= 4.2           brandInk/brandSoft >= 4.5
  brandInk/background >= 4.5      accent/background >= 4.5
  onSolid/brand >= 3.0            brandFg/brand >= 3.0 (solid fills,
  the component threshold, which is what shipped Ember itself passes)
  foreground/surface2 >= 7

Status colors (success, danger, warning) do not move between schemes: red
means the same thing at every hearth.
"""
import math

# ---------------------------------------------------------------- color math

def srgb_to_linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    v = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
    return round(v * 255)

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(r, g, b):
    return "#{:02x}{:02x}{:02x}".format(r, g, b)

def rgb_to_oklab(r, g, b):
    r, g, b = (srgb_to_linear(x) for x in (r, g, b))
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l, m, s = (x ** (1/3) for x in (l, m, s))
    return (0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s)

def oklab_to_rgb(L, a, b):
    l = L + 0.3963377774*a + 0.2158037573*b
    m = L - 0.1055613458*a - 0.0638541728*b
    s = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = (x**3 for x in (l, m, s))
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(linear_to_srgb(x) for x in (r, g, bb))

def hex_to_lch(h):
    L, a, b = rgb_to_oklab(*hex_to_rgb(h))
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360

def lch_to_hex(L, C, H):
    hr = math.radians(H)
    return rgb_to_hex(*oklab_to_rgb(L, C*math.cos(hr), C*math.sin(hr)))

def rel_lum(h):
    r, g, b = (srgb_to_linear(x) for x in hex_to_rgb(h))
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# ---------------------------------------------------------------- ember

EMBER = {
 "light": {
  "background":"#faf6ee","foreground":"#2b2118","surface":"#fffcf5",
  "surface2":"#f3ecdd","surface3":"#eae1cd","border":"#e6dcc8",
  "muted":"#6b5d4f","brand":"#b5502f","brandStrong":"#9c3f22",
  "brandSoft":"#f6e3d7","brand2":"#d97742","brandFg":"#ffffff",
  "brandInk":"#8f3a1f","onSolid":"#ffffff","accent":"#56682d",
  "accentSoft":"#e9edd8","success":"#25683f","danger":"#b32d2d",
  "warning":"#8a5c00"},
 "dark": {
  "background":"#1c1612","foreground":"#f2ebe1","surface":"#262019",
  "surface2":"#322a21","surface3":"#3e352a","border":"#453b2e",
  "muted":"#b3a28e","brand":"#e0764b","brandStrong":"#cf5f33",
  "brandSoft":"#40291c","brand2":"#e8955f","brandFg":"#2b1408",
  "brandInk":"#eda07b","onSolid":"#ffffff","accent":"#8ba852",
  "accentSoft":"#262e1a","success":"#4caf7d","danger":"#e06060",
  "warning":"#d9a13a"},
}

ROLES = {
  "background":"neutral","foreground":"neutral","surface":"neutral",
  "surface2":"neutral","surface3":"neutral","border":"neutral","muted":"neutral",
  "brand":"brand","brandStrong":"brand","brandSoft":"brand","brand2":"brand",
  "brandFg":"brand","brandInk":"brand","onSolid":"fixed",
  "accent":"accent","accentSoft":"accent",
  "success":"fixed","danger":"fixed","warning":"fixed",
}

# Per scheme: brand hue, accent hue, neutral hue, and chroma multipliers.
# Hues are OKLCH degrees. Ember's own: brand ~40, accent ~120, neutrals ~80.
# Two families on purpose: the soft ones (Rose, Honey, Slate, Dusk) keep
# their chroma near Ember's, and the loud ones (Peony, Gold, Cobalt, Grape)
# push well past it. Slate stays the one deliberately quiet scheme.
SCHEMES = {
  # name: (label, brandH, brandCx, accentH, accentCx, neutralH, neutralCx)
  "rose":    ("Rose",      18, 1.15, 356, 1.10,  20, 0.90),
  "peony":   ("Peony",    350, 1.40, 310, 1.15, 355, 0.65),
  "honey":   ("Honey",     75, 1.10,  45, 1.00,  75, 0.90),
  "gold":    ("Gold",      90, 1.30, 262, 1.05,  88, 0.75),
  "fern":    ("Fern",     150, 1.05, 110, 1.10, 130, 0.50),
  "tide":    ("Tide",     205, 1.15, 175, 1.15, 210, 0.45),
  "aggie":   ("Aggie",    262, 1.20,  85, 1.20, 250, 0.45),
  "cobalt":  ("Cobalt",   268, 1.45, 200, 1.25, 260, 0.55),
  "slate":   ("Slate",    240, 0.55, 220, 0.70, 240, 0.25),
  "dusk":    ("Dusk",     310, 1.00, 285, 1.00, 300, 0.50),
  "grape":   ("Grape",    320, 1.45, 350, 1.20, 310, 0.55),
}

# The pairs that must pass, per appearance.
REQUIRED = [
  ("foreground","background",7.0), ("foreground","surface2",7.0),
  ("muted","background",4.5), ("muted","surface2",4.2),
  ("brandInk","brandSoft",4.5), ("brandInk","background",4.5),
  ("accent","background",4.5),
  ("onSolid","brand",3.0), ("brandFg","brand",3.0),
]

def derive(scheme_key):
    _label, bH, bC, aH, aC, nH, nC = SCHEMES[scheme_key]
    out = {}
    for mode in ("light","dark"):
        pal = {}
        for token, hexv in EMBER[mode].items():
            role = ROLES[token]
            if role == "fixed":
                pal[token] = hexv
                continue
            L, C, H = hex_to_lch(hexv)
            if role == "brand":
                pal[token] = lch_to_hex(L, C*bC, bH)
            elif role == "accent":
                pal[token] = lch_to_hex(L, C*aC, aH)
            else:
                pal[token] = lch_to_hex(L, C*nC, nH)
        out[mode] = pal
    return out

def repair(pal, mode):
    """Nudge foreground-side lightness until every required pair passes."""
    darker_side = -1 if mode == "light" else +1   # move text away from bg
    for fg, bg, need in REQUIRED:
        guard = 0
        while contrast(pal[fg], pal[bg]) < need and guard < 60:
            L, C, H = hex_to_lch(pal[fg])
            L += 0.008 * darker_side
            # onSolid/brandFg are backgrounds' text: adjust the BRAND instead
            if fg in ("onSolid","brandFg"):
                Lb, Cb, Hb = hex_to_lch(pal[bg])
                Lb += 0.008 * (-1 if mode=="light" else -1)
                pal[bg] = lch_to_hex(max(0.0,min(1.0,Lb)), Cb, Hb)
            else:
                pal[fg] = lch_to_hex(max(0.0,min(1.0,L)), C, H)
            guard += 1
    return pal

def validate(name, pal, mode):
    fails = []
    for fg, bg, need in REQUIRED:
        c = contrast(pal[fg], pal[bg])
        if c < need:
            fails.append(f"{name}/{mode} {fg} on {bg}: {c:.2f} < {need}")
    return fails

ALL = {"ember": EMBER}
fails = []
for key in SCHEMES:
    d = derive(key)
    for mode in ("light","dark"):
        d[mode] = repair(d[mode], mode)
        fails += validate(key, d[mode], mode)
    ALL[key] = d

for name, pals in ALL.items():
    for mode in ("light","dark"):
        fails += validate(name, pals[mode], mode)

if fails:
    print("CONTRAST FAILURES:")
    for f in fails: print(" ", f)
    raise SystemExit(1)
print("all", len(ALL), "schemes pass all", len(REQUIRED), "pairs in both modes")

# ---------------------------------------------------------------- emit

import json
LABELS = {"ember":"Ember", **{k: v[0] for k, v in SCHEMES.items()}}
# A hue walk, warm to cool, so the picker reads as a spectrum.
ORDER = ["ember","rose","peony","honey","gold","fern",
         "tide","aggie","cobalt","slate","dusk","grape"]

# TypeScript block for mobile/src/constants/theme.ts
ts = []
ts.append("export const schemePalettes = {")
for name in ORDER:
    ts.append(f"  {name}: {{")
    for mode in ("light","dark"):
        ts.append(f"    {mode}: {{")
        for token, hexv in ALL[name][mode].items():
            ts.append(f'      {token}: "{hexv}",')
        ts.append("    },")
    ts.append("  },")
ts.append("} as const;")
open("scheme-palettes.ts.txt","w").write("\n".join(ts) + "\n")

# CSS blocks for src/app/globals.css
VAR = {
 "background":"background","foreground":"foreground","surface":"surface",
 "surface2":"surface-2","surface3":"surface-3","border":"border",
 "muted":"muted","brand":"brand","brandStrong":"brand-strong",
 "brandSoft":"brand-soft","brand2":"brand-2","brandFg":"brand-fg",
 "brandInk":"brand-ink","onSolid":"on-solid","accent":"accent",
 "accentSoft":"accent-soft","success":"success","danger":"danger",
 "warning":"warning"}
# Mirrors the base structure in globals.css exactly: light on :root,
# system dark behind the media query (unless the toggle forced light),
# explicit dark on [data-theme="dark"]. The scheme+theme selectors carry
# one more attribute than the base ones, so they win without !important.
css = []
for name in ORDER[1:]:
    light, dark = ALL[name]["light"], ALL[name]["dark"]
    css.append(f':root[data-scheme="{name}"] {{')
    for t, v in light.items():
        css.append(f"  --{VAR[t]}: {v};")
    css.append("}")
    css.append("@media (prefers-color-scheme: dark) {")
    css.append(f'  :root[data-scheme="{name}"]:not([data-theme="light"]) {{')
    for t, v in dark.items():
        css.append(f"    --{VAR[t]}: {v};")
    css.append("  }")
    css.append("}")
    css.append(f':root[data-scheme="{name}"][data-theme="dark"] {{')
    for t, v in dark.items():
        css.append(f"  --{VAR[t]}: {v};")
    css.append("}")
open("scheme-blocks.css.txt","w").write("\n".join(css) + "\n")

# Swatches for the pickers: bg, brand, accent per scheme (light mode).
sw = {n: {"label": LABELS[n],
          "swatch": [ALL[n]["light"]["background"],
                      ALL[n]["light"]["brand"],
                      ALL[n]["light"]["accent"]]} for n in ORDER}
open("scheme-swatches.json","w").write(json.dumps(sw, indent=1))
print("emitted: scheme-palettes.ts.txt, scheme-blocks.css.txt, scheme-swatches.json")
for n in ORDER:
    l = ALL[n]["light"]
    print(f"  {LABELS[n]:7s} bg {l['background']}  brand {l['brand']}  accent {l['accent']}")

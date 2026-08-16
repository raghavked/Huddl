import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMES } from "./theme-schemes";

/**
 * The hearths exist in three generated places: the native palettes in
 * mobile/src/constants/theme.ts (the source of truth), the CSS custom
 * property blocks at the bottom of src/app/globals.css, and the preview
 * hexes in ./theme-schemes.ts. All three come out of scripts/schemes.py,
 * and every seam between them is a place a hand edit could quietly desaturate
 * one client. So this file pins:
 *
 *  - byte-for-byte hex agreement between native and web for every token of
 *    every scheme in both appearances (including Ember, whose web copy is
 *    the base :root rather than a [data-scheme] block);
 *  - that the media-query dark block and the [data-theme="dark"] block of a
 *    scheme never diverge;
 *  - that the boot script in the root layout recognises exactly the schemes
 *    that exist;
 *  - and that every scheme still passes the WCAG pairs the app leans on, so
 *    a regenerated palette cannot land unreadable.
 */

const REPO = process.cwd();

type Tokens = Record<string, string>;

/** token name in TS -> CSS custom property name */
const CSS_VAR: Record<string, string> = {
  background: "background",
  foreground: "foreground",
  surface: "surface",
  surface2: "surface-2",
  surface3: "surface-3",
  border: "border",
  muted: "muted",
  brand: "brand",
  brandStrong: "brand-strong",
  brandSoft: "brand-soft",
  brand2: "brand-2",
  brandFg: "brand-fg",
  brandInk: "brand-ink",
  onSolid: "on-solid",
  accent: "accent",
  accentSoft: "accent-soft",
  success: "success",
  danger: "danger",
  warning: "warning",
};

const TOKEN_NAMES = Object.keys(CSS_VAR);
const NON_EMBER = SCHEMES.map((s) => s.id).filter((id) => id !== "ember");

/* ------------------------- parsing the two files ------------------------- */

const nativeSource = readFileSync(
  join(REPO, "mobile", "src", "constants", "theme.ts"),
  "utf8"
);
const css = readFileSync(join(REPO, "src", "app", "globals.css"), "utf8");

function hexPairs(block: string): Tokens {
  const out: Tokens = {};
  for (const match of block.matchAll(/(\w+): "(#[0-9a-f]{6})"/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

/** One `light:`/`dark:` object literal out of a palettes-shaped TS block. */
function nativeMode(block: string, mode: "light" | "dark"): Tokens {
  const start = block.indexOf(`${mode}: {`);
  const end = block.indexOf("}", start);
  expect(start, `${mode} half missing`).toBeGreaterThan(-1);
  return hexPairs(block.slice(start, end));
}

function nativeScheme(id: string): { light: Tokens; dark: Tokens } {
  // Ember IS `palettes`; the others live under their key in hearthPalettes.
  const anchor =
    id === "ember" ? "export const palettes = {" : `  ${id}: {\n    light: {`;
  const start = nativeSource.indexOf(anchor);
  expect(start, `native block for ${id}`).toBeGreaterThan(-1);
  const block = nativeSource.slice(start, start + 2400);
  return { light: nativeMode(block, "light"), dark: nativeMode(block, "dark") };
}

/** The declarations of the first CSS block that starts with `selector {`. */
function cssBlock(selector: string): Tokens {
  const at = css.indexOf(`${selector} {`);
  expect(at, `css block for ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf("}", at));
  const out: Tokens = {};
  for (const match of body.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function expectCssMatchesNative(vars: Tokens, native: Tokens, label: string) {
  for (const token of TOKEN_NAMES) {
    expect(vars[CSS_VAR[token]], `${label} ${token}`).toBe(native[token]);
  }
}

/* --------------------------------- tests --------------------------------- */

describe("hearth scheme parity", () => {
  it("carries every native token into the web CSS, scheme by scheme", () => {
    // Ember: the base blocks.
    const ember = nativeScheme("ember");
    expectCssMatchesNative(cssBlock(":root"), ember.light, "ember light");
    expectCssMatchesNative(
      cssBlock(':root[data-theme="dark"]'),
      ember.dark,
      "ember dark"
    );

    for (const id of NON_EMBER) {
      const native = nativeScheme(id);
      expectCssMatchesNative(
        cssBlock(`:root[data-scheme="${id}"]`),
        native.light,
        `${id} light`
      );
      expectCssMatchesNative(
        cssBlock(`:root[data-scheme="${id}"][data-theme="dark"]`),
        native.dark,
        `${id} explicit dark`
      );
      // System dark (the media-query block) must say the same thing.
      expectCssMatchesNative(
        cssBlock(`  :root[data-scheme="${id}"]:not([data-theme="light"])`),
        native.dark,
        `${id} system dark`
      );
    }
  });

  it("keeps the preview hexes and words in step with the native palettes", () => {
    const previewTokens = [
      "background",
      "foreground",
      "muted",
      "brand",
      "accent",
    ] as const;
    // The native picker list, word for word.
    const hearthsAt = nativeSource.indexOf("export const HEARTHS");
    const hearthsBlock = nativeSource.slice(
      hearthsAt,
      nativeSource.indexOf("];", hearthsAt)
    );
    for (const scheme of SCHEMES) {
      const native = nativeScheme(scheme.id);
      for (const token of previewTokens) {
        expect(scheme.preview.light[token], `${scheme.id} light ${token}`).toBe(
          native.light[token]
        );
        expect(scheme.preview.dark[token], `${scheme.id} dark ${token}`).toBe(
          native.dark[token]
        );
      }
      expect(hearthsBlock).toContain(
        `{ id: "${scheme.id}", label: "${scheme.label}", hint: "${scheme.hint}" }`
      );
    }
  });

  it("boots exactly the schemes that exist", () => {
    const layout = readFileSync(join(REPO, "src", "app", "layout.tsx"), "utf8");
    // The array right after the "hearth-scheme" read; the font `subsets`
    // arrays earlier in the file are also all-lowercase strings.
    const at = layout.indexOf('localStorage.getItem("hearth-scheme")');
    expect(at, "boot script reads hearth-scheme").toBeGreaterThan(-1);
    const list = layout.slice(at).match(/\["[a-z",]+"\]/)?.[0];
    expect(list, "scheme list in the boot script").toBeTruthy();
    expect(JSON.parse(list as string)).toEqual(NON_EMBER);
  });

  it("keeps every scheme readable: the WCAG pairs the app leans on", () => {
    const REQUIRED: [string, string, number][] = [
      ["foreground", "background", 7],
      ["foreground", "surface2", 7],
      ["muted", "background", 4.5],
      ["muted", "surface2", 4.2],
      ["brandInk", "brandSoft", 4.5],
      ["brandInk", "background", 4.5],
      ["accent", "background", 4.5],
      // Solid fills sit at the component threshold, which is what shipped
      // Ember itself passes (its dark onSolid-on-brand is 3.06).
      ["onSolid", "brand", 3],
      ["brandFg", "brand", 3],
    ];
    const linear = (channel: number) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) =>
      0.2126 * linear(parseInt(hex.slice(1, 3), 16)) +
      0.7152 * linear(parseInt(hex.slice(3, 5), 16)) +
      0.0722 * linear(parseInt(hex.slice(5, 7), 16));
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const scheme of SCHEMES) {
      const native = nativeScheme(scheme.id);
      for (const mode of ["light", "dark"] as const) {
        for (const [fg, bg, need] of REQUIRED) {
          const ratio = contrast(native[mode][fg], native[mode][bg]);
          expect(
            ratio,
            `${scheme.id}/${mode}: ${fg} on ${bg} = ${ratio.toFixed(2)}`
          ).toBeGreaterThanOrEqual(need);
        }
      }
    }
  });
});

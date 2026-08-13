import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_ACCEPT_ATTR,
  isAcceptedImageType,
} from "./image-types";

describe("accepted image types", () => {
  it("takes the formats a phone or a laptop actually produces", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/gif",
    ]) {
      expect(isAcceptedImageType(type)).toBe(true);
    }
  });

  it("refuses SVG, which is the whole point", () => {
    // `startsWith("image/")`, what these checks used to be, says yes to
    // this, and an SVG in the public avatars bucket is an executable page.
    expect(isAcceptedImageType("image/svg+xml")).toBe(false);
    expect(ACCEPTED_IMAGE_TYPES).not.toContain("image/svg+xml");
  });

  it("refuses documents and markup dressed as uploads", () => {
    for (const type of [
      "text/html",
      "application/xhtml+xml",
      "application/pdf",
      "text/javascript",
      "application/octet-stream",
    ]) {
      expect(isAcceptedImageType(type)).toBe(false);
    }
  });

  it("refuses an unknown or absent type rather than guessing", () => {
    expect(isAcceptedImageType("")).toBe(false);
    expect(isAcceptedImageType(undefined)).toBe(false);
    expect(isAcceptedImageType(null)).toBe(false);
  });

  it("offers the same list to the file picker", () => {
    expect(IMAGE_ACCEPT_ATTR.split(",")).toEqual([...ACCEPTED_IMAGE_TYPES]);
    expect(IMAGE_ACCEPT_ATTR).not.toContain("svg");
  });
});

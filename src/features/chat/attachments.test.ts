import { describe, expect, it } from "vitest";
import { chatUploadPath, imageExtension } from "@/features/chat/attachments";

describe("imageExtension", () => {
  it("prefers the file name's own extension", () => {
    expect(imageExtension("dog.png", "image/png")).toBe("png");
    expect(imageExtension("scan.webp", "image/webp")).toBe("webp");
  });

  it("normalizes jpeg to jpg", () => {
    expect(imageExtension("photo.JPEG", "image/jpeg")).toBe("jpg");
    expect(imageExtension("photo", "image/jpeg")).toBe("jpg");
  });

  it("falls back to the MIME subtype when the name has no extension", () => {
    expect(imageExtension("clipboard-image", "image/png")).toBe("png");
  });

  it("falls back to jpg when nothing usable is present", () => {
    expect(imageExtension("weird.", "")).toBe("jpg");
    expect(imageExtension("", "not-a-mime")).toBe("jpg");
  });

  it("ignores suspicious extensions and uses the MIME type instead", () => {
    expect(imageExtension("file.this-is-not-an-ext!", "image/gif")).toBe("gif");
  });
});

describe("chatUploadPath", () => {
  it("scopes the key under the uploader's folder, as bucket RLS requires", () => {
    const path = chatUploadPath("user-123", "png", 1700000000000, "abc123");
    expect(path).toBe("user-123/1700000000000-abc123.png");
    expect(path.split("/")[0]).toBe("user-123");
  });
});

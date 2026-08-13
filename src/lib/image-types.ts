/**
 * What Huddl accepts when it asks for a picture.
 *
 * Three file inputs used to say `accept="image/*"` and check
 * `file.type.startsWith("image/")`, which reads as "any image" and means
 * something slightly different: `image/svg+xml` passes both. An SVG is not a
 * picture in the sense meant here. It is a document, it can carry a
 * `<script>` element, and the avatars bucket is public, so opening its URL
 * runs that script in the storage domain's origin. Not a route into anyone's
 * account, since no Huddl session lives on that origin, but a way to host an
 * executable page on infrastructure that answers to this project.
 *
 * So the list is named rather than wildcarded, and deliberately generous
 * otherwise: the failure mode of being too strict is a student who cannot
 * upload their own face and has no idea why. Every raster format a phone or
 * a laptop is likely to hand over is here. Migration 0044 puts the identical
 * list on the `avatars` and `chat-uploads` buckets, so the server enforces
 * what these inputs merely ask for. This side exists to turn a rejection
 * into a sentence the student can act on.
 */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
];

/** The same list as an `accept` attribute, so the OS picker filters too. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(",");

/**
 * True when this is a picture we will take. An empty or missing type is a
 * no: the browser could not identify the file, and guessing is how an SVG
 * gets through.
 */
export function isAcceptedImageType(type: string | undefined | null): boolean {
  return typeof type === "string" && ACCEPTED_IMAGE_TYPES.includes(type);
}

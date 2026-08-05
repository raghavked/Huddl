// Pure helpers for the Canvas by Instructure REST API.
// No network calls here — routes under src/app/api/canvas/* do the fetching,
// which keeps everything in this file unit-testable.

/** Subset of the Canvas `/api/v1/users/self` payload we consume. */
export interface CanvasUser {
  id: number;
  name: string;
  short_name?: string;
  primary_email?: string;
}

/** Subset of the Canvas `/api/v1/courses` payload we consume. */
export interface CanvasCourse {
  id: number;
  name?: string | null;
  course_code?: string | null;
  /** "unpublished" | "available" | "completed" | "deleted" */
  workflow_state?: string;
  /** Canvas returns a stub row (no code/name) when a course is date-restricted. */
  access_restricted_by_date?: boolean;
  enrollment_term_id?: number;
}

/** Shape a Canvas course maps to before it becomes a `courses` row. */
export interface MappedCanvasCourse {
  code: string;
  title: string;
  canvas_course_id: number;
}

/** Hard cap on pagination when syncing courses (100 per page = 500 courses). */
export const MAX_COURSE_PAGES = 5;

/**
 * Parse an RFC 5988 `Link` response header (Canvas pagination) and pull out
 * the rel="next" URL if present. Canvas sends headers like:
 *
 *   <https://canvas.x.edu/api/v1/courses?page=2>; rel="current",
 *   <https://canvas.x.edu/api/v1/courses?page=3>; rel="next", ...
 */
export function parseLinkHeader(header: string | null | undefined): {
  next?: string;
} {
  if (!header) return {};
  const result: { next?: string } = {};
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*(.+)/);
    if (!match) continue;
    const [, url, params] = match;
    const rel = params.match(/rel\s*=\s*"?([^";\s]+)"?/i);
    if (rel && rel[1].toLowerCase() === "next" && result.next === undefined) {
      result.next = url;
    }
  }
  return result;
}

/**
 * Map a raw Canvas course to the shape we store, or null when the course
 * shouldn't be imported: no course_code (stub payloads), restricted by date,
 * or not currently available (unpublished/completed/deleted).
 */
export function mapCanvasCourse(c: CanvasCourse): MappedCanvasCourse | null {
  if (c.access_restricted_by_date) return null;
  if (c.workflow_state !== "available") return null;
  const code = c.course_code?.trim();
  if (!code) return null;
  const title = c.name?.trim() || code;
  return { code, title, canvas_course_id: c.id };
}

/**
 * Normalize user input ("canvas.university.edu/", with or without a scheme)
 * to a clean https origin, or null when it can't be a valid Canvas base URL.
 * Explicit non-https schemes are rejected.
 */
export function normalizeCanvasBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // Require a real dotted hostname — filters out "https://canvas" typos.
  if (!url.hostname.includes(".")) return null;
  return url.origin;
}

/**
 * Heuristic check that an https origin looks like a Canvas host. Hosted Canvas
 * lives at *.instructure.com; self-hosted installs are almost always at a
 * "canvas." subdomain. The real proof is the token test the connect route runs.
 */
export function looksLikeCanvasHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.includes("canvas") || host.includes("instructure");
}

/** First page of the active-courses listing for a normalized base URL. */
export function activeCoursesUrl(baseUrl: string): string {
  return `${baseUrl}/api/v1/courses?enrollment_state=active&per_page=100`;
}

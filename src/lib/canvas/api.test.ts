import { describe, expect, it } from "vitest";
import {
  activeCoursesUrl,
  looksLikeCanvasHost,
  mapCanvasCourse,
  normalizeCanvasBaseUrl,
  parseLinkHeader,
  type CanvasCourse,
} from "@/lib/canvas/api";

describe("parseLinkHeader", () => {
  it("returns an empty result for missing headers", () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader(undefined)).toEqual({});
    expect(parseLinkHeader("")).toEqual({});
  });

  it("extracts the rel=next URL from a realistic Canvas header", () => {
    const header =
      '<https://canvas.example.edu/api/v1/courses?page=2&per_page=100>; rel="current",' +
      '<https://canvas.example.edu/api/v1/courses?page=3&per_page=100>; rel="next",' +
      '<https://canvas.example.edu/api/v1/courses?page=1&per_page=100>; rel="first",' +
      '<https://canvas.example.edu/api/v1/courses?page=9&per_page=100>; rel="last"';
    expect(parseLinkHeader(header)).toEqual({
      next: "https://canvas.example.edu/api/v1/courses?page=3&per_page=100",
    });
  });

  it("returns no next on the last page", () => {
    const header =
      '<https://canvas.example.edu/api/v1/courses?page=9>; rel="current",' +
      '<https://canvas.example.edu/api/v1/courses?page=1>; rel="first",' +
      '<https://canvas.example.edu/api/v1/courses?page=9>; rel="last"';
    expect(parseLinkHeader(header)).toEqual({});
  });

  it("tolerates unquoted rel values and extra whitespace", () => {
    expect(
      parseLinkHeader('<https://c.edu/api/v1/courses?page=2> ;  rel=next')
    ).toEqual({ next: "https://c.edu/api/v1/courses?page=2" });
  });

  it("keeps the first next when duplicates appear", () => {
    const header =
      '<https://c.edu/x?page=2>; rel="next", <https://c.edu/x?page=5>; rel="next"';
    expect(parseLinkHeader(header).next).toBe("https://c.edu/x?page=2");
  });

  it("ignores malformed segments", () => {
    expect(parseLinkHeader('garbage, still-garbage; rel="next"')).toEqual({});
  });
});

describe("mapCanvasCourse", () => {
  const available: CanvasCourse = {
    id: 4242,
    name: "Intro to Computer Science",
    course_code: "CS 101",
    workflow_state: "available",
  };

  it("maps an available course to code/title/canvas_course_id", () => {
    expect(mapCanvasCourse(available)).toEqual({
      code: "CS 101",
      title: "Intro to Computer Science",
      canvas_course_id: 4242,
    });
  });

  it("trims whitespace from code and title", () => {
    expect(
      mapCanvasCourse({ ...available, course_code: "  CS 101 ", name: " Intro  " })
    ).toEqual({ code: "CS 101", title: "Intro", canvas_course_id: 4242 });
  });

  it("falls back to the code when the name is missing or blank", () => {
    expect(mapCanvasCourse({ ...available, name: undefined })?.title).toBe(
      "CS 101"
    );
    expect(mapCanvasCourse({ ...available, name: "   " })?.title).toBe("CS 101");
  });

  it("returns null when course_code is missing or empty", () => {
    expect(mapCanvasCourse({ ...available, course_code: undefined })).toBeNull();
    expect(mapCanvasCourse({ ...available, course_code: null })).toBeNull();
    expect(mapCanvasCourse({ ...available, course_code: "   " })).toBeNull();
  });

  it("returns null for date-restricted stub courses", () => {
    expect(
      mapCanvasCourse({ id: 7, access_restricted_by_date: true })
    ).toBeNull();
    // Even a fully populated payload is skipped when restricted.
    expect(
      mapCanvasCourse({ ...available, access_restricted_by_date: true })
    ).toBeNull();
  });

  it("returns null unless workflow_state is exactly 'available'", () => {
    expect(
      mapCanvasCourse({ ...available, workflow_state: "unpublished" })
    ).toBeNull();
    expect(
      mapCanvasCourse({ ...available, workflow_state: "completed" })
    ).toBeNull();
    expect(
      mapCanvasCourse({ ...available, workflow_state: "deleted" })
    ).toBeNull();
    expect(
      mapCanvasCourse({ ...available, workflow_state: undefined })
    ).toBeNull();
  });
});

describe("normalizeCanvasBaseUrl", () => {
  it("strips trailing slashes and paths down to the origin", () => {
    expect(normalizeCanvasBaseUrl("https://canvas.university.edu/")).toBe(
      "https://canvas.university.edu"
    );
    expect(
      normalizeCanvasBaseUrl("https://canvas.university.edu/courses/42?x=1")
    ).toBe("https://canvas.university.edu");
  });

  it("assumes https when the scheme is omitted", () => {
    expect(normalizeCanvasBaseUrl("canvas.university.edu")).toBe(
      "https://canvas.university.edu"
    );
  });

  it("rejects non-https schemes", () => {
    expect(normalizeCanvasBaseUrl("http://canvas.university.edu")).toBeNull();
    expect(normalizeCanvasBaseUrl("ftp://canvas.university.edu")).toBeNull();
  });

  it("rejects empty and malformed input", () => {
    expect(normalizeCanvasBaseUrl("")).toBeNull();
    expect(normalizeCanvasBaseUrl("   ")).toBeNull();
    expect(normalizeCanvasBaseUrl("not a url")).toBeNull();
    expect(normalizeCanvasBaseUrl("https://canvas")).toBeNull();
  });
});

describe("looksLikeCanvasHost", () => {
  it("accepts canvas subdomains and hosted instructure domains", () => {
    expect(looksLikeCanvasHost("https://canvas.university.edu")).toBe(true);
    expect(looksLikeCanvasHost("https://university.instructure.com")).toBe(true);
  });

  it("rejects hosts with no canvas signal and malformed URLs", () => {
    expect(looksLikeCanvasHost("https://blackboard.university.edu")).toBe(false);
    expect(looksLikeCanvasHost("not a url")).toBe(false);
  });
});

describe("activeCoursesUrl", () => {
  it("builds the first page of the active-courses listing", () => {
    expect(activeCoursesUrl("https://canvas.university.edu")).toBe(
      "https://canvas.university.edu/api/v1/courses?enrollment_state=active&per_page=100"
    );
  });
});

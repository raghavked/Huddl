import { describe, expect, it } from "vitest";
import {
  buildPlan,
  toPlanKind,
  type PlanItem,
  type PlanKind,
} from "@/lib/study-plan";

const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed Wednesday at noon local time. Mid-June dodges DST transitions.
const NOW = new Date(2026, 5, 17, 12, 0, 0);

function item(
  id: string,
  dueAt: Date,
  overrides?: Partial<Pick<PlanItem, "courseCode" | "kind" | "title">>
): PlanItem {
  return {
    id,
    courseCode: overrides?.courseCode ?? "ECS 36A",
    kind: overrides?.kind ?? "assignment",
    title: overrides?.title ?? `Item ${id}`,
    dueAt,
  };
}

describe("toPlanKind", () => {
  it("passes known kinds through and narrows unknowns to other", () => {
    const known: PlanKind[] = [
      "assignment",
      "exam",
      "quiz",
      "lecture",
      "reading",
      "project",
      "other",
    ];
    for (const kind of known) expect(toPlanKind(kind)).toBe(kind);
    expect(toPlanKind("surprise")).toBe("other");
    expect(toPlanKind("")).toBe("other");
  });
});

describe("buildPlan: grouping", () => {
  it("buckets entries into ordered groups and drops empty ones", () => {
    const plan = buildPlan(
      [
        item("later", new Date(NOW.getTime() + 20 * DAY_MS)),
        item("overdue", new Date(NOW.getTime() - 2 * DAY_MS)),
        item("today", new Date(2026, 5, 17, 23, 59)),
        item("tomorrow", new Date(2026, 5, 18, 23, 59)),
        item("week", new Date(2026, 5, 21, 23, 59)),
      ],
      new Set(),
      NOW
    );
    expect(plan.groups.map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "Tomorrow",
      "This week",
      "Later",
    ]);
    expect(plan.groups.map((g) => g.entries.map((e) => e.id))).toEqual([
      ["overdue"],
      ["today"],
      ["tomorrow"],
      ["week"],
      ["later"],
    ]);
  });

  it("counts earlier today as overdue, later today as Today", () => {
    const plan = buildPlan(
      [
        item("morning", new Date(2026, 5, 17, 9, 0)),
        item("tonight", new Date(2026, 5, 17, 23, 59)),
      ],
      new Set(),
      NOW
    );
    expect(plan.groups.map((g) => g.label)).toEqual(["Overdue", "Today"]);
  });

  it("puts the seventh day out under Later, the sixth under This week", () => {
    const plan = buildPlan(
      [
        item("six", new Date(2026, 5, 23, 23, 59)),
        item("seven", new Date(2026, 5, 24, 23, 59)),
      ],
      new Set(),
      NOW
    );
    expect(plan.groups.map((g) => g.label)).toEqual(["This week", "Later"]);
  });

  it("sorts by due date with course/title/id tiebreaks so order never jitters", () => {
    const due = new Date(2026, 5, 20, 23, 59);
    const plan = buildPlan(
      [
        item("b", due, { courseCode: "PHY 9A", title: "Same" }),
        item("a", due, { courseCode: "ECS 36A", title: "Same" }),
        item("c", due, { courseCode: "ECS 36A", title: "Another" }),
      ],
      new Set(),
      NOW
    );
    expect(plan.groups[0]!.entries.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

describe("buildPlan: stats", () => {
  it("counts handled items and surfaces the earliest unhandled as nextUp", () => {
    const overdue = item("1", new Date(NOW.getTime() - DAY_MS));
    const soon = item("2", new Date(NOW.getTime() + DAY_MS));
    const later = item("3", new Date(NOW.getTime() + 3 * DAY_MS));
    const plan = buildPlan([soon, later, overdue], new Set(["1"]), NOW);
    expect(plan.stats.handled).toBe(1);
    expect(plan.stats.total).toBe(3);
    // "1" is checked off, so the next unhandled by due date is "2".
    expect(plan.stats.nextUp?.id).toBe("2");
  });

  it("includes overdue items in nextUp: catching up comes first", () => {
    const overdue = item("late", new Date(NOW.getTime() - DAY_MS));
    const soon = item("soon", new Date(NOW.getTime() + DAY_MS));
    const plan = buildPlan([soon, overdue], new Set(), NOW);
    expect(plan.stats.nextUp?.id).toBe("late");
  });

  it("omits nextUp when everything is handled, and on an empty plan", () => {
    const only = item("1", new Date(NOW.getTime() + DAY_MS));
    expect(buildPlan([only], new Set(["1"]), NOW).stats.nextUp).toBeUndefined();
    const empty = buildPlan([], new Set(), NOW);
    expect(empty.stats).toEqual({ handled: 0, total: 0 });
    expect(empty.groups).toEqual([]);
  });
});

describe("buildPlan: study blocks", () => {
  it("gives an exam due in 10 days all three blocks at −7/−3/−1 days", () => {
    const due = new Date(NOW.getTime() + 10 * DAY_MS);
    const exam = item("mid", due, { kind: "exam", title: "Midterm 1" });
    const plan = buildPlan([exam], new Set(), NOW);
    const blocks = plan.groups[0]!.entries[0]!.studyBlocks;
    expect(blocks?.map((b) => b.n)).toEqual([1, 2, 3]);
    expect(blocks?.map((b) => b.at.getTime())).toEqual([
      due.getTime() - 7 * DAY_MS,
      due.getTime() - 3 * DAY_MS,
      due.getTime() - 1 * DAY_MS,
    ]);
    expect(blocks?.[0]?.key).toBe("study:mid:1");
    expect(blocks?.[1]?.label).toBe("Study block 2 of 3: ECS 36A Midterm 1");
  });

  it("skips blocks already in the past but keeps their n-of-3 position", () => {
    // Due in 2 days: the −7d block has passed, −3d has passed, −1d remains.
    const due = new Date(NOW.getTime() + 2 * DAY_MS);
    const quiz = item("q", due, { kind: "quiz" });
    const plan = buildPlan([quiz], new Set(), NOW);
    const blocks = plan.groups[0]!.entries[0]!.studyBlocks;
    expect(blocks?.map((b) => b.n)).toEqual([3]);
  });

  it("suggests nothing for non-exam kinds, far-out exams, or past exams", () => {
    const soonDue = new Date(NOW.getTime() + 5 * DAY_MS);
    const hw = item("hw", soonDue, { kind: "assignment" });
    const far = item("far", new Date(NOW.getTime() + 15 * DAY_MS), {
      kind: "exam",
    });
    const past = item("past", new Date(NOW.getTime() - DAY_MS), {
      kind: "exam",
    });
    const plan = buildPlan([hw, far, past], new Set(), NOW);
    for (const group of plan.groups) {
      for (const entry of group.entries) {
        expect(entry.studyBlocks).toBeUndefined();
      }
    }
  });
});

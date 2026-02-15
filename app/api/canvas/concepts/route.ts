import { NextResponse } from "next/server";
export const runtime = "nodejs";

interface ConceptualUnitsResult {
  courseId: string;
  courseName: string;
  className?: string;
  units: unknown[];
  warning?: string;
}

interface FailedCourse {
  courseId: string;
  error: string;
}

function toCourseIds(body: Record<string, unknown>): string[] {
  const singleCourseId = body?.courseId;
  if (Array.isArray(body?.courseIds)) {
    return body.courseIds
      .map((id: unknown) => String(id || "").trim())
      .filter(Boolean);
  }
  return singleCourseId != null
    ? [String(singleCourseId).trim()].filter(Boolean)
    : [];
}

function toCourseNameMap(body: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const providedCourses = Array.isArray(body?.courses) ? body.courses : [];
  for (const course of providedCourses) {
    if (!course || typeof course !== "object") continue;
    const row = course as Record<string, unknown>;
    const courseId = typeof row.courseId === "string" ? row.courseId.trim() : "";
    const className = typeof row.className === "string" ? row.className.trim() : "";
    if (courseId) {
      map.set(courseId, className);
    }
  }
  return map;
}

function toTimeoutMs(): number {
  const parsed = Number(process.env.CONCEPT_GENERATION_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 600000;
  return Math.floor(parsed);
}

async function loadConceptScripts() {
  const mod = await import("@/scripts/listConceptualUnits");
  const run = (mod.run ?? mod.default?.run) as
    | ((options: Record<string, unknown>) => Promise<ConceptualUnitsResult>)
    | undefined;
  const runMany = (mod.runMany ?? mod.default?.runMany) as
    | ((options: Record<string, unknown>) => Promise<ConceptualUnitsResult[]>)
    | undefined;
  const writeSelected = (mod.writeSelectedCoursesToClassNamesJson ?? mod.default?.writeSelectedCoursesToClassNamesJson) as
    | ((courses: ConceptualUnitsResult[]) => void)
    | undefined;

  if (!run || !runMany || !writeSelected) {
    throw new Error("Concept scripts are not available");
  }

  return { run, runMany, writeSelected };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  const courseName = searchParams.get("courseName") ?? "";

  try {
    const { run } = await loadConceptScripts();
    const data = await run({
      courseId,
      className: courseName,
      writeFile: false,
      timeoutMs: toTimeoutMs(),
    });
    return NextResponse.json({ courseId: data.courseId || null, courseName: data.courseName, units: data.units });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to run concept generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const courseIds = toCourseIds(body);
    if (courseIds.length === 0) {
      return NextResponse.json({ error: "Missing courseId or courseIds" }, { status: 400 });
    }

    const nameByCourseId = toCourseNameMap(body);
    const timeoutMs = toTimeoutMs();
    const { run, writeSelected } = await loadConceptScripts();

    const settled = await Promise.allSettled(
      courseIds.map((id) =>
        run({
          courseId: id,
          className: nameByCourseId.get(id) ?? "",
          writeFile: false,
          timeoutMs,
        })
      )
    );

    const courses: ConceptualUnitsResult[] = [];
    const failedCourses: FailedCourse[] = [];
    settled.forEach((result, index) => {
      const courseId = courseIds[index];
      if (result.status === "fulfilled") {
        courses.push(result.value);
        return;
      }
      failedCourses.push({
        courseId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason || "Unknown error"),
      });
    });

    courses.forEach((course) => {
      if (!Array.isArray(course.units) || course.units.length === 0) {
        failedCourses.push({
          courseId: course.courseId,
          error: "No conceptual units returned yet",
        });
      }
    });

    if (failedCourses.length > 0) {
      console.error("/api/canvas/concepts failed courses", failedCourses);
      return NextResponse.json(
        {
          error: "Concept preparation is still in progress or failed for one or more courses",
          failedCourses,
        },
        { status: 500 }
      );
    }

    const coursesById = new Map(courses.map((course) => [course.courseId, course]));
    const selectedCourses = courseIds.map((id) => {
      const generated = coursesById.get(id);
      if (generated) {
        return {
          ...generated,
          className: nameByCourseId.get(id) || generated.className || generated.courseName || id,
        } satisfies ConceptualUnitsResult;
      }
      return {
        courseId: id,
        courseName: nameByCourseId.get(id) || id,
        className: nameByCourseId.get(id) || id,
        units: [],
      } satisfies ConceptualUnitsResult;
    });

    writeSelected(selectedCourses);

    if (selectedCourses.length === 1) {
      return NextResponse.json({
        courseId: selectedCourses[0].courseId,
        courseName: selectedCourses[0].courseName,
        units: selectedCourses[0].units,
        failedCourses,
      });
    }

    return NextResponse.json({
      courses: selectedCourses.map((course) => ({
        courseId: course.courseId,
        courseName: course.courseName,
        units: course.units,
      })),
      failedCourses,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to run concept generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

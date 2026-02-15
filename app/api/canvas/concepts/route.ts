/**
 * Conceptual units (lesson plan: units → topics → subtopics) from RAG backend.
 * Uses Canvas course_id. Run build_lesson_plan.py and tag_chunks.py for the course first.
 * On each call, writes the result to public/concepts.json for the frontend.
 *
 * GET  /api/canvas/concepts?courseId=...
 * POST /api/canvas/concepts { courseId: string } | { courseIds: string[] }
 * Returns { courseId, courseName, units } (single) or { courses } (multiple).
 */
import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const INGESTION_DIR = path.join(ROOT, "ingestion");
const CONCEPTS_JSON_PATH = path.join(ROOT, "public", "concepts.json");

interface ConceptualUnitsResult {
  courseId: string;
  courseName: string;
  units: unknown[];
}

function getConceptualUnits(courseId: string): ConceptualUnitsResult {
  if (!courseId || typeof courseId !== "string") {
    return { courseId: courseId || "", courseName: "", units: [] };
  }
  const result = spawnSync(
    "python",
    ["list_units.py", "--course-id", courseId.trim(), "--conceptual", "--json"],
    { cwd: INGESTION_DIR, encoding: "utf8", timeout: 60000 }
  );
  if (result.error || result.status !== 0) {
    return { courseId: courseId.trim(), courseName: "", units: [] };
  }
  try {
    const out = (result.stdout || "").trim();
    const parsed = out ? (JSON.parse(out) as Record<string, unknown>) : null;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.units)) {
      return {
        courseId: (parsed.courseId as string) ?? courseId.trim(),
        courseName: typeof parsed.courseName === "string" ? parsed.courseName : "",
        units: parsed.units,
      };
    }
    if (Array.isArray(parsed)) {
      return { courseId: courseId.trim(), courseName: "", units: parsed };
    }
    return { courseId: courseId.trim(), courseName: "", units: [] };
  } catch {
    return { courseId: courseId.trim(), courseName: "", units: [] };
  }
}

function writeConceptsToFile(payload: Record<string, unknown>): void {
  try {
    const dir = path.dirname(CONCEPTS_JSON_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const toWrite = { ...payload, updatedAt: new Date().toISOString() };
    fs.writeFileSync(CONCEPTS_JSON_PATH, JSON.stringify(toWrite, null, 2), "utf8");
  } catch (err) {
    console.error("Could not write concepts.json:", err instanceof Error ? err.message : err);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  const data = getConceptualUnits(courseId);
  const payload = { courseId: data.courseId || null, courseName: data.courseName, units: data.units };
  writeConceptsToFile(payload);
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const courseId = body?.courseId;
    const courseIds = Array.isArray(body?.courseIds)
      ? body.courseIds
      : courseId != null
        ? [String(courseId)]
        : [];
    if (courseIds.length === 0) {
      return NextResponse.json({ error: "Missing courseId or courseIds" }, { status: 400 });
    }
    const courses = courseIds.map((id: string) => getConceptualUnits(id));
    const payload =
      courses.length === 1
        ? { courseId: courses[0].courseId, courseName: courses[0].courseName, units: courses[0].units }
        : { courses: courses.map((c) => ({ courseId: c.courseId, courseName: c.courseName, units: c.units })) };
    writeConceptsToFile(payload);
    return NextResponse.json(
      courses.length === 1
        ? { courseId: payload.courseId, courseName: payload.courseName, units: payload.units }
        : { courses: payload.courses }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load concepts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

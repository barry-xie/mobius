import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const INGESTION_DIR = path.join(ROOT, "ingestion");
const CLASSNAMES_JSON_PATH = path.join(ROOT, "public", "classNames.json");

interface ConceptualUnitsResult {
  courseId: string;
  courseName: string;
  units: unknown[];
  updatedAt?: string;
}

const PYTHON_CANDIDATES: Array<{ command: string; argsPrefix: string[] }> = [
  { command: "python", argsPrefix: [] },
  { command: "python3", argsPrefix: [] },
  { command: "py", argsPrefix: ["-3"] },
];

function parseConceptPayload(rawOutput: string): ConceptualUnitsResult {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new Error("Concept generation returned empty output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/(\{[\s\S]*\})\s*$/);
    if (!match) throw new Error("Concept generation returned invalid JSON");
    parsed = JSON.parse(match[1]);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Concept generation returned unexpected payload");
  }

  const result = parsed as Record<string, unknown>;
  return {
    courseId: typeof result.courseId === "string" ? result.courseId : "",
    courseName: typeof result.courseName === "string" ? result.courseName : "",
    units: Array.isArray(result.units) ? result.units : [],
    updatedAt: typeof result.updatedAt === "string" ? result.updatedAt : undefined,
  };
}

function runConceptGeneration(courseId: string, courseName = ""): ConceptualUnitsResult {
  const trimmedId = courseId.trim();
  if (!trimmedId) {
    throw new Error("Missing courseId");
  }

  const trimmedName = courseName.trim();
  let lastError = "Unable to execute concept generation";

  for (const candidate of PYTHON_CANDIDATES) {
    const args = [
      ...candidate.argsPrefix,
      "run_concept_generation.py",
      "--course-id",
      trimmedId,
      ...(trimmedName ? ["--course-name", trimmedName] : []),
      "--json",
    ];

    const result = spawnSync(candidate.command, args, {
      cwd: INGESTION_DIR,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
    });

    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw result.error;
    }

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      lastError = stderr || `Concept generation failed for course ${trimmedId}`;
      throw new Error(lastError);
    }

    return parseConceptPayload(result.stdout || "");
  }

  throw new Error(lastError);
}

function writeSelectedCoursesToClassNamesJson(courses: ConceptualUnitsResult[]): void {
  const classes = courses.map((course) => ({
    courseId: course.courseId,
    className: course.courseName?.trim() || course.courseId,
    units: Array.isArray(course.units) ? course.units : [],
  }));

  const classNames = [...new Set(classes.map((course) => course.className).filter(Boolean))];
  const payload = {
    classes,
    classNames,
    updatedAt: new Date().toISOString(),
  };

  const dir = path.dirname(CLASSNAMES_JSON_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLASSNAMES_JSON_PATH, JSON.stringify(payload, null, 2), "utf8");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  const courseName = searchParams.get("courseName") ?? "";

  try {
    const data = runConceptGeneration(courseId, courseName);
    return NextResponse.json({ courseId: data.courseId || null, courseName: data.courseName, units: data.units });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to run concept generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const courseId = body?.courseId;
    const courseIds: string[] = Array.isArray(body?.courseIds)
      ? body.courseIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : courseId != null
        ? [String(courseId).trim()].filter(Boolean)
        : [];
    if (courseIds.length === 0) {
      return NextResponse.json({ error: "Missing courseId or courseIds" }, { status: 400 });
    }

    const providedCourses = Array.isArray(body?.courses)
      ? body.courses
      : [];

    const nameByCourseId = new Map<string, string>();
    for (const course of providedCourses) {
      if (!course || typeof course !== "object") continue;
      const record = course as Record<string, unknown>;
      const id = typeof record.courseId === "string" ? record.courseId.trim() : "";
      const name = typeof record.className === "string" ? record.className.trim() : "";
      if (id) nameByCourseId.set(id, name);
    }

    const courses: ConceptualUnitsResult[] = courseIds.map((id: string) =>
      runConceptGeneration(id, nameByCourseId.get(id) ?? "")
    );

    writeSelectedCoursesToClassNamesJson(courses);

    if (courses.length === 1) {
      return NextResponse.json({
        courseId: courses[0].courseId,
        courseName: courses[0].courseName,
        units: courses[0].units,
      });
    }

    return NextResponse.json({
      courses: courses.map((c) => ({ courseId: c.courseId, courseName: c.courseName, units: c.units })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to run concept generation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const { runPythonJson } = require("./pythonInterop");

const REPO_ROOT = path.join(__dirname, "..");
const CLASSNAMES_JSON_PATH = path.join(REPO_ROOT, "public", "classNames.json");

function normalizeTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeConceptualPayload(courseId, payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      courseId: typeof payload.courseId === "string" && payload.courseId.trim() ? payload.courseId.trim() : courseId,
      courseName: typeof payload.courseName === "string" ? payload.courseName : "",
      units: Array.isArray(payload.units) ? payload.units : [],
    };
  }

  if (Array.isArray(payload)) {
    return {
      courseId,
      courseName: "",
      units: payload,
    };
  }

  return {
    courseId,
    courseName: "",
    units: [],
  };
}

function writeSelectedCoursesToClassNamesJson(courses, options = {}) {
  const outputPath = options.outputPath || CLASSNAMES_JSON_PATH;
  const classes = (Array.isArray(courses) ? courses : [])
    .map((course) => ({
      courseId: String(course?.courseId || "").trim(),
      className: String(course?.className || course?.courseName || course?.courseId || "").trim(),
      units: Array.isArray(course?.units) ? course.units : [],
    }))
    .filter((course) => course.courseId && course.className);

  const classNames = [...new Set(classes.map((course) => course.className).filter(Boolean))];
  const payload = {
    classes,
    classNames,
    updatedAt: new Date().toISOString(),
  };

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function run(options = {}) {
  const courseId = String(options.courseId || "").trim();
  if (!courseId) {
    throw new Error("Missing courseId");
  }

  const timeoutMs = normalizeTimeout(options.timeoutMs, 180000);
  const requestedClassName = String(options.className || "").trim();
  console.log(`[listConceptualUnits] start courseId=${courseId} timeoutMs=${timeoutMs}`);

  const startedAt = Date.now();
  const payload = await runPythonJson(
    "list_units.py",
    ["--course-id", courseId, "--conceptual", "--json"],
    { timeoutMs }
  );
  console.log(`[listConceptualUnits] list_units.py completed in ${Date.now() - startedAt}ms for courseId=${courseId}`);

  const normalized = normalizeConceptualPayload(courseId, payload);
  const courseName = normalized.courseName || requestedClassName || courseId;

  const result = {
    courseId: normalized.courseId || courseId,
    courseName,
    className: courseName,
    units: Array.isArray(normalized.units) ? normalized.units : [],
  };

  if (options.writeFile) {
    console.log(`[listConceptualUnits] writing classNames.json for courseId=${result.courseId}`);
    writeSelectedCoursesToClassNamesJson([result], { outputPath: options.outputPath });
    console.log(`[listConceptualUnits] wrote classNames.json for courseId=${result.courseId}`);
  }

  console.log(`[listConceptualUnits] done courseId=${result.courseId} units=${result.units.length}`);

  return result;
}

async function runMany(options = {}) {
  const courses = Array.isArray(options.courses) ? options.courses : [];
  const timeoutMs = normalizeTimeout(options.timeoutMs, 180000);
  console.log(`[listConceptualUnits] runMany start courses=${courses.length} timeoutMs=${timeoutMs}`);

  const results = await Promise.all(
    courses.map((course) =>
      run({
        courseId: course?.courseId,
        className: course?.className,
        timeoutMs,
      })
    )
  );

  if (options.writeFile) {
    console.log(`[listConceptualUnits] writing classNames.json for ${results.length} courses`);
    writeSelectedCoursesToClassNamesJson(results, { outputPath: options.outputPath });
    console.log(`[listConceptualUnits] wrote classNames.json for ${results.length} courses`);
  }

  console.log(`[listConceptualUnits] runMany done courses=${results.length}`);

  return results;
}

module.exports = {
  run,
  runMany,
  writeSelectedCoursesToClassNamesJson,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const courseIndex = args.indexOf("--course-id");
  const classNameIndex = args.indexOf("--class-name");
  const courseId = courseIndex >= 0 ? String(args[courseIndex + 1] || "").trim() : "";
  const className = classNameIndex >= 0 ? String(args[classNameIndex + 1] || "").trim() : "";
  const asJson = args.includes("--json");
  const writeFile = args.includes("--write");

  run({ courseId, className, writeFile })
    .then((result) => {
      if (asJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      const displayName = result.courseName.trim() || result.courseId;
      process.stdout.write(`Course ${displayName} – ${result.units.length} conceptual unit(s)\n`);
      if (writeFile) {
        process.stdout.write(`Updated ${CLASSNAMES_JSON_PATH}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message || error}\n`);
      process.exit(1);
    });
}

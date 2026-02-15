/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const { runPythonJson } = require("./pythonInterop");
const { run: listConceptualUnits } = require("./listConceptualUnits");

const REPO_ROOT = path.join(__dirname, "..");
const CLASSNAMES_JSON_PATH = path.join(REPO_ROOT, "public", "classNames.json");

function normalizeTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function loadClassNamesJson(filePath = CLASSNAMES_JSON_PATH) {
  try {
    if (!fs.existsSync(filePath)) {
      return { classes: [], classNames: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && Array.isArray(parsed.classes)) {
      return {
        classes: parsed.classes,
        classNames: Array.isArray(parsed.classNames) ? parsed.classNames : [],
      };
    }
  } catch {
    // ignore malformed file
  }
  return { classes: [], classNames: [] };
}

function mergeCourseIntoClassNames(course, options = {}) {
  const outputPath = options.outputPath || CLASSNAMES_JSON_PATH;
  const updatedAt = options.updatedAt || new Date().toISOString();
  const existing = loadClassNamesJson(outputPath);
  const classes = Array.isArray(existing.classes) ? [...existing.classes] : [];

  const courseId = String(course.courseId || "").trim();
  const className = String(course.courseName || course.className || courseId).trim() || courseId;
  const units = Array.isArray(course.units) ? course.units : [];
  const nextEntry = { courseId, className, units };

  const idx = classes.findIndex((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return String(entry.courseId || "") === courseId || String(entry.className || "").trim() === className;
  });
  if (idx >= 0) {
    classes[idx] = { ...classes[idx], ...nextEntry };
  } else {
    classes.push(nextEntry);
  }

  const classNames = [...new Set(classes.map((entry) => String(entry?.className || "").trim()).filter(Boolean))];
  const payload = { classes, classNames, updatedAt };

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function writeSelectedCoursesToClassNamesJson(courses, options = {}) {
  const outputPath = options.outputPath || CLASSNAMES_JSON_PATH;
  const classes = (Array.isArray(courses) ? courses : []).map((course) => ({
    courseId: String(course?.courseId || "").trim(),
    className: String(course?.courseName || course?.className || course?.courseId || "").trim(),
    units: Array.isArray(course?.units) ? course.units : [],
  })).filter((course) => course.courseId && course.className);

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

  const courseName = String(options.courseName || "").trim();
  const batchSize = Number.isFinite(options.batchSize) ? Math.max(1, Number(options.batchSize)) : 10;
  const timeoutMs = normalizeTimeout(options.timeoutMs, 600000);
  const lookupTimeoutMs = normalizeTimeout(options.lookupTimeoutMs, timeoutMs);
  const allowExistingFallback = options.allowExistingFallback !== false;
  const preferExisting = options.preferExisting !== false;

  let existingLookupError = null;
  let generationError = null;

  if (preferExisting) {
    try {
      const conceptual = await listConceptualUnits({ courseId, timeoutMs: lookupTimeoutMs });
      if (Array.isArray(conceptual.units) && conceptual.units.length > 0) {
        const payload = {
          courseId: conceptual.courseId || courseId,
          courseName: conceptual.courseName || courseName || courseId,
          units: conceptual.units,
          updatedAt: new Date().toISOString(),
        };

        if (options.writeFile !== false) {
          mergeCourseIntoClassNames(payload, { outputPath: options.outputPath, updatedAt: payload.updatedAt });
        }

        return payload;
      }
    } catch (error) {
      existingLookupError = error;
    }
  }

  try {
    const plan = await runPythonJson(
      "build_lesson_plan.py",
      ["--course-id", courseId, ...(courseName ? ["--course-name", courseName] : []), "--json"],
      { timeoutMs }
    );

    const unitsPlan = Array.isArray(plan?.units) ? plan.units : [];
    if (unitsPlan.length === 0) {
      throw new Error("Failed to build a lesson plan (no units)");
    }

    const tagResult = await runPythonJson(
      "tag_chunks.py",
      ["--course-id", courseId, "--batch-size", String(batchSize), "--json"],
      { timeoutMs }
    );
    if (tagResult && typeof tagResult === "object" && tagResult.error) {
      throw new Error(String(tagResult.error));
    }

    const conceptual = await listConceptualUnits({ courseId, timeoutMs });
    const payload = {
      courseId: conceptual.courseId || courseId,
      courseName: conceptual.courseName || courseName || courseId,
      units: Array.isArray(conceptual.units) ? conceptual.units : [],
      updatedAt: new Date().toISOString(),
    };

    if (options.writeFile !== false) {
      mergeCourseIntoClassNames(payload, { outputPath: options.outputPath, updatedAt: payload.updatedAt });
    }

    return payload;
  } catch (error) {
    generationError = error;
  }

  if (allowExistingFallback) {
    let fallbackPayload = {
      courseId,
      courseName: courseName || courseId,
      units: [],
    };
    let fallbackError = "";

    try {
      const conceptual = await listConceptualUnits({ courseId, timeoutMs: Math.max(lookupTimeoutMs, 60000) });
      fallbackPayload = {
        courseId: conceptual.courseId || courseId,
        courseName: conceptual.courseName || courseName || courseId,
        units: Array.isArray(conceptual.units) ? conceptual.units : [],
      };
    } catch (error) {
      fallbackError = error instanceof Error ? error.message : String(error || "Unknown fallback error");
    }

    const warningParts = [];
    if (existingLookupError) {
      warningParts.push(
        `Initial list_units failed: ${existingLookupError instanceof Error ? existingLookupError.message : String(existingLookupError)}`
      );
    }
    if (generationError) {
      warningParts.push(generationError instanceof Error ? generationError.message : String(generationError));
    }
    if (fallbackError) {
      warningParts.push(`Fallback list_units failed: ${fallbackError}`);
    }

    const payload = {
      ...fallbackPayload,
      updatedAt: new Date().toISOString(),
      warning: warningParts.join(" | "),
    };

    if (options.writeFile !== false) {
      mergeCourseIntoClassNames(payload, { outputPath: options.outputPath, updatedAt: payload.updatedAt });
    }

    return payload;
  }

  throw generationError;
}

module.exports = {
  run,
  mergeCourseIntoClassNames,
  writeSelectedCoursesToClassNamesJson,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  const getFlagValue = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return "";
    return String(args[index + 1] || "").trim();
  };

  const courseId = getFlagValue("--course-id");
  const courseName = getFlagValue("--course-name");
  const batchSizeRaw = getFlagValue("--batch-size");
  const batchSize = batchSizeRaw ? Number(batchSizeRaw) : 10;
  const asJson = args.includes("--json");

  run({ courseId, courseName, batchSize })
    .then((payload) => {
      if (asJson) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      process.stdout.write(`Conceptual structure for ${payload.courseName || payload.courseId}\n`);
      for (const unit of payload.units || []) {
        process.stdout.write(`  ${unit.unit_id || "?"}: ${unit.unit_name || ""} (chunks: ${unit.chunk_count || 0})\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.message || error}\n`);
      process.exit(1);
    });
}

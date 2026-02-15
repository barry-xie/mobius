/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const DEFAULT_API_BASE = process.env.CANVAS_API_BASE || 'https://canvas.instructure.com/api/v1';

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function assertIdentifier(name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`Invalid Snowflake ${name}: ${value}`);
  }
  return value;
}

function buildPerKeyDatabaseName(prefix, canvasToken) {
  const safePrefix = assertIdentifier('database prefix', prefix).toUpperCase();
  const hash = crypto.createHash('sha256').update(canvasToken).digest('hex').slice(0, 16).toUpperCase();
  const databaseName = `${safePrefix}_${hash}`;
  if (databaseName.length > 255) {
    throw new Error('Derived Snowflake database name is too long');
  }
  return databaseName;
}

function toText(value) {
  return value == null ? '' : String(value);
}

function toTimestampBinding(value) {
  return value == null || value === '' ? null : String(value);
}

function toNumberBinding(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNumberTextBinding(value) {
  const num = toNumberBinding(value);
  return num == null ? null : String(num);
}

function rewriteAssignmentUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    u.hostname = 'canvas.vt.edu';
    u.pathname = u.pathname
      .replace(/\/courses\/(\d{11})(\d+)/, '/courses/$2')
      .replace(/\/assignments\/(.{5})([^/?#]*)/, '/assignments/$2');
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function cleanCanvasData(data) {
  const courses = Array.isArray(data?.courses) ? data.courses : [];
  for (const course of courses) {
    const assignments = Array.isArray(course?.assignments) ? course.assignments : [];
    for (const assignment of assignments) {
      assignment.html_url = rewriteAssignmentUrl(assignment.html_url);
    }
  }
  return data;
}

function getSnowflakeConfig(options = {}) {
  const tokenCandidate = (options.snowflakeToken || process.env.SNOWFLAKE_TOKEN || '').trim();
  const enabled = options.uploadToSnowflake !== undefined
    ? parseBool(options.uploadToSnowflake, false)
    : process.env.SNOWFLAKE_UPLOAD_ENABLED !== undefined
      ? parseBool(process.env.SNOWFLAKE_UPLOAD_ENABLED, false)
      : Boolean(tokenCandidate);
  if (!enabled) return { enabled: false };

  const host = (options.snowflakeHost || process.env.SNOWFLAKE_HOST || '').trim();
  const token = tokenCandidate;
  const tokenType = (options.snowflakeTokenType || process.env.SNOWFLAKE_TOKEN_TYPE || '').trim();
  const configuredDatabase = (options.snowflakeDatabase || process.env.SNOWFLAKE_DATABASE || '').trim();
  const databasePrefix = (options.snowflakeDatabasePrefix || process.env.SNOWFLAKE_DATABASE_PREFIX || 'CANVAS').trim();
  const databasePerKey = options.snowflakeDatabasePerKey !== undefined
    ? parseBool(options.snowflakeDatabasePerKey, true)
    : process.env.SNOWFLAKE_DATABASE_PER_KEY !== undefined
      ? parseBool(process.env.SNOWFLAKE_DATABASE_PER_KEY, true)
      : true;
  const canvasToken = (options.canvasToken || options.token || process.env.CANVAS_API || '').trim();
  const schema = (options.snowflakeSchema || process.env.SNOWFLAKE_SCHEMA || '').trim();
  const table = (options.snowflakeTable || process.env.SNOWFLAKE_TABLE || 'CANVAS_DATA').trim();
  const warehouse = (options.snowflakeWarehouse || process.env.SNOWFLAKE_WAREHOUSE || '').trim();
  const role = (options.snowflakeRole || process.env.SNOWFLAKE_ROLE || '').trim();

  let database = configuredDatabase;
  if (databasePerKey) {
    if (!canvasToken) {
      throw new Error('Missing Canvas API token for per-key Snowflake database naming');
    }
    database = buildPerKeyDatabaseName(databasePrefix, canvasToken);
  }

  if (!host || !token || !database || !schema || !warehouse) {
    throw new Error('Missing Snowflake config. Required: SNOWFLAKE_HOST, SNOWFLAKE_TOKEN, SNOWFLAKE_SCHEMA, SNOWFLAKE_WAREHOUSE and SNOWFLAKE_DATABASE or SNOWFLAKE_DATABASE_PREFIX');
  }

  return {
    enabled: true,
    endpoint: `https://${host}/api/v2/statements`,
    token,
    tokenType,
    database: assertIdentifier('database', database),
    schema: assertIdentifier('schema', schema),
    table: assertIdentifier('table', table),
    warehouse: assertIdentifier('warehouse', warehouse),
    role: role ? assertIdentifier('role', role) : '',
  };
}

async function executeSnowflakeStatement(config, statement, options = {}) {
  const body = {
    statement,
    timeout: options.timeout || 60,
    warehouse: config.warehouse,
  };

  const includeDatabase = options.includeDatabase !== false;
  const includeSchema = options.includeSchema !== false;

  if (includeDatabase) body.database = config.database;
  if (includeSchema) body.schema = config.schema;
  if (config.role) body.role = config.role;
  if (options.bindings) body.bindings = options.bindings;

  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (config.tokenType) {
    headers['X-Snowflake-Authorization-Token-Type'] = config.tokenType;
  }

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const detail = parsed ? JSON.stringify(parsed) : raw;
    throw new Error(`Snowflake statement failed (${res.status}): ${detail}`);
  }

  return parsed;
}

async function uploadCanvasDataToSnowflake(payload, options = {}) {
  const config = getSnowflakeConfig(options);
  if (!config.enabled) return null;

  await executeSnowflakeStatement(config, `CREATE DATABASE IF NOT EXISTS ${config.database}`, {
    includeDatabase: false,
    includeSchema: false,
  });

  await executeSnowflakeStatement(config, `CREATE SCHEMA IF NOT EXISTS ${config.database}.${config.schema}`, {
    includeSchema: false,
  });

  const RUNS_TABLE = `${config.table}_RUNS`;
  const COURSES_TABLE = `${config.table}_COURSES`;
  const ASSIGNMENTS_TABLE = `${config.table}_ASSIGNMENTS`;
  const FILES_TABLE = `${config.table}_FILES`;

  await executeSnowflakeStatement(
    config,
    `CREATE TABLE IF NOT EXISTS ${config.database}.${config.schema}.${RUNS_TABLE} (
      RUN_ID STRING,
      FETCHED_AT TIMESTAMP_TZ,
      ACTIVE_COURSE_COUNT NUMBER,
      LOADED_COURSE_COUNT NUMBER
    )`
  );

  await executeSnowflakeStatement(
    config,
    `CREATE TABLE IF NOT EXISTS ${config.database}.${config.schema}.${COURSES_TABLE} (
      RUN_ID STRING,
      COURSE_ID STRING,
      COURSE_NAME STRING,
      COURSE_CODE STRING,
      SYLLABUS STRING
    )`
  );

  await executeSnowflakeStatement(
    config,
    `CREATE TABLE IF NOT EXISTS ${config.database}.${config.schema}.${ASSIGNMENTS_TABLE} (
      RUN_ID STRING,
      COURSE_ID STRING,
      ASSIGNMENT_ID STRING,
      ASSIGNMENT_NAME STRING,
      DESCRIPTION STRING,
      DUE_AT TIMESTAMP_TZ,
      UNLOCK_AT TIMESTAMP_TZ,
      LOCK_AT TIMESTAMP_TZ,
      POINTS_POSSIBLE FLOAT,
      HTML_URL STRING
    )`
  );

  await executeSnowflakeStatement(
    config,
    `CREATE TABLE IF NOT EXISTS ${config.database}.${config.schema}.${FILES_TABLE} (
      RUN_ID STRING,
      COURSE_ID STRING,
      FILE_ID STRING,
      DISPLAY_NAME STRING,
      FILENAME STRING,
      URL STRING
    )`
  );

  const runId = crypto.randomUUID();
  const courses = Array.isArray(payload.courses) ? payload.courses : [];

  await executeSnowflakeStatement(
    config,
    `INSERT INTO ${config.database}.${config.schema}.${RUNS_TABLE}
      (RUN_ID, FETCHED_AT, ACTIVE_COURSE_COUNT, LOADED_COURSE_COUNT)
      SELECT ?, TO_TIMESTAMP_TZ(?), TO_NUMBER(?), TO_NUMBER(?)`,
    {
      bindings: {
        1: { type: 'TEXT', value: runId },
        2: { type: 'TEXT', value: String(payload.fetched_at || new Date().toISOString()) },
        3: { type: 'TEXT', value: String(Number(payload.active_course_count || 0)) },
        4: { type: 'TEXT', value: String(courses.length) },
      },
    }
  );

  for (const course of courses) {
    await executeSnowflakeStatement(
      config,
      `INSERT INTO ${config.database}.${config.schema}.${COURSES_TABLE}
        (RUN_ID, COURSE_ID, COURSE_NAME, COURSE_CODE, SYLLABUS)
        SELECT ?, ?, ?, ?, ?`,
      {
        bindings: {
          1: { type: 'TEXT', value: runId },
          2: { type: 'TEXT', value: toText(course.id) },
          3: { type: 'TEXT', value: toText(course.name) },
          4: { type: 'TEXT', value: toText(course.course_code) },
          5: { type: 'TEXT', value: toText(course.syllabus) },
        },
      }
    );

    const assignments = Array.isArray(course.assignments) ? course.assignments : [];
    const files = Array.isArray(course.files) ? course.files : [];

    for (const assignment of assignments) {
      await executeSnowflakeStatement(
        config,
        `INSERT INTO ${config.database}.${config.schema}.${ASSIGNMENTS_TABLE}
          (RUN_ID, COURSE_ID, ASSIGNMENT_ID, ASSIGNMENT_NAME, DESCRIPTION, DUE_AT, UNLOCK_AT, LOCK_AT, POINTS_POSSIBLE, HTML_URL)
          SELECT ?, ?, ?, ?, ?, TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), TO_DOUBLE(?), ?`,
        {
          bindings: {
            1: { type: 'TEXT', value: runId },
            2: { type: 'TEXT', value: toText(course.id) },
            3: { type: 'TEXT', value: toText(assignment.id) },
            4: { type: 'TEXT', value: toText(assignment.name) },
            5: { type: 'TEXT', value: toText(assignment.description) },
            6: { type: 'TEXT', value: toTimestampBinding(assignment.due_at) },
            7: { type: 'TEXT', value: toTimestampBinding(assignment.unlock_at) },
            8: { type: 'TEXT', value: toTimestampBinding(assignment.lock_at) },
            9: { type: 'TEXT', value: toNumberTextBinding(assignment.points_possible) },
            10: { type: 'TEXT', value: toText(assignment.html_url) },
          },
        }
      );
    }

    for (const file of files) {
      await executeSnowflakeStatement(
        config,
        `INSERT INTO ${config.database}.${config.schema}.${FILES_TABLE}
          (RUN_ID, COURSE_ID, FILE_ID, DISPLAY_NAME, FILENAME, URL)
          SELECT ?, ?, ?, ?, ?, ?`,
        {
          bindings: {
            1: { type: 'TEXT', value: runId },
            2: { type: 'TEXT', value: toText(course.id) },
            3: { type: 'TEXT', value: toText(file.id) },
            4: { type: 'TEXT', value: toText(file.display_name) },
            5: { type: 'TEXT', value: toText(file.filename) },
            6: { type: 'TEXT', value: toText(file.url) },
          },
        }
      );
    }
  }

  return { runId, coursesLoaded: courses.length };
}

function createCanvasClient(token, apiBase = DEFAULT_API_BASE) {
  if (!token) throw new Error('Missing CANVAS_API token');

  async function canvasGet(path, params = {}) {
    const url = new URL(`${apiBase}${path}`);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        if (Array.isArray(v)) {
          v.forEach((item) => url.searchParams.append(k, String(item)));
        } else {
          url.searchParams.append(k, String(v));
        }
      }
    });

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      const error = new Error(`Canvas API ${res.status} ${res.statusText} for ${url}: ${body}`);
      error.status = res.status;
      throw error;
    }

    return res.json();
  }

  async function getAllPages(path, params = {}) {
    let page = 1;
    const all = [];

    while (true) {
      const chunk = await canvasGet(path, { ...params, per_page: 100, page });
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < 100) break;
      page += 1;
    }

    return all;
  }

  async function safeGetAllPages(path, params = {}) {
    try {
      return await getAllPages(path, params);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
        console.warn(`Skipping endpoint (${err?.status}): ${path}`);
        return [];
      }
      throw err;
    }
  }

  async function fetchCanvasData() {
    let courses = await getAllPages('/courses', {
      'include[]': ['total_students', 'term'],
      'state[]': ['available', 'completed'],
    });

    if (courses.length === 0) {
      courses = await getAllPages('/courses');
    }

    const activeCourses = courses.filter((course) => {
      const validStates = ['available', 'completed'];
      if (course.workflow_state && !validStates.includes(course.workflow_state)) return false;
      return true;
    });

    const classesWithIds = [];

    for (const course of activeCourses) {
      const [assignments, files] = await Promise.all([
        safeGetAllPages(`/courses/${course.id}/assignments`),
        safeGetAllPages(`/courses/${course.id}/files`),
      ]);

      if (assignments.length > 0 || files.length > 0) {
        const name = toText(course.name).trim();
        if (name.length > 0) {
          classesWithIds.push({ courseId: String(course.id), className: name });
        }
      }
    }

    const seen = new Set();
    const unique = classesWithIds.filter((c) => {
      const key = c.courseId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      classes: unique,
      classNames: unique.map((c) => c.className),
    };
  }

  return { fetchCanvasData };
}

async function run(options = {}) {
  const token = (options.token || process.env.CANVAS_API || '').trim();
  const apiBase = (options.apiBase || process.env.CANVAS_API_BASE || DEFAULT_API_BASE).trim();
  const writeFile = options.writeFile !== false;
  const outputPath = options.outputPath || 'public/classNames.json';

  const client = createCanvasClient(token, apiBase);
  const result = await client.fetchCanvasData();

  if (writeFile) {
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  }

  return result;
}

module.exports = { run, createCanvasClient, uploadCanvasDataToSnowflake, rewriteAssignmentUrl, cleanCanvasData };

if (require.main === module) {
  run()
    .then((result) => {
      if (!result) return;
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

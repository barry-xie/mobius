const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('./getCanvas');

const PORT = 8080;
const ROOT = __dirname;
const INGESTION_DIR = path.join(ROOT, 'ingestion');
const CONCEPTS_JSON_PATH = path.join(ROOT, 'public', 'concepts.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * Call Python list_units.py --course-id <id> --conceptual --json.
 * Returns { courseId, courseName, units } or { courseId, courseName: '', units: [] } on error.
 */
function getConceptualUnits(courseId) {
  if (!courseId || typeof courseId !== 'string') {
    return { courseId: courseId || '', courseName: '', units: [] };
  }
  const result = spawnSync('python', ['list_units.py', '--course-id', courseId.trim(), '--conceptual', '--json'], {
    cwd: INGESTION_DIR,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    return { courseId: courseId.trim(), courseName: '', units: [] };
  }
  try {
    const out = (result.stdout || '').trim();
    const parsed = out ? JSON.parse(out) : null;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.units)) {
      return {
        courseId: parsed.courseId ?? courseId.trim(),
        courseName: typeof parsed.courseName === 'string' ? parsed.courseName : '',
        units: parsed.units,
      };
    }
    if (Array.isArray(parsed)) {
      return { courseId: courseId.trim(), courseName: '', units: parsed };
    }
    return { courseId: courseId.trim(), courseName: '', units: [] };
  } catch {
    return { courseId: courseId.trim(), courseName: '', units: [] };
  }
}

/** Write concepts payload to public/concepts.json for the frontend. */
function writeConceptsToFile(payload) {
  try {
    const dir = path.dirname(CONCEPTS_JSON_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const toWrite = { ...payload, updatedAt: new Date().toISOString() };
    fs.writeFileSync(CONCEPTS_JSON_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not write concepts.json:', err.message);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/canvas') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });

    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const token = parsed.token;
        if (!token) {
          sendJson(res, 400, { error: 'Missing token' });
          return;
        }

        const result = await run({ token, writeFile: false });
        sendJson(res, 200, result);
      } catch (err) {
        const status = err.status || 500;
        sendJson(res, status, { error: err.message || 'Failed to fetch Canvas data' });
      }
    });
    return;
  }

  // GET /api/canvas/concepts?courseId=... or POST /api/canvas/concepts with { courseId } or { courseIds: [] }
  const conceptsMatch = req.url && req.url.startsWith('/api/canvas/concepts');
  if (req.method === 'GET' && conceptsMatch) {
    const q = req.url.split('?')[1] || '';
    const params = new URLSearchParams(q);
    const courseId = params.get('courseId') || '';
    const data = getConceptualUnits(courseId);
    const payload = { courseId: data.courseId || null, courseName: data.courseName, units: data.units };
    writeConceptsToFile(payload);
    sendJson(res, 200, { courseId: payload.courseId, courseName: payload.courseName, units: payload.units });
    return;
  }
  if (req.method === 'POST' && conceptsMatch) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const courseId = parsed.courseId;
        const courseIds = Array.isArray(parsed.courseIds) ? parsed.courseIds : (courseId != null ? [String(courseId)] : []);
        if (courseIds.length === 0) {
          sendJson(res, 400, { error: 'Missing courseId or courseIds' });
          return;
        }
        const courses = courseIds.map((id) => getConceptualUnits(id));
        const payload = courseIds.length === 1
          ? { courseId: courses[0].courseId, courseName: courses[0].courseName, units: courses[0].units }
          : { courses: courses.map((c) => ({ courseId: c.courseId, courseName: c.courseName, units: c.units })) };
        writeConceptsToFile(payload);
        sendJson(res, 200, courseIds.length === 1
          ? { courseId: payload.courseId, courseName: payload.courseName, units: payload.units }
          : { courses: payload.courses });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    });
    return;
  }

  const reqPath = req.url === '/' ? '/canvas_explorer.html' : req.url;
  const safePath = path.normalize(reqPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    send404(res);
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      send404(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

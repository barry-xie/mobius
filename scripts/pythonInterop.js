/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("child_process");
const path = require("path");

const DEFAULT_INGESTION_DIR = path.join(__dirname, "..", "ingestion");
const PYTHON_CANDIDATES = [
  { command: "python", argsPrefix: [] },
  { command: "python3", argsPrefix: [] },
  { command: "py", argsPrefix: ["-3"] },
];

function parseJsonOutput(rawOutput) {
  const trimmed = String(rawOutput || "").trim();
  if (!trimmed) {
    throw new Error("Python script returned empty output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    const trailingObject = trimmed.match(/(\{[\s\S]*\})\s*$/);
    if (trailingObject?.[1]) {
      return JSON.parse(trailingObject[1]);
    }
    const trailingArray = trimmed.match(/(\[[\s\S]*\])\s*$/);
    if (trailingArray?.[1]) {
      return JSON.parse(trailingArray[1]);
    }
    throw new Error("Python script output was not valid JSON");
  }
}

function runPythonCommand(candidate, scriptName, scriptArgs, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Number(options.timeoutMs)) : 60000;
  const cwd = options.cwd || DEFAULT_INGESTION_DIR;
  const fullArgs = [...candidate.argsPrefix, scriptName, ...scriptArgs];

  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, fullArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Timed out after ${timeoutMs}ms running ${scriptName}`));
        return;
      }
      if (signal) {
        reject(new Error(`Python process terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `${scriptName} failed with exit code ${code}`;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runPythonJson(scriptName, scriptArgs = [], options = {}) {
  let lastError = null;
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { stdout } = await runPythonCommand(candidate, scriptName, scriptArgs, options);
      return parseJsonOutput(stdout);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) throw lastError;
  throw new Error("Unable to run Python interpreter");
}

module.exports = {
  DEFAULT_INGESTION_DIR,
  parseJsonOutput,
  runPythonJson,
};

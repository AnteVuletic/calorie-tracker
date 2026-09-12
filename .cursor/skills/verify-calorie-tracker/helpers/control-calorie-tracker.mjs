#!/usr/bin/env node
/**
 * Launch / doctor / cleanup for Calorie Tracker verification runs.
 * Usage (from repo root or any cwd):
 *   node .cursor/skills/verify-calorie-tracker/helpers/control-calorie-tracker.mjs <launch|doctor|status|cleanup|screenshot> [--port N] [--out path] [--url url]
 *
 * State lives under .cursor/skills/verify-calorie-tracker/.run/ (pid, port, url).
 * Proof artifacts must NOT go under .run/ — use ../artifacts/ instead.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SKILL_ROOT, "../../..");
const RUN_DIR = path.join(SKILL_ROOT, ".run");
const STATE_PATH = path.join(RUN_DIR, "state.json");
const LOG_PATH = path.join(RUN_DIR, "vite.log");
const DEFAULT_PORT = 5199;

function parseArgs(argv) {
  const args = { cmd: argv[2], port: DEFAULT_PORT, out: null, url: null };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (argv[i] === "--out" && argv[i + 1]) {
      args.out = argv[++i];
    } else if (argv[i] === "--url" && argv[i + 1]) {
      args.url = argv[++i];
    }
  }
  return args;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function screenshot({ out, url, port }) {
  const state = readState();
  const target = url || state?.url || urlFor(port || state?.port || DEFAULT_PORT);
  if (!out) throw new Error("screenshot requires --out <absolute-or-repo-relative.png>");
  const absOut = path.isAbsolute(out) ? out : path.resolve(REPO_ROOT, out);
  mkdirSync(path.dirname(absOut), { recursive: true });
  const chrome = chromePath();
  if (!chrome) throw new Error("Chrome not found; set CHROME_PATH");
  await new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--window-size=390,844",
        `--screenshot=${absOut}`,
        target,
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Chrome exited ${code}`)),
    );
  });
  if (!existsSync(absOut)) throw new Error(`Screenshot missing at ${absOut}`);
  console.log(JSON.stringify({ ok: true, url: target, out: absOut }));
}

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function urlFor(port) {
  return `http://127.0.0.1:${port}/`;
}

function probe(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
    });
    req.on("error", () => resolve({ ok: false, status: 0 }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0 });
    });
  });
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitReady(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await probe(url);
    if (r.ok) return r;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function launch(port) {
  const existing = readState();
  if (existing?.pid && isPidAlive(existing.pid)) {
    const url = existing.url || urlFor(existing.port);
    const r = await probe(url);
    if (r.ok) {
      console.log(
        JSON.stringify({
          alreadyRunning: true,
          ...existing,
          doctor: "pass",
        }),
      );
      return;
    }
  }

  mkdirSync(RUN_DIR, { recursive: true });
  const runId = `ct-${Date.now().toString(36)}`;
  const url = urlFor(port);
  const logFd = writeFileSync(LOG_PATH, "", { flag: "w" });
  void logFd;

  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "none" },
      shell: process.platform === "win32",
    },
  );

  const logStream = {
    write(chunk) {
      writeFileSync(LOG_PATH, chunk, { flag: "a" });
    },
  };
  child.stdout?.on("data", (d) => logStream.write(d));
  child.stderr?.on("data", (d) => logStream.write(d));
  child.unref();

  const state = {
    runId,
    pid: child.pid,
    port,
    url,
    isolatedContext: `calorie-tracker-verify-${runId}`,
    startedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    logPath: LOG_PATH,
  };
  writeState(state);

  try {
    await waitReady(url);
  } catch (err) {
    try {
      process.kill(child.pid);
    } catch {
      /* ignore */
    }
    throw err;
  }

  console.log(JSON.stringify({ alreadyRunning: false, ...state, doctor: "pass" }));
}

async function doctor(portOverride) {
  const state = readState();
  const port = portOverride || state?.port || DEFAULT_PORT;
  const url = state?.url || urlFor(port);
  const httpOk = await probe(url);
  const pidAlive = state?.pid ? isPidAlive(state.pid) : false;
  const result = {
    ok: Boolean(httpOk.ok && (!state || pidAlive || httpOk.ok)),
    url,
    port,
    httpStatus: httpOk.status,
    pid: state?.pid ?? null,
    pidAlive,
    runId: state?.runId ?? null,
    isolatedContext: state?.isolatedContext ?? null,
    statePath: STATE_PATH,
    ownedByThisHelper: Boolean(state?.pid && pidAlive),
  };
  if (!httpOk.ok) {
    result.ok = false;
    result.reason = `HTTP probe failed for ${url}`;
  } else if (state && !pidAlive) {
    result.ok = false;
    result.reason =
      "URL answers but recorded pid is dead — refuse to drive; may be a foreign instance";
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function status() {
  const state = readState();
  if (!state) {
    console.log(JSON.stringify({ running: false }));
    return;
  }
  console.log(
    JSON.stringify({
      running: isPidAlive(state.pid),
      ...state,
    }),
  );
}

function cleanup() {
  const state = readState();
  if (!state) {
    console.log(JSON.stringify({ cleaned: false, reason: "no state file" }));
    return;
  }
  let killed = false;
  if (state.pid && isPidAlive(state.pid)) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(state.pid), "/t", "/f"], {
          stdio: "ignore",
          shell: true,
        });
      } else {
        process.kill(-state.pid, "SIGTERM");
      }
      killed = true;
    } catch {
      try {
        process.kill(state.pid, "SIGTERM");
        killed = true;
      } catch {
        /* ignore */
      }
    }
  }
  // Remove run state only — never delete ../artifacts/
  rmSync(RUN_DIR, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      cleaned: true,
      killed,
      pid: state.pid,
      artifactsPreservedUnder: path.join(SKILL_ROOT, "artifacts"),
    }),
  );
}

const { cmd, port, out, url } = parseArgs(process.argv);

try {
  if (cmd === "launch") await launch(port);
  else if (cmd === "doctor") await doctor(port);
  else if (cmd === "status") status();
  else if (cmd === "cleanup") cleanup();
  else if (cmd === "screenshot") await screenshot({ out, url, port });
  else {
    console.error(
      "Usage: control-calorie-tracker.mjs <launch|doctor|status|cleanup|screenshot> [--port N] [--out path] [--url url]",
    );
    process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}

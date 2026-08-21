import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { openInDefaultBrowser } from './studio-server.mjs';

const SESSION_SCHEMA = 'bpmn-studio-local-session/v1';

function canonicalDirectory(directory) {
  mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Каталог локальной сессии небезопасен: ${directory}`);
  }
  return realpathSync(directory);
}

function defaultRuntimeDirectory() {
  const base = process.env.LOCALAPPDATA || process.env.TEMP || process.cwd();
  return join(base, 'BPMN-Studio');
}

function canonicalProjectRoot(projectRoot) {
  return realpathSync(resolve(projectRoot));
}

function sessionFileForProject(projectRoot, runtimeDir = defaultRuntimeDirectory()) {
  const canonicalRoot = canonicalProjectRoot(projectRoot);
  const canonicalRuntime = canonicalDirectory(resolve(runtimeDir));
  const key = createHash('sha256').update(canonicalRoot.toLowerCase()).digest('hex').slice(0, 20);
  return join(canonicalRuntime, `session-${key}.json`);
}

function removeStaleDescriptor(sessionFile) {
  if (!existsSync(sessionFile)) return;
  const stat = lstatSync(sessionFile);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Файл локальной сессии небезопасен: ${sessionFile}`);
  }
  rmSync(sessionFile);
}

function parseSessionDescriptor(sessionFile, projectRoot) {
  if (!existsSync(sessionFile)) return null;
  const stat = lstatSync(sessionFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) return null;
  try {
    const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
    if (session.schema !== SESSION_SCHEMA) return null;
    if (!Number.isInteger(session.pid) || session.pid <= 0) return null;
    if (canonicalProjectRoot(session.project_root) !== canonicalProjectRoot(projectRoot)) return null;
    if (typeof session.token !== 'string' || Buffer.byteLength(session.token, 'utf8') < 32) return null;
    const origin = new URL(session.origin);
    const url = new URL(session.url);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== session.origin) return null;
    if (url.origin !== origin.origin || url.pathname !== '/' || url.searchParams.get('token') !== session.token) return null;
    return session;
  } catch {
    return null;
  }
}

async function probeSession(session, timeoutMs = 2_000) {
  if (!session) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${session.origin}/api/bootstrap`, {
      headers: { 'X-Studio-Token': session.token, Origin: session.origin },
      signal: controller.signal
    });
    return response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function activeSession(sessionFile, projectRoot) {
  const session = parseSessionDescriptor(sessionFile, projectRoot);
  return await probeSession(session) ? session : null;
}

function parseLauncherArguments(argv) {
  const options = { open: true, port: 0, runtimeDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-open') {
      options.open = false;
      continue;
    }
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--port') {
      const port = Number(argv[index + 1]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Для --port нужен номер от 0 до 65535.');
      options.port = port;
      index += 1;
      continue;
    }
    if (argument === '--runtime-dir') {
      if (!argv[index + 1]) throw new Error('Для --runtime-dir нужен путь.');
      options.runtimeDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Неизвестный параметр: ${argument}`);
  }
  return options;
}

async function launchStudioSession(options = {}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot || resolve(import.meta.dirname, '..', '..'));
  const runtimeDir = options.runtimeDir || defaultRuntimeDirectory();
  const sessionFile = sessionFileForProject(projectRoot, runtimeDir);
  let session = await activeSession(sessionFile, projectRoot);
  if (session) {
    if (options.open !== false) openInDefaultBrowser(session.url);
    return { reused: true, pid: session.pid, origin: session.origin, sessionFile };
  }

  if (existsSync(sessionFile)) removeStaleDescriptor(sessionFile);
  const serverPath = resolve(import.meta.dirname, 'studio-server.mjs');
  const args = [ serverPath, '--no-open', '--session-file', sessionFile, '--port', String(options.port ?? 0) ];
  const child = spawn(process.execPath, args, {
    cwd: resolve(import.meta.dirname),
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    shell: false
  });
  child.unref();

  const deadline = Date.now() + (options.startupTimeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    session = await activeSession(sessionFile, projectRoot);
    if (session) {
      if (options.open !== false) openInDefaultBrowser(session.url);
      return { reused: session.pid !== child.pid, pid: session.pid, origin: session.origin, sessionFile };
    }
    if (child.exitCode !== null) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Локальная BPMN-студия не успела запуститься. Повторите запуск; если ошибка сохранится, запустите npm run studio:start в tools/bpmn для диагностики.');
}

async function main() {
  const cli = parseLauncherArguments(process.argv.slice(2));
  const result = await launchStudioSession({
    projectRoot: resolve(import.meta.dirname, '..', '..'),
    runtimeDir: cli.runtimeDir,
    open: cli.open,
    port: cli.port
  });
  console.log(result.reused
    ? 'BPMN-студия уже работала: открыта действующая локальная сессия.'
    : 'BPMN-студия запущена в фоне: окно командной строки можно закрыть.');
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Ошибка запуска BPMN-студии: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  activeSession,
  launchStudioSession,
  parseLauncherArguments,
  parseSessionDescriptor,
  probeSession,
  sessionFileForProject
};

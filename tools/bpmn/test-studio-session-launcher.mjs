import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import {
  launchStudioSession,
  sessionFileForProject
} from './launch-studio-background.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const runtimeDir = await mkdtemp(join(tmpdir(), 'bpmn-studio-session-'));
let childPid = null;

async function waitUntil(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return false;
}

try {
  const first = await launchStudioSession({
    projectRoot,
    runtimeDir,
    open: false,
    startupTimeoutMs: 20_000
  });
  assert.equal(first.reused, false);
  assert.ok(Number.isInteger(first.pid) && first.pid > 0);
  childPid = first.pid;

  const sessionPath = sessionFileForProject(projectRoot, runtimeDir);
  assert.equal(existsSync(sessionPath), true, 'сервер должен опубликовать локальную сессию');
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  assert.equal(session.pid, childPid);
  assert.match(session.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.ok(Buffer.byteLength(session.token, 'utf8') >= 32);

  let response = await fetch(`${session.origin}/api/bootstrap`, {
    headers: { 'X-Studio-Token': session.token, Origin: session.origin }
  });
  assert.equal(response.status, 200, 'актуальная локальная сессия должна открывать API');

  response = await fetch(`${session.origin}/api/bootstrap?token=stale-token`);
  assert.equal(response.status, 401, 'устаревший ключ должен оставаться закрытым');

  const second = await launchStudioSession({
    projectRoot,
    runtimeDir,
    open: false,
    startupTimeoutMs: 5_000
  });
  assert.equal(second.reused, true, 'повторный запуск должен переиспользовать живой сервис');
  assert.equal(second.pid, childPid, 'повторный запуск не должен плодить серверы');
} finally {
  if (childPid) {
    try {
      process.kill(childPid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await waitUntil(() => {
      try {
        process.kill(childPid, 0);
        return false;
      } catch {
        return true;
      }
    });
  }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log('Studio reusable background session: PASS');

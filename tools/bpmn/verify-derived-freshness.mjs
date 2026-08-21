import { randomBytes } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const registryPath = resolve(projectRoot, 'registry', 'processes.json');
const renderPath = resolve(import.meta.dirname, 'render.mjs');
const navigationPath = resolve(import.meta.dirname, 'build-navigation.mjs');

function fail(message) {
  throw new Error(message);
}

function projectFile(ref, label) {
  if (typeof ref !== 'string' || !ref.trim()) fail(`${label} не указан.`);
  const path = resolve(projectRoot, ref);
  const relation = relative(projectRoot, path);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail(`${label} выходит за пределы проекта: ${ref}`);
  }
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${label} не найден: ${ref}`);
  const physicalRelation = relative(realpathSync(projectRoot), realpathSync(path));
  if (!physicalRelation || physicalRelation === '..' || physicalRelation.startsWith(`..${sep}`) || isAbsolute(physicalRelation)) {
    fail(`${label} физически находится за пределами проекта: ${ref}`);
  }
  return path;
}

function runNode(script, args, label) {
  const result = spawnSync(process.execPath, [ script, ...args ], {
    cwd: import.meta.dirname,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${label} завершилась с кодом ${result.status}.\n${result.stderr || result.stdout}`);
  }
}

function assertSame(expectedPath, actualPath, label, stale) {
  if (!existsSync(expectedPath) || !statSync(expectedPath).isFile()) {
    stale.push(`${label}: отсутствует ${relative(projectRoot, expectedPath).split(sep).join('/')}`);
    return;
  }
  if (!readFileSync(expectedPath).equals(readFileSync(actualPath))) {
    stale.push(`${label}: файл устарел ${relative(projectRoot, expectedPath).split(sep).join('/')}`);
  }
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
if (!Array.isArray(registry.processes)) fail('В реестре отсутствует массив processes.');

const stale = [];
const temporaryPaths = [];
try {
  for (const entry of registry.processes) {
    const bpmnPath = projectFile(entry.bpmn_ref, `BPMN процесса ${entry.process_id}`);
    const metaPath = projectFile(entry.meta_ref, `Метаданные процесса ${entry.process_id}`);
    const navigationFinalPath = projectFile(entry.navigation_ref, `Навигация процесса ${entry.process_id}`);
    const packageRoot = dirname(metaPath);
    if (basename(packageRoot) !== 'bpmn' || dirname(bpmnPath) !== packageRoot) {
      fail(`BPMN и метаданные процесса ${entry.process_id} должны находиться в одной папке bpmn.`);
    }
    const derivedRoot = dirname(navigationFinalPath);
    if (basename(derivedRoot) !== 'derived' || dirname(derivedRoot) !== packageRoot || basename(navigationFinalPath) !== 'process-navigation.html') {
      fail(`navigation_ref процесса ${entry.process_id} не указывает на стандартный файл derived/process-navigation.html.`);
    }

    const svgFinalPath = resolve(derivedRoot, 'process.svg');
    const pngFinalPath = resolve(derivedRoot, 'process.png');
    const token = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;
    const svgTempPath = resolve(derivedRoot, `.freshness-${token}.svg`);
    const pngTempPath = resolve(derivedRoot, `.freshness-${token}.png`);
    const navigationTempPath = resolve(derivedRoot, `.freshness-${token}.html`);
    temporaryPaths.push(svgTempPath, pngTempPath, navigationTempPath);

    runNode(renderPath, [ bpmnPath, svgTempPath, pngTempPath ], `Построение схемы ${entry.process_id}`);
    runNode(
      navigationPath,
      [ packageRoot, '--svg', svgTempPath, '--output', navigationTempPath, '--registry', registryPath ],
      `Построение навигации ${entry.process_id}`
    );

    assertSame(svgFinalPath, svgTempPath, entry.process_id, stale);
    assertSame(pngFinalPath, pngTempPath, entry.process_id, stale);
    assertSame(navigationFinalPath, navigationTempPath, entry.process_id, stale);
  }
} finally {
  for (const path of temporaryPaths) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

if (stale.length > 0) {
  fail(`Производные файлы не соответствуют исходным данным:\n- ${stale.join('\n- ')}\nВ tools/bpmn запустите npm run update:process для каждого изменённого зарегистрированного процесса.`);
}

console.log(JSON.stringify({
  status: 'passed',
  registered_processes: registry.processes.length,
  checked_files: registry.processes.length * 3
}, null, 2));

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const toolRoot = import.meta.dirname;
const projectRoot = resolve(toolRoot, '..', '..');
const sourcePackageRoot = resolve(projectRoot, 'processes', 'skupka-zolota', 'bpmn');
const tempRoot = resolve(projectRoot, 'temp', 'derived-determinism-test');
const packageRoot = resolve(tempRoot, 'package');
const derivedRoot = resolve(packageRoot, 'derived');
const svgPath = resolve(derivedRoot, 'process.svg');
const pngPath = resolve(derivedRoot, 'process.png');
const navigationPath = resolve(derivedRoot, 'process-navigation.html');

function fail(message) {
  throw new Error(message);
}

function run(scriptName, args, label) {
  const result = spawnSync(process.execPath, [ resolve(toolRoot, scriptName), ...args ], {
    cwd: toolRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${label} завершился с кодом ${result.status}: ${result.stderr || result.stdout}`);
  }
}

function generate() {
  run('render.mjs', [
    resolve(sourcePackageRoot, 'process.bpmn'),
    svgPath,
    pngPath
  ], 'Рендер BPMN');
  run('build-navigation.mjs', [ packageRoot ], 'Сборка навигации');
  return {
    svg: readFileSync(svgPath),
    png: readFileSync(pngPath),
    navigation: readFileSync(navigationPath)
  };
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(derivedRoot, { recursive: true });
copyFileSync(resolve(sourcePackageRoot, 'process.meta.json'), resolve(packageRoot, 'process.meta.json'));

try {
  const first = generate();
  const second = generate();
  const issues = [];

  for (const name of [ 'svg', 'png', 'navigation' ]) {
    if (!first[name].equals(second[name])) issues.push(`${name}: два запуска дали разные байты`);
  }

  for (const [ name, output ] of [
    [ 'svg', second.svg ],
    [ 'navigation', second.navigation ]
  ]) {
    if (output.includes(13)) issues.push(`${name}: найдено окончание строки CR или CRLF`);
  }

  const markerIds = [ ...second.svg.toString('utf8').matchAll(/\bid="(marker-[^"]+)"/gu) ]
    .map((match) => match[1]);
  if (markerIds.length === 0) issues.push('svg: служебные marker ID не найдены');
  if (markerIds.some((id) => !/^marker-\d{4}$/u.test(id))) {
    issues.push('svg: служебные marker ID не приведены к детерминированному формату');
  }
  const svg = second.svg.toString('utf8');
  if (!svg.includes('marker-start:') || !svg.includes('marker-end:')) {
    issues.push('svg: потеряны CSS-свойства marker-start или marker-end');
  }
  if (/marker-\d{4}\s*:/u.test(svg)) {
    issues.push('svg: CSS-свойство ошибочно заменено на служебный marker ID');
  }

  if (issues.length > 0) fail(issues.join('; '));

  console.log(JSON.stringify({
    status: 'passed',
    byte_identical: [ 'process.svg', 'process.png', 'process-navigation.html' ],
    line_endings: 'lf',
    deterministic_marker_ids: markerIds.length
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

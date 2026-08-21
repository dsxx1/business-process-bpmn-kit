import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const scriptPath = resolve(import.meta.dirname, 'build-catalog.mjs');
const outputPath = resolve(projectRoot, 'catalog.html');

const build = spawnSync(process.execPath, [ scriptPath ], { cwd: import.meta.dirname, encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr || build.stdout);
const first = readFileSync(outputPath, 'utf8');

const rebuild = spawnSync(process.execPath, [ scriptPath ], { cwd: import.meta.dirname, encoding: 'utf8' });
assert.equal(rebuild.status, 0, rebuild.stderr || rebuild.stdout);
assert.equal(readFileSync(outputPath, 'utf8'), first, 'Повторная сборка каталога должна быть детерминированной.');

const check = spawnSync(process.execPath, [ scriptPath, '--check' ], { cwd: import.meta.dirname, encoding: 'utf8' });
assert.equal(check.status, 0, check.stderr || check.stdout);
assert.match(first, /Каталог бизнес-процессов/u);
assert.match(first, /Скупка золота и драгоценных металлов/u);
assert.match(first, /processes\/skupka-zolota\/bpmn\/derived\/process-navigation\.html/u);
assert.doesNotMatch(first, /ОП-03|БП-08|СКС-61/u);

console.log(JSON.stringify({ status: 'passed', deterministic: true, russian_ui: true }, null, 2));

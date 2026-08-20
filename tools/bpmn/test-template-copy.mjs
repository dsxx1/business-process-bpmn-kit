import { appendFileSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const templateRoot = resolve(projectRoot, 'templates', 'process-package');
const tempRoot = resolve(projectRoot, 'temp', 'template-copy-test');
const copiedRoot = resolve(tempRoot, 'copied-process');
const copiedBpmnRoot = resolve(copiedRoot, 'bpmn');
const sourceMetaPath = resolve(templateRoot, 'bpmn', 'process.meta.json');
const copiedCardPath = resolve(copiedRoot, 'process-card.md');
const copiedMetaPath = resolve(copiedBpmnRoot, 'process.meta.json');

function fail(message) {
  throw new Error(message);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(script, args, label) {
  const result = spawnSync(process.execPath, [ resolve(import.meta.dirname, script), ...args ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${label}: ${result.stderr || result.stdout}`);
}

if (copiedRoot !== resolve(tempRoot, 'copied-process') || !copiedRoot.startsWith(`${tempRoot}${sep}`)) {
  fail('Небезопасный путь временной копии шаблона');
}

const sourceMetaBefore = readFileSync(sourceMetaPath, 'utf8');
rmSync(copiedRoot, { recursive: true, force: true });
cpSync(templateRoot, copiedRoot, { recursive: true });
appendFileSync(copiedCardPath, '\nПроверка: эта строка существует только в скопированном пакете.\n', 'utf8');

run('refresh-package-hashes.mjs', [ copiedBpmnRoot ], 'Обновление хешей копии');
run('validate-package.mjs', [ copiedBpmnRoot ], 'Проверка копии шаблона');

const copiedMeta = JSON.parse(readFileSync(copiedMetaPath, 'utf8'));
const copiedCardHash = sha256(copiedCardPath);
if (copiedMeta.source_card.sha256 !== copiedCardHash) fail('Копия шаблона хеширует не собственную карточку процесса');
if (copiedCardHash === sha256(resolve(templateRoot, 'process-card.md'))) fail('Проверочная карточка копии не отличается от исходного шаблона');
if (readFileSync(sourceMetaPath, 'utf8') !== sourceMetaBefore) fail('Проверка копии изменила исходный шаблон');

console.log(JSON.stringify({
  status: 'passed',
  copied_package_uses_own_card: true,
  source_template_unchanged: true
}, null, 2));

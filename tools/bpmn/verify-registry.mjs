import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import {
  assertRegistryEntryMatchesPackage,
  assertUnregisteredPackageIsDraft
} from './registry-package-contract.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const registryPath = resolve(projectRoot, 'registry', 'processes.json');
const processesRoot = resolve(projectRoot, 'processes');
const validatorPath = resolve(import.meta.dirname, 'validate-package.mjs');
const bpmnlintPath = resolve(import.meta.dirname, 'node_modules', 'bpmnlint', 'bin', 'bpmnlint.js');
const lintConfigPath = resolve(projectRoot, 'docs', '.bpmnlintrc');

function fail(message) {
  throw new Error(message);
}

function portablePath(path) {
  return relative(projectRoot, path).split(sep).join('/');
}

function findProcessMetadata(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...findProcessMetadata(path));
    else if (entry.isFile() && entry.name === 'process.meta.json' && dirname(path).endsWith(`${sep}bpmn`)) result.push(path);
  }
  return result;
}

function runNode(script, args, label) {
  const result = spawnSync(process.execPath, [ script, ...args ], { cwd: import.meta.dirname, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${label}: команда завершилась с кодом ${result.status}`);
}

if (!existsSync(registryPath)) fail('Реестр процессов отсутствует');
if (!existsSync(bpmnlintPath)) fail('bpmnlint не установлен: выполните npm ci');

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const registeredMeta = new Set(registry.processes.map((entry) => entry.meta_ref));
const discoveredMeta = findProcessMetadata(processesRoot).map(portablePath);
const discoveredMetaSet = new Set(discoveredMeta);
const unregistered = discoveredMeta.filter((path) => !registeredMeta.has(path));
const undiscovered = [ ...registeredMeta ].filter((path) => !discoveredMetaSet.has(path));
if (undiscovered.length) fail(`Реестр ссылается на пакеты вне processes: ${undiscovered.join(', ')}`);

for (const entry of registry.processes) {
  const metaPath = resolve(projectRoot, entry.meta_ref);
  if (!existsSync(metaPath)) fail(`Метаданные зарегистрированного процесса не найдены: ${entry.meta_ref}`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assertRegistryEntryMatchesPackage({ projectRoot, entry, metaPath, meta });
  const packageRoot = dirname(metaPath);
  const bpmnPath = resolve(projectRoot, entry.bpmn_ref);
  runNode(validatorPath, [ packageRoot, '--require-registry' ], `Проверка ${entry.process_id}`);
  runNode(bpmnlintPath, [ '--config', lintConfigPath, bpmnPath ], `BPMN lint ${entry.process_id}`);
}

for (const metaRef of unregistered) {
  const metaPath = resolve(projectRoot, metaRef);
  const packageRoot = dirname(metaPath);
  runNode(validatorPath, [ packageRoot ], `Проверка незарегистрированного черновика ${metaRef}`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assertUnregisteredPackageIsDraft({ metaPath: metaRef, meta });
  const bpmnPath = resolve(packageRoot, meta.bpmn.file);
  runNode(bpmnlintPath, [ '--config', lintConfigPath, bpmnPath ], `BPMN lint ${meta.process_id}`);
}

console.log(JSON.stringify({
  status: 'passed',
  registered_processes: registry.processes.length,
  discovered_process_packages: discoveredMeta.length,
  unregistered_draft_processes: unregistered.length,
  process_ids: registry.processes.map((entry) => entry.process_id)
}, null, 2));

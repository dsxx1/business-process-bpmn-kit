import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { assertUnregisteredPackageIsDraft } from './registry-package-contract.mjs';

const defaultProjectRoot = resolve(import.meta.dirname, '..', '..');
const refreshScriptPath = resolve(import.meta.dirname, 'refresh-package-hashes.mjs');

function fail(message) {
  throw new Error(message);
}

function portablePath(projectRoot, path) {
  return relative(projectRoot, path).split(sep).join('/');
}

function findProcessMetadata(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...findProcessMetadata(path));
    else if (entry.isFile() && entry.name === 'process.meta.json' && dirname(path).endsWith(`${sep}bpmn`)) result.push(path);
  }
  return result;
}

function runRefreshScript({ bpmnRoot }) {
  const result = spawnSync(process.execPath, [ refreshScriptPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Не удалось обновить контрольные суммы: ${bpmnRoot}`);
}

export function refreshDraftPackageHashes({
  projectRoot = defaultProjectRoot,
  refreshPackage = runRefreshScript
} = {}) {
  const registryPath = resolve(projectRoot, 'registry', 'processes.json');
  const processesRoot = resolve(projectRoot, 'processes');
  if (!existsSync(registryPath)) fail(`Реестр процессов не найден: ${registryPath}`);

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  if (!Array.isArray(registry.processes)) fail('В реестре отсутствует массив processes.');

  const registeredMeta = new Set(registry.processes.map((entry) => entry.meta_ref));
  const refreshed = [];

  for (const metaPath of findProcessMetadata(processesRoot).sort()) {
    const metaRef = portablePath(projectRoot, metaPath);
    if (registeredMeta.has(metaRef)) continue;

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assertUnregisteredPackageIsDraft({ metaPath: metaRef, meta });
    const bpmnRoot = dirname(metaPath);
    refreshPackage({ bpmnRoot, metaPath, metaRef, meta });
    refreshed.push({ process_id: meta.process_id, meta_ref: metaRef });
  }

  return {
    status: 'updated',
    refreshed_draft_processes: refreshed.length,
    processes: refreshed
  };
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    console.log(JSON.stringify(refreshDraftPackageHashes(), null, 2));
  } catch (error) {
    console.error(`Ошибка обновления черновиков: ${error.message}`);
    process.exitCode = 1;
  }
}

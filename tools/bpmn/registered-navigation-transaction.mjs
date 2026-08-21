import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const processesRoot = resolve(projectRoot, 'processes');
const navigationPath = resolve(import.meta.dirname, 'build-navigation.mjs');
const navigationTestPath = resolve(import.meta.dirname, 'test-navigation.mjs');
const catalogBuildPath = resolve(import.meta.dirname, 'build-catalog.mjs');
const defaultCatalogPath = resolve(projectRoot, 'catalog.html');

function fail(message) {
  throw new Error(message);
}

function portableProjectRef(path, label) {
  const ref = relative(projectRoot, path);
  if (!ref || ref === '..' || ref.startsWith(`..${sep}`) || isAbsolute(ref)) {
    fail(`${label} выходит за пределы проекта: ${path}`);
  }
  return ref.split(sep).join('/');
}

function projectOwnedExistingFile(ref, label) {
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

function assertOwnedDerivedFile(derivedRoot, path) {
  if (!existsSync(path)) return;
  if (!statSync(path).isFile()) fail(`Производный путь не является файлом: ${path}`);
  if (relative(realpathSync(derivedRoot), realpathSync(path)) !== basename(path)) {
    fail(`Производный файл не должен быть ссылкой за пределы derived: ${path}`);
  }
}

function assertOwnedProjectOutput(path, label) {
  const resolvedPath = resolve(path);
  const relation = relative(projectRoot, resolvedPath);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail(`${label} выходит за пределы проекта: ${resolvedPath}`);
  }
  const parent = dirname(resolvedPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    fail(`Папка для ${label.toLowerCase()} не найдена: ${parent}`);
  }
  const expectedParentRelation = relative(projectRoot, parent);
  const physicalParentRelation = relative(realpathSync(projectRoot), realpathSync(parent));
  if (physicalParentRelation !== expectedParentRelation) {
    fail(`Папка для ${label.toLowerCase()} не должна быть ссылкой: ${parent}`);
  }
  if (existsSync(resolvedPath)) {
    if (!statSync(resolvedPath).isFile()) fail(`${label} должен быть файлом: ${resolvedPath}`);
    if (relative(realpathSync(projectRoot), realpathSync(resolvedPath)) !== relation) {
      fail(`${label} не должен быть ссылкой: ${resolvedPath}`);
    }
  }
  return resolvedPath;
}

function uniqueTransactionPaths(derivedRoot) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}-${attempt}`;
    const prefix = resolve(derivedRoot, `.process-navigation-update-${token}`);
    const candidate = { tempPath: `${prefix}.html`, backupPath: `${prefix}.backup-html` };
    if (!existsSync(candidate.tempPath) && !existsSync(candidate.backupPath)) return candidate;
  }
  fail(`Не удалось подобрать временное имя в ${derivedRoot}.`);
}

function uniqueCatalogTransactionPaths(catalogPath) {
  const catalogRoot = dirname(catalogPath);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}-${attempt}`;
    const prefix = resolve(catalogRoot, `.catalog-update-${token}`);
    const candidate = { tempPath: `${prefix}.html`, backupPath: `${prefix}.backup-html` };
    if (!existsSync(candidate.tempPath) && !existsSync(candidate.backupPath)) return candidate;
  }
  fail(`Не удалось подобрать временное имя для каталога в ${catalogRoot}.`);
}

function runNode(script, args, label) {
  const result = spawnSync(process.execPath, [ script, ...args ], {
    cwd: import.meta.dirname,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${label}: команда завершилась с кодом ${result.status}.`);
}

function fsyncFile(path) {
  const descriptor = openSync(path, 'r+');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function captureTransactionFile(path) {
  return existsSync(path)
    ? { path, existed: true, content: readFileSync(path) }
    : { path, existed: false, content: null };
}

function sameAsSnapshot(snapshot) {
  if (!snapshot.existed) return !existsSync(snapshot.path);
  return existsSync(snapshot.path) && statSync(snapshot.path).isFile() && readFileSync(snapshot.path).equals(snapshot.content);
}

export function commitFileTransaction(files) {
  for (const file of files) {
    if (!existsSync(file.tempPath) || !statSync(file.tempPath).isFile() || statSync(file.tempPath).size === 0) {
      fail(`Временный производный файл не создан или пуст: ${file.tempPath}`);
    }
    file.replacementContent = readFileSync(file.tempPath);
  }
  for (const file of files) {
    if (!sameAsSnapshot(file.snapshot)) {
      fail(`Производный файл изменился во время подготовки: ${file.finalPath}`);
    }
  }
  for (const file of files) {
    if (file.snapshot.existed) {
      renameSync(file.finalPath, file.backupPath);
      file.backedUp = true;
    }
    renameSync(file.tempPath, file.finalPath);
    file.installed = true;
  }
}

export function rollbackFileTransaction(files) {
  const errors = [];
  for (const file of [ ...files ].reverse()) {
    try {
      if (file.installed) {
        if (!existsSync(file.finalPath)) {
          errors.push(`Новый файл исчез до отката: ${file.finalPath}`);
          continue;
        }
        if (!readFileSync(file.finalPath).equals(file.replacementContent)) {
          errors.push(`Новый файл изменён кем-то ещё; сохранена резервная копия: ${file.backupPath}`);
          continue;
        }
        rmSync(file.finalPath, { force: true });
        file.installed = false;
      }
      if (file.backedUp) {
        if (existsSync(file.finalPath)) {
          errors.push(`Нельзя восстановить резервную копию поверх изменённого файла: ${file.finalPath}`);
          continue;
        }
        renameSync(file.backupPath, file.finalPath);
        file.backedUp = false;
      }
    } catch (error) {
      errors.push(`${file.finalPath}: ${error.message}`);
    }
  }
  return errors;
}

export function cleanupFileTransaction(files, removeBackups) {
  for (const file of files) {
    if (existsSync(file.tempPath)) rmSync(file.tempPath, { force: true });
    if (removeBackups && existsSync(file.backupPath)) rmSync(file.backupPath, { force: true });
  }
}

export function stageProcessCatalog({
  registryPathForBuild,
  finalPath = defaultCatalogPath,
  transactionOverride
}) {
  projectOwnedExistingFile(registryPathForBuild, 'Версия реестра для построения каталога');
  const catalogPath = assertOwnedProjectOutput(finalPath, 'Каталог процессов');
  const transaction = transactionOverride || uniqueCatalogTransactionPaths(catalogPath);
  for (const path of [ transaction.tempPath, transaction.backupPath ]) {
    const resolvedPath = resolve(path);
    if (dirname(resolvedPath) !== dirname(catalogPath) || existsSync(resolvedPath)) {
      fail(`Временный путь каталога должен быть новым файлом рядом с catalog.html: ${resolvedPath}`);
    }
  }
  const file = {
    finalPath: catalogPath,
    tempPath: resolve(transaction.tempPath),
    backupPath: resolve(transaction.backupPath),
    snapshot: captureTransactionFile(catalogPath)
  };
  try {
    runNode(
      catalogBuildPath,
      [ '--registry', registryPathForBuild, '--output', file.tempPath ],
      'Построение общего каталога процессов'
    );
    fsyncFile(file.tempPath);
    return file;
  } catch (error) {
    cleanupFileTransaction([ file ], true);
    throw error;
  }
}

export function stageRegisteredArtifacts({
  registry,
  registryPathForBuild,
  svgOverrides = new Map(),
  transactionOverrides = new Map(),
  catalogFinalPath = defaultCatalogPath,
  catalogTransactionOverride
}) {
  if (!registry || !Array.isArray(registry.processes)) fail('Для пересборки навигации нужен корректный реестр процессов.');
  if (!existsSync(registryPathForBuild) || !statSync(registryPathForBuild).isFile()) {
    fail(`Версия реестра для построения навигации не найдена: ${registryPathForBuild}`);
  }
  const files = [];
  const plans = [];
  const seenFinalPaths = new Set();

  try {
    for (const entry of registry.processes) {
      const metaPath = projectOwnedExistingFile(entry.meta_ref, `Метаданные процесса ${entry.process_id}`);
      const relationToProcesses = relative(processesRoot, metaPath);
      if (!relationToProcesses || relationToProcesses === '..' || relationToProcesses.startsWith(`..${sep}`) || isAbsolute(relationToProcesses)) {
        fail(`Метаданные зарегистрированного процесса ${entry.process_id} находятся вне processes.`);
      }
      const bpmnRoot = dirname(metaPath);
      if (basename(bpmnRoot) !== 'bpmn') fail(`Метаданные ${entry.process_id} должны находиться в папке bpmn.`);
      const derivedRoot = resolve(bpmnRoot, 'derived');
      if (!existsSync(derivedRoot) || !statSync(derivedRoot).isDirectory()) {
        fail(`У зарегистрированного процесса ${entry.process_id} отсутствует папка derived.`);
      }
      if (relative(realpathSync(bpmnRoot), realpathSync(derivedRoot)) !== 'derived') {
        fail(`Папка derived процесса ${entry.process_id} не должна быть ссылкой.`);
      }

      const finalPath = resolve(derivedRoot, 'process-navigation.html');
      if (seenFinalPaths.has(finalPath)) fail(`Несколько записей реестра используют одну страницу навигации: ${finalPath}`);
      seenFinalPaths.add(finalPath);
      const expectedNavigationRef = portableProjectRef(finalPath, 'Ссылка на страницу навигации');
      if (entry.navigation_ref !== expectedNavigationRef) {
        fail(`Ссылка navigation_ref процесса ${entry.process_id} не совпадает с его пакетом.`);
      }

      const svgPath = svgOverrides.get(entry.meta_ref) || resolve(derivedRoot, 'process.svg');
      if (!existsSync(svgPath) || !statSync(svgPath).isFile()) {
        fail(`У зарегистрированного процесса ${entry.process_id} отсутствует SVG: ${svgPath}`);
      }
      if (!svgOverrides.has(entry.meta_ref)) assertOwnedDerivedFile(derivedRoot, svgPath);
      assertOwnedDerivedFile(derivedRoot, finalPath);

      const override = transactionOverrides.get(entry.meta_ref);
      const transaction = override || uniqueTransactionPaths(derivedRoot);
      for (const path of [ transaction.tempPath, transaction.backupPath ]) {
        if (dirname(path) !== derivedRoot || existsSync(path)) {
          fail(`Временный путь навигации должен быть новым файлом внутри derived: ${path}`);
        }
      }
      const file = {
        finalPath,
        tempPath: transaction.tempPath,
        backupPath: transaction.backupPath,
        snapshot: captureTransactionFile(finalPath)
      };
      files.push(file);
      plans.push({ entry, bpmnRoot, svgPath, tempNavigationPath: transaction.tempPath });
    }

    for (const plan of plans) {
      runNode(
        navigationPath,
        [
          plan.bpmnRoot,
          '--svg', plan.svgPath,
          '--output', plan.tempNavigationPath,
          '--registry', registryPathForBuild
        ],
        `Построение навигации процесса ${plan.entry.process_id}`
      );
      runNode(
        navigationTestPath,
        [ plan.tempNavigationPath, plan.bpmnRoot ],
        `Проверка навигации процесса ${plan.entry.process_id}`
      );
      fsyncFile(plan.tempNavigationPath);
    }
    const catalogFile = stageProcessCatalog({
      registryPathForBuild,
      finalPath: catalogFinalPath,
      transactionOverride: catalogTransactionOverride
    });
    files.push(catalogFile);
    return { files, plans, catalogFile };
  } catch (error) {
    cleanupFileTransaction(files, true);
    throw error;
  }
}

export const stageRegisteredNavigations = stageRegisteredArtifacts;

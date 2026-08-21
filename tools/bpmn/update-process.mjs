import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import {
  captureTransactionFile,
  cleanupFileTransaction,
  commitFileTransaction,
  rollbackFileTransaction,
  stageRegisteredArtifacts
} from './registered-navigation-transaction.mjs';
import { withProjectMutationLock } from './bpmn-operation-lock.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const processesRoot = resolve(projectRoot, 'processes');
const registryPath = resolve(projectRoot, 'registry', 'processes.json');
const lintConfigPath = resolve(projectRoot, 'docs', '.bpmnlintrc');
const refreshPath = resolve(import.meta.dirname, 'refresh-package-hashes.mjs');
const validatePath = resolve(import.meta.dirname, 'validate-package.mjs');
const renderPath = resolve(import.meta.dirname, 'render.mjs');
const verifyRegistryPath = resolve(import.meta.dirname, 'verify-registry.mjs');
const bpmnlintPath = resolve(import.meta.dirname, 'node_modules', 'bpmnlint', 'bin', 'bpmnlint.js');
const windowsReservedNames = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return `Обновление уже зарегистрированного бизнес-процесса после правок.

Использование:
  node update-process.mjs
  node update-process.mjs --slug short-name

Без --slug мастер покажет зарегистрированные процессы и предложит выбрать один.
Команда обновляет контрольные суммы, проверяет BPMN, заново строит SVG и PNG,
синхронизирует реестр и общий каталог и пересобирает навигацию всех процессов.
Если материалы изменились после решения владельца, прежнее решение остаётся в
истории, а текущая версия возвращается на повторную содержательную проверку.`;
}

function argumentValue(argv, index, name) {
  const current = argv[index];
  if (current === name) {
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      fail(`После ${name} нужно указать значение.`);
    }
    return { value: argv[index + 1], consumed: 1 };
  }
  if (current.startsWith(`${name}=`)) {
    const value = current.slice(name.length + 1);
    if (!value) fail(`После ${name}= нужно указать значение.`);
    return { value, consumed: 0 };
  }
  return null;
}

function parseArguments(argv) {
  const options = { slug: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const slug = argumentValue(argv, index, '--slug');
    if (slug) {
      if (options.slug !== undefined) fail('Параметр --slug указан больше одного раза.');
      options.slug = slug.value;
      index += slug.consumed;
      continue;
    }
    fail(`Неизвестный параметр: ${argument}`);
  }
  return options;
}

function validateSlug(value) {
  const slug = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(slug)) {
    fail('Короткое имя должно начинаться с латинской буквы и содержать только строчные латинские буквы, цифры и одиночные дефисы.');
  }
  if (slug.length < 3 || slug.length > 64) fail('Короткое имя должно содержать от 3 до 64 символов.');
  if (windowsReservedNames.has(slug)) fail(`Короткое имя ${slug} зарезервировано операционной системой.`);
  return slug;
}

function portableProjectRef(path, label) {
  const ref = relative(projectRoot, path);
  if (!ref || ref === '..' || ref.startsWith(`..${sep}`) || isAbsolute(ref)) {
    fail(`${label} выходит за пределы проекта: ${path}`);
  }
  return ref.split(sep).join('/');
}

function exactPackageRoot(slug) {
  const target = resolve(processesRoot, slug);
  if (relative(processesRoot, target) !== slug) fail('Путь пакета выходит за пределы каталога processes.');
  if (!existsSync(target) || !statSync(target).isDirectory()) fail(`Пакет processes/${slug} не найден.`);
  if (relative(realpathSync(processesRoot), realpathSync(target)) !== slug) {
    fail('Пакет должен быть обычной папкой непосредственно внутри processes; ссылки и перенаправления путей не допускаются.');
  }
  return target;
}

function exactBpmnRoot(packageRoot) {
  const bpmnRoot = resolve(packageRoot, 'bpmn');
  if (!existsSync(bpmnRoot) || !statSync(bpmnRoot).isDirectory()) fail(`В пакете отсутствует папка bpmn: ${bpmnRoot}`);
  if (relative(realpathSync(packageRoot), realpathSync(bpmnRoot)) !== 'bpmn') {
    fail('Папка bpmn должна физически находиться внутри выбранного пакета.');
  }
  return bpmnRoot;
}

function packageOwnedFile(bpmnRoot, ref, label) {
  if (typeof ref !== 'string' || !ref.trim()) fail(`${label} не указан в process.meta.json.`);
  const path = resolve(bpmnRoot, ref);
  const relation = relative(bpmnRoot, path);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail(`${label} выходит за пределы папки bpmn: ${ref}`);
  }
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${label} не найден: ${path}`);
  const physicalRelation = relative(realpathSync(bpmnRoot), realpathSync(path));
  if (!physicalRelation || physicalRelation === '..' || physicalRelation.startsWith(`..${sep}`) || isAbsolute(physicalRelation)) {
    fail(`${label} физически находится за пределами папки bpmn: ${ref}`);
  }
  return path;
}

function readRegistry() {
  if (!existsSync(registryPath)) fail(`Реестр процессов не найден: ${registryPath}`);
  const text = readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(text);
  if (!Array.isArray(registry.processes)) fail('В реестре отсутствует массив processes.');
  return { text, registry };
}

function readSelectedPackage(slug) {
  const packageRoot = exactPackageRoot(slug);
  const bpmnRoot = exactBpmnRoot(packageRoot);
  const metaPath = resolve(bpmnRoot, 'process.meta.json');
  if (!existsSync(metaPath) || !statSync(metaPath).isFile()) fail(`Метаданные процесса не найдены: ${metaPath}`);
  if (relative(realpathSync(bpmnRoot), realpathSync(metaPath)) !== 'process.meta.json') {
    fail('process.meta.json должен физически находиться внутри папки bpmn; ссылка на внешний файл не допускается.');
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const bpmnPath = packageOwnedFile(bpmnRoot, meta.bpmn?.file, 'BPMN-файл');
  return { slug, packageRoot, bpmnRoot, metaPath, meta, bpmnPath };
}

function findRegisteredEntry(selected, registry) {
  const expectedMetaRef = portableProjectRef(selected.metaPath, 'Ссылка на метаданные');
  const matches = registry.processes.filter((entry) => entry.meta_ref === expectedMetaRef);
  if (!matches.length) fail(`Пакет processes/${selected.slug} ещё не зарегистрирован. Сначала используйте мастер регистрации.`);
  if (matches.length !== 1) fail(`В реестре найдено несколько записей для ${expectedMetaRef}. Исправьте реестр вручную.`);
  return matches[0];
}

function assertUpdateHasNoConflicts(selected, registry, currentEntry) {
  if (!selected.meta.process_id || !selected.meta.title || !selected.meta.canonicality?.business_status) {
    fail('В process.meta.json отсутствуют process_id, title или canonicality.business_status.');
  }
  const metaRef = portableProjectRef(selected.metaPath, 'Ссылка на метаданные');
  const bpmnRef = portableProjectRef(selected.bpmnPath, 'Ссылка на BPMN');
  const duplicate = registry.processes.find((entry) => entry !== currentEntry && (
    entry.process_id === selected.meta.process_id || entry.meta_ref === metaRef || entry.bpmn_ref === bpmnRef
  ));
  if (duplicate) {
    fail(`Обновлённые данные конфликтуют с процессом ${duplicate.process_id}: ${duplicate.meta_ref}`);
  }
}

function ensureDerivedRoot(selected) {
  const derivedRoot = resolve(selected.bpmnRoot, 'derived');
  if (!existsSync(derivedRoot)) mkdirSync(derivedRoot);
  if (!statSync(derivedRoot).isDirectory()) fail(`Путь derived не является папкой: ${derivedRoot}`);
  if (relative(realpathSync(selected.bpmnRoot), realpathSync(derivedRoot)) !== 'derived') {
    fail('Папка derived должна физически находиться внутри папки bpmn; ссылка на внешний каталог не допускается.');
  }
  return derivedRoot;
}

function assertOwnedDerivedFile(derivedRoot, path) {
  if (!existsSync(path)) return;
  if (!statSync(path).isFile()) fail(`Производный путь не является файлом: ${path}`);
  if (relative(realpathSync(derivedRoot), realpathSync(path)) !== basename(path)) {
    fail(`Производный файл не должен быть ссылкой за пределы derived: ${path}`);
  }
}

function createTransactionPaths(derivedRoot) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}-${attempt}`;
    const prefix = resolve(derivedRoot, `.process-update-${token}`);
    const paths = {
      svgPath: resolve(derivedRoot, 'process.svg'),
      pngPath: resolve(derivedRoot, 'process.png'),
      navigationPath: resolve(derivedRoot, 'process-navigation.html'),
      tempSvgPath: `${prefix}.svg`,
      tempPngPath: `${prefix}.png`,
      tempNavigationPath: `${prefix}.html`,
      backupSvgPath: `${prefix}.backup-svg`,
      backupPngPath: `${prefix}.backup-png`,
      backupNavigationPath: `${prefix}.backup-html`
    };
    const transactionOnly = [
      paths.tempSvgPath,
      paths.tempPngPath,
      paths.tempNavigationPath,
      paths.backupSvgPath,
      paths.backupPngPath,
      paths.backupNavigationPath
    ];
    if (!transactionOnly.some(existsSync)) return paths;
  }
  fail('Не удалось подобрать уникальные временные имена для обновления производных файлов.');
}

function writeTemporaryRegistry(text) {
  const registryRoot = dirname(registryPath);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const path = resolve(registryRoot, `.processes-update-view-${process.pid}-${Date.now()}-${attempt}.json`);
    try {
      const descriptor = openSync(path, 'wx', statSync(registryPath).mode & 0o777);
      try {
        writeFileSync(descriptor, text, 'utf8');
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return path;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  fail('Не удалось создать временную версию реестра для пересборки навигации.');
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
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replacementEntry(selected, paths) {
  return {
    process_id: selected.meta.process_id,
    title: selected.meta.title,
    status: selected.meta.status,
    business_status: selected.meta.canonicality.business_status,
    bpmn_ref: portableProjectRef(selected.bpmnPath, 'Ссылка на BPMN'),
    meta_ref: portableProjectRef(selected.metaPath, 'Ссылка на метаданные'),
    navigation_ref: portableProjectRef(paths.navigationPath, 'Ссылка на страницу навигации')
  };
}

function synchronizedRegistry(registry, currentEntry, replacement) {
  const found = registry.processes.filter((entry) => entry === currentEntry).length;
  if (found !== 1) fail('Не удалось однозначно определить обновляемую запись реестра.');
  const processes = registry.processes
    .map((entry) => entry === currentEntry ? replacement : entry)
    .sort((left, right) => left.process_id.localeCompare(right.process_id, 'en'));
  return { ...registry, processes };
}

function replaceRegistryAtomically(expectedCurrentText, replacementText) {
  const registryRoot = dirname(registryPath);
  const registryMode = statSync(registryPath).mode & 0o777;
  let tempPath;
  let descriptor;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      tempPath = resolve(registryRoot, `.processes-update-${process.pid}-${Date.now()}-${attempt}.tmp`);
      try {
        descriptor = openSync(tempPath, 'wx', registryMode);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (descriptor === undefined) fail('Не удалось создать уникальный временный файл рядом с реестром.');
    writeFileSync(descriptor, replacementText, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    if (readFileSync(registryPath, 'utf8') !== expectedCurrentText) {
      fail('Реестр изменился во время подготовки процесса. Запустите обновление ещё раз после проверки изменений.');
    }
    renameSync(tempPath, registryPath);
    tempPath = undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (tempPath && existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function metaWithoutRecordedHashes(text) {
  const meta = JSON.parse(text);
  if (!meta.source_card || !Array.isArray(meta.evidence)) {
    fail('Нельзя безопасно определить изменения контрольных сумм в process.meta.json.');
  }
  meta.source_card.sha256 = '<source-card-sha256>';
  for (const evidence of meta.evidence) evidence.sha256 = '<evidence-sha256>';
  return meta;
}

export function hashRefreshChangedOnlyHashes(originalText, refreshedText) {
  try {
    return isDeepStrictEqual(
      metaWithoutRecordedHashes(originalText),
      metaWithoutRecordedHashes(refreshedText)
    );
  } catch {
    return false;
  }
}

export function hashRefreshSafelyReopenedReview(originalText, refreshedText) {
  try {
    const original = metaWithoutRecordedHashes(originalText);
    const refreshed = metaWithoutRecordedHashes(refreshedText);
    const recordedStates = new Set([ 'approved', 'rework', 'rejected' ]);
    const recordedDecisions = new Set([ 'approved', 'rework', 'rejected' ]);
    if (!recordedStates.has(original.status) || !recordedDecisions.has(original.review?.human_decision)) return false;
    if (refreshed.status !== 'review-ready') return false;
    if (refreshed.canonicality?.business_status !== 'pending_human_decision') return false;
    if (refreshed.review?.human_decision !== 'not_recorded') return false;

    original.status = refreshed.status;
    original.canonicality.business_status = refreshed.canonicality.business_status;
    original.review.human_decision = refreshed.review.human_decision;
    return isDeepStrictEqual(original, refreshed);
  } catch {
    return false;
  }
}

export function rollbackRefreshedMeta(metaPath, originalText, refreshedText) {
  if (refreshedText === originalText) return false;
  if (!hashRefreshChangedOnlyHashes(originalText, refreshedText)
      && !hashRefreshSafelyReopenedReview(originalText, refreshedText)) {
    fail('process.meta.json изменился за пределами безопасного обновления контрольных сумм и статуса повторной проверки; автоматический откат остановлен.');
  }
  if (!existsSync(metaPath) || !statSync(metaPath).isFile()) {
    fail(`process.meta.json исчез до отката: ${metaPath}`);
  }
  if (readFileSync(metaPath, 'utf8') !== refreshedText) {
    fail('process.meta.json изменён кем-то ещё после обновления контрольных сумм; автоматический откат остановлен.');
  }

  const metaRoot = dirname(metaPath);
  const metaMode = statSync(metaPath).mode & 0o777;
  let tempPath;
  let descriptor;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      tempPath = resolve(metaRoot, `.process-meta-rollback-${process.pid}-${Date.now()}-${attempt}.tmp`);
      try {
        descriptor = openSync(tempPath, 'wx', metaMode);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (descriptor === undefined) fail('Не удалось создать временный файл для отката process.meta.json.');
    writeFileSync(descriptor, originalText, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (readFileSync(metaPath, 'utf8') !== refreshedText) {
      fail('process.meta.json изменился во время подготовки отката; исходные байты не восстановлены.');
    }
    renameSync(tempPath, metaPath);
    tempPath = undefined;
    return true;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (tempPath && existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function transactionFiles(paths, snapshots) {
  return [
    {
      finalPath: paths.svgPath,
      tempPath: paths.tempSvgPath,
      backupPath: paths.backupSvgPath,
      snapshot: snapshots.svg
    },
    {
      finalPath: paths.pngPath,
      tempPath: paths.tempPngPath,
      backupPath: paths.backupPngPath,
      snapshot: snapshots.png
    }
  ];
}

function discoverRegistered() {
  const { registry } = readRegistry();
  const candidates = [];
  const warnings = [];
  for (const entry of registry.processes) {
    const match = /^processes\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/bpmn\/process\.meta\.json$/u.exec(entry.meta_ref || '');
    if (!match) {
      warnings.push(`${entry.process_id || 'без ID'}: нестандартный meta_ref ${entry.meta_ref || 'не указан'}`);
      continue;
    }
    try {
      const slug = validateSlug(match[1]);
      const selected = readSelectedPackage(slug);
      findRegisteredEntry(selected, registry);
      candidates.push({ slug, title: selected.meta.title, processId: selected.meta.process_id });
    } catch (error) {
      warnings.push(`${entry.process_id || match[1]}: ${error.message}`);
    }
  }
  candidates.sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  return { candidates, warnings };
}

async function chooseProcessInteractively() {
  if (!process.stdin.isTTY) {
    fail('Интерактивный выбор доступен только в окне терминала. Для автоматического запуска укажите --slug.');
  }
  const { candidates, warnings } = discoverRegistered();
  for (const warning of warnings) console.warn(`Пропущена запись: ${warning}`);
  if (!candidates.length) fail('Зарегистрированные процессы не найдены.');

  console.log('Выберите зарегистрированный процесс, который нужно обновить:');
  candidates.forEach((candidate, index) => {
    console.log(`  ${index + 1}. ${candidate.title} (${candidate.slug})`);
  });

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await terminal.question(`Номер процесса [1-${candidates.length}]: `)).trim();
      const number = Number(answer);
      if (Number.isInteger(number) && number >= 1 && number <= candidates.length) return candidates[number - 1].slug;
      console.error('Введите номер процесса из списка.');
    }
  } finally {
    terminal.close();
  }
}

async function updateProcessTransaction(slug) {
  let selected = readSelectedPackage(validateSlug(slug));
  const originalMetaText = readFileSync(selected.metaPath, 'utf8');
  const original = readRegistry();
  let currentEntry = findRegisteredEntry(selected, original.registry);
  assertUpdateHasNoConflicts(selected, original.registry, currentEntry);
  if (!existsSync(bpmnlintPath)) fail('bpmnlint не установлен. Выполните npm ci в tools/bpmn.');

  const derivedRoot = ensureDerivedRoot(selected);
  const paths = createTransactionPaths(derivedRoot);
  for (const path of [ paths.svgPath, paths.pngPath, paths.navigationPath ]) assertOwnedDerivedFile(derivedRoot, path);
  const snapshots = {
    svg: captureTransactionFile(paths.svgPath),
    png: captureTransactionFile(paths.pngPath)
  };
  const files = transactionFiles(paths, snapshots);
  let registryChanged = false;
  let writtenRegistryText;
  let temporaryRegistryPath;
  let refreshAttempted = false;
  let refreshedMetaText;

  try {
    refreshAttempted = true;
    try {
      runNode(refreshPath, [ selected.bpmnRoot ], 'Обновление контрольных сумм');
    } finally {
      if (existsSync(selected.metaPath) && statSync(selected.metaPath).isFile()) {
        refreshedMetaText = readFileSync(selected.metaPath, 'utf8');
      }
    }
    selected = readSelectedPackage(slug);
    currentEntry = findRegisteredEntry(selected, original.registry);
    assertUpdateHasNoConflicts(selected, original.registry, currentEntry);

    runNode(
      validatePath,
      [ selected.bpmnRoot, '--allow-stale-registry-status' ],
      'Проверка процессного пакета перед синхронизацией реестра'
    );
    runNode(bpmnlintPath, [ '--config', lintConfigPath, selected.bpmnPath ], 'Проверка правил BPMN');
    runNode(renderPath, [ selected.bpmnPath, paths.tempSvgPath, paths.tempPngPath ], 'Построение новых SVG и PNG');
    for (const path of [ paths.tempSvgPath, paths.tempPngPath ]) fsyncFile(path);

    const entry = replacementEntry(selected, paths);
    const updatedRegistry = synchronizedRegistry(original.registry, currentEntry, entry);
    writtenRegistryText = `${JSON.stringify(updatedRegistry, null, 2)}\n`;
    temporaryRegistryPath = writeTemporaryRegistry(writtenRegistryText);
    const selectedMetaRef = portableProjectRef(selected.metaPath, 'Ссылка на метаданные');
    const stagedArtifacts = stageRegisteredArtifacts({
      registry: updatedRegistry,
      registryPathForBuild: temporaryRegistryPath,
      svgOverrides: new Map([ [ selectedMetaRef, paths.tempSvgPath ] ]),
      transactionOverrides: new Map([ [ selectedMetaRef, {
        tempPath: paths.tempNavigationPath,
        backupPath: paths.backupNavigationPath
      } ] ])
    });
    files.push(...stagedArtifacts.files);

    if (readFileSync(registryPath, 'utf8') !== original.text) {
      fail('Реестр изменился во время подготовки процесса. Новые производные файлы не установлены.');
    }
    commitFileTransaction(files);
    replaceRegistryAtomically(original.text, writtenRegistryText);
    registryChanged = true;

    runNode(verifyRegistryPath, [], 'Финальная проверка обновлённого реестра и всех пакетов');
    cleanupFileTransaction(files, true);
    if (temporaryRegistryPath && existsSync(temporaryRegistryPath)) rmSync(temporaryRegistryPath, { force: true });

    console.log('\nЗарегистрированный процесс технически обновлён.');
    console.log(`Название: ${selected.meta.title}`);
    console.log(`BPMN: ${selected.bpmnPath}`);
    console.log(`Страница навигации: ${paths.navigationPath}`);
    console.log(`Статус в реестре синхронизирован: ${selected.meta.status}.`);
    if (originalMetaText !== readFileSync(selected.metaPath, 'utf8')) {
      const originalMeta = JSON.parse(originalMetaText);
      if (originalMeta.review?.human_decision !== selected.meta.review?.human_decision) {
        console.log('Материалы изменились после решения владельца: прежнее решение сохранено в истории, текущая версия возвращена на повторную проверку.');
      }
    }
    return { selected, paths, entry };
  } catch (error) {
    const rollbackErrors = [];
    let mayRollbackDerived = true;
    if (registryChanged) {
      const currentText = readFileSync(registryPath, 'utf8');
      if (currentText === writtenRegistryText) {
        try {
          replaceRegistryAtomically(writtenRegistryText, original.text);
          registryChanged = false;
        } catch (rollbackError) {
          rollbackErrors.push(`не восстановлен реестр: ${rollbackError.message}`);
          mayRollbackDerived = false;
        }
      } else {
        rollbackErrors.push('реестр после записи изменён кем-то ещё; автоматический откат реестра и производных файлов остановлен');
        mayRollbackDerived = false;
      }
    }
    if (mayRollbackDerived) rollbackErrors.push(...rollbackFileTransaction(files));
    if (refreshAttempted) {
      try {
        if (typeof refreshedMetaText !== 'string') {
          fail('process.meta.json недоступен после попытки обновить контрольные суммы.');
        }
        rollbackRefreshedMeta(selected.metaPath, originalMetaText, refreshedMetaText);
      } catch (rollbackError) {
        rollbackErrors.push(`не восстановлен process.meta.json после обновления контрольных сумм: ${rollbackError.message}`);
      }
    }
    cleanupFileTransaction(files, mayRollbackDerived && rollbackErrors.length === 0);
    if (temporaryRegistryPath && existsSync(temporaryRegistryPath)) rmSync(temporaryRegistryPath, { force: true });
    const suffix = rollbackErrors.length
      ? ` Ошибки безопасного отката: ${rollbackErrors.join('; ')}.`
      : '';
    throw new Error(`${error.message}${suffix}`);
  }
}

async function updateProcess(slug) {
  return withProjectMutationLock(
    { processesRoot },
    () => updateProcessTransaction(slug),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const slug = options.slug === undefined ? await chooseProcessInteractively() : validateSlug(options.slug);
  await updateProcess(slug);
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Ошибка обновления процесса: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  parseArguments,
  synchronizedRegistry,
  updateProcess,
  validateSlug
};

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import {
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
const navigationPath = resolve(import.meta.dirname, 'build-navigation.mjs');
const navigationTestPath = resolve(import.meta.dirname, 'test-navigation.mjs');
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
  return `Регистрация готового черновика бизнес-процесса.

Использование:
  node register-process.mjs
  node register-process.mjs --slug short-name

Без --slug мастер покажет незарегистрированные черновики и предложит выбрать один.
Команда обновляет контрольные суммы, проверяет BPMN, создаёт SVG и PNG, добавляет
черновик в реестр и общий каталог и пересобирает навигацию всех зарегистрированных
процессов. Бизнес-статус и решение владельца не изменяются.`;
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

  const physicalProcessesRoot = realpathSync(processesRoot);
  const physicalTarget = realpathSync(target);
  if (relative(physicalProcessesRoot, physicalTarget) !== slug) {
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

function assertDraftCanBeRegistered(selected, registry) {
  const { meta, metaPath, bpmnPath } = selected;
  if (meta.status !== 'draft') {
    fail(`Процесс ${meta.process_id || selected.slug} имеет статус ${meta.status || 'не указан'}, а мастер регистрирует только черновики.`);
  }
  if (!meta.process_id || !meta.title || !meta.canonicality?.business_status) {
    fail('В process.meta.json отсутствуют process_id, title или canonicality.business_status.');
  }
  const metaRef = portableProjectRef(metaPath, 'Ссылка на метаданные');
  const bpmnRef = portableProjectRef(bpmnPath, 'Ссылка на BPMN');
  const duplicate = registry.processes.find((entry) =>
    entry.process_id === meta.process_id || entry.meta_ref === metaRef || entry.bpmn_ref === bpmnRef
  );
  if (duplicate) {
    fail(`Процесс уже зарегистрирован или конфликтует с записью ${duplicate.process_id}: ${duplicate.meta_ref}`);
  }
}

function derivedPaths(selected) {
  const derivedRoot = resolve(selected.bpmnRoot, 'derived');
  if (existsSync(derivedRoot)) {
    if (!statSync(derivedRoot).isDirectory()) fail(`Путь derived не является папкой: ${derivedRoot}`);
    if (relative(realpathSync(selected.bpmnRoot), realpathSync(derivedRoot)) !== 'derived') {
      fail('Папка derived должна физически находиться внутри папки bpmn; ссылка на внешний каталог не допускается.');
    }
  }
  return {
    derivedRoot,
    svgPath: resolve(derivedRoot, 'process.svg'),
    pngPath: resolve(derivedRoot, 'process.png'),
    navigationPath: resolve(derivedRoot, 'process-navigation.html')
  };
}

function assertNoDerivedOverwrite(paths) {
  const existing = [ paths.svgPath, paths.pngPath, paths.navigationPath ].filter(existsSync);
  if (existing.length) {
    fail(`Мастер не перезаписывает существующие производные файлы. Уже существуют: ${existing.join(', ')}`);
  }
}

function cleanupCreatedDerived(paths) {
  for (const path of [ paths.navigationPath, paths.pngPath, paths.svgPath ]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

function runNode(script, args, label) {
  const result = spawnSync(process.execPath, [ script, ...args ], {
    cwd: import.meta.dirname,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${label}: команда завершилась с кодом ${result.status}.`);
}

function registryEntry(selected, paths) {
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

function sortedProcesses(processes) {
  return [ ...processes ].sort((left, right) => {
    if (left.process_id < right.process_id) return -1;
    if (left.process_id > right.process_id) return 1;
    return 0;
  });
}

function replaceRegistryAtomically(expectedCurrentText, replacementText) {
  const registryRoot = dirname(registryPath);
  const registryMode = statSync(registryPath).mode & 0o777;
  let tempPath;
  let descriptor;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      tempPath = resolve(registryRoot, `.processes-register-${process.pid}-${Date.now()}-${attempt}.tmp`);
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
      fail('Реестр изменился во время подготовки процесса. Запустите мастер ещё раз после проверки изменений.');
    }
    renameSync(tempPath, registryPath);
    tempPath = undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (tempPath && existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function discoverDrafts() {
  const { registry } = readRegistry();
  const registeredMeta = new Set(registry.processes.map((entry) => entry.meta_ref));
  const registeredIds = new Set(registry.processes.map((entry) => entry.process_id));
  const drafts = [];
  const warnings = [];

  for (const entry of readdirSync(processesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const slug = entry.name;
    try {
      validateSlug(slug);
      const selected = readSelectedPackage(slug);
      const metaRef = portableProjectRef(selected.metaPath, 'Ссылка на метаданные');
      if (selected.meta.status === 'draft' && !registeredMeta.has(metaRef) && !registeredIds.has(selected.meta.process_id)) {
        drafts.push({ slug, title: selected.meta.title, processId: selected.meta.process_id });
      }
    } catch (error) {
      warnings.push(`processes/${slug}: ${error.message}`);
    }
  }
  drafts.sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  return { drafts, warnings };
}

async function chooseDraftInteractively() {
  if (!process.stdin.isTTY) {
    fail('Интерактивный выбор доступен только в окне терминала. Для автоматического запуска укажите --slug.');
  }
  const { drafts, warnings } = discoverDrafts();
  for (const warning of warnings) console.warn(`Пропущен пакет: ${warning}`);
  if (!drafts.length) fail('Незарегистрированные черновики в папке processes не найдены.');

  console.log('Выберите черновик, который нужно подготовить и зарегистрировать:');
  drafts.forEach((draft, index) => {
    console.log(`  ${index + 1}. ${draft.title} (${draft.slug})`);
  });

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await terminal.question(`Номер процесса [1-${drafts.length}]: `)).trim();
      const number = Number(answer);
      if (Number.isInteger(number) && number >= 1 && number <= drafts.length) return drafts[number - 1].slug;
      console.error('Введите номер процесса из списка.');
    }
  } finally {
    terminal.close();
  }
}

async function registerProcessTransaction(slug) {
  const selected = readSelectedPackage(validateSlug(slug));
  const original = readRegistry();
  assertDraftCanBeRegistered(selected, original.registry);
  const paths = derivedPaths(selected);
  assertNoDerivedOverwrite(paths);
  if (!existsSync(bpmnlintPath)) fail('bpmnlint не установлен. Выполните npm ci в tools/bpmn.');

  let registryChanged = false;
  let writtenRegistryText = null;
  let artifactFiles = [];
  try {
    runNode(refreshPath, [ selected.bpmnRoot ], 'Обновление контрольных сумм');
    selected.meta = JSON.parse(readFileSync(selected.metaPath, 'utf8'));
    assertDraftCanBeRegistered(selected, original.registry);
    runNode(validatePath, [ selected.bpmnRoot ], 'Проверка процессного пакета');
    runNode(bpmnlintPath, [ '--config', lintConfigPath, selected.bpmnPath ], 'Проверка правил BPMN');
    runNode(renderPath, [ selected.bpmnPath, paths.svgPath, paths.pngPath ], 'Построение SVG и PNG');
    runNode(navigationPath, [ selected.bpmnRoot ], 'Построение страницы навигации');
    runNode(navigationTestPath, [ paths.navigationPath, selected.bpmnRoot ], 'Проверка страницы навигации');

    for (const path of [ paths.svgPath, paths.pngPath, paths.navigationPath ]) {
      if (!existsSync(path)) fail(`Ожидаемый производный файл не создан: ${path}`);
    }

    const entry = registryEntry(selected, paths);
    const updatedRegistry = {
      ...original.registry,
      processes: sortedProcesses([ ...original.registry.processes, entry ])
    };
    writtenRegistryText = `${JSON.stringify(updatedRegistry, null, 2)}\n`;
    replaceRegistryAtomically(original.text, writtenRegistryText);
    registryChanged = true;

    const stagedArtifacts = stageRegisteredArtifacts({
      registry: updatedRegistry,
      registryPathForBuild: registryPath
    });
    artifactFiles = stagedArtifacts.files;
    commitFileTransaction(artifactFiles);

    runNode(verifyRegistryPath, [], 'Финальная проверка реестра');
    cleanupFileTransaction(artifactFiles, true);

    console.log('\nПроцесс технически подготовлен и зарегистрирован.');
    console.log(`Название: ${selected.meta.title}`);
    console.log(`BPMN: ${selected.bpmnPath}`);
    console.log(`Страница навигации: ${paths.navigationPath}`);
    console.log('Статус остался «черновик». Решение владельца процесса мастер не принимает и не подменяет.');
    return { selected, paths, entry };
  } catch (error) {
    const rollbackErrors = [];
    let mayRollbackDerived = true;
    if (registryChanged) {
      const currentText = readFileSync(registryPath, 'utf8');
      if (currentText !== writtenRegistryText) {
        rollbackErrors.push('реестр после записи изменён кем-то ещё; автоматический откат реестра и производных файлов остановлен');
        mayRollbackDerived = false;
      } else {
        try {
          replaceRegistryAtomically(writtenRegistryText, original.text);
          registryChanged = false;
        } catch (rollbackError) {
          rollbackErrors.push(`не восстановлен реестр: ${rollbackError.message}`);
          mayRollbackDerived = false;
        }
      }
    }
    if (mayRollbackDerived) rollbackErrors.push(...rollbackFileTransaction(artifactFiles));
    cleanupFileTransaction(artifactFiles, mayRollbackDerived && rollbackErrors.length === 0);
    if (mayRollbackDerived && rollbackErrors.length === 0) cleanupCreatedDerived(paths);
    const suffix = rollbackErrors.length
      ? ` Ошибки безопасного отката: ${rollbackErrors.join('; ')}.`
      : '';
    throw new Error(`${error.message}${suffix}`);
  }
}

async function registerProcess(slug) {
  return withProjectMutationLock(
    { processesRoot },
    () => registerProcessTransaction(slug),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const slug = options.slug === undefined ? await chooseDraftInteractively() : validateSlug(options.slug);
  await registerProcess(slug);
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Ошибка регистрации процесса: ${error.message}`);
    process.exitCode = 1;
  });
}

export { parseArguments, registerProcess, validateSlug };

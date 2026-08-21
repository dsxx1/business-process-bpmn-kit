import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { BpmnModdle } from 'bpmn-moddle';

import {
  BpmnOperationLockError,
  withBpmnOperationLock,
  withProjectMutationLock
} from './bpmn-operation-lock.mjs';
import { humanProcessStatus } from './process-status-labels.mjs';
import {
  ProcessTransitionContractError,
  processIdFromSlug,
  removeCallTransition,
  renderReservedProcessCard,
  supportedTargetKinds,
  supportedTransitionRelations,
  upsertCallTransition
} from './process-transition-contract.mjs';

const defaultProjectRoot = resolve(import.meta.dirname, '..', '..');
const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const generatedIdPattern = /^(?:Activity|CallActivity|Collaboration|DataObject|DataStore|Definitions|Event|Flow|Gateway|Lane|Message|MessageFlow|Participant|Process|SequenceFlow|Task)_(?:[0-9]+|[0-9a-f]{4,})$/iu;
const maximumProcessCardBytes = 512 * 1024;
const maximumQuestionsBytes = 1024 * 1024;
const windowsReservedNames = new Set([
  'con', 'prn', 'aux', 'nul', 'clock$',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);
const transliteration = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}));

class StudioError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function studioError(code, message, status = 400, details = undefined) {
  return new StudioError(code, message, status, details);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validateSlug(value) {
  const slug = String(value ?? '').trim();
  if (!slugPattern.test(slug) || slug.length < 3 || slug.length > 64 || windowsReservedNames.has(slug)) {
    throw studioError(
      'INVALID_SLUG',
      'Короткое имя должно содержать от 3 до 64 символов, начинаться с латинской буквы и состоять только из строчных латинских букв, цифр и одиночных дефисов.',
      400
    );
  }
  return slug;
}

function validateTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) throw studioError('INVALID_TITLE', 'Укажите название процесса.', 400);
  if (title.length > 200) throw studioError('INVALID_TITLE', 'Название процесса не должно быть длиннее 200 символов.', 400);
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(title)) {
    throw studioError('INVALID_TITLE', 'Название процесса должно быть записано в одну строку.', 400);
  }
  return title;
}

function slugifyTitle(value) {
  const title = validateTitle(value);
  let source = [ ...title.toLocaleLowerCase('ru-RU').normalize('NFKD') ]
    .map((character) => transliteration.get(character) ?? character)
    .join('')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');
  if (!/^[a-z]/u.test(source)) source = `process-${source || 'new'}`;
  if (source.length < 3) source = `${source}-process`;
  return validateSlug(source.slice(0, 64).replace(/-+$/gu, ''));
}

function validateExpectedSha(value) {
  const expected = String(value ?? '').trim().toLowerCase();
  if (!sha256Pattern.test(expected)) {
    throw studioError('INVALID_EXPECTED_SHA', 'Для безопасного сохранения нужен SHA-256 открытой версии BPMN.', 400);
  }
  return expected;
}

function validateExpectedMetaSha(value) {
  const expected = String(value ?? '').trim().toLowerCase();
  if (!sha256Pattern.test(expected)) {
    throw studioError('INVALID_EXPECTED_META_SHA', 'Для безопасного изменения связи нужен SHA-256 открытой версии метаданных.', 400);
  }
  return expected;
}

function assertContained(root, target, label) {
  const relation = relative(root, target);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw studioError('UNSAFE_PATH', `${label} выходит за пределы рабочей области.`, 400);
  }
  return target;
}

function assertRegularFile(path, label) {
  if (!existsSync(path)) throw studioError('FILE_NOT_FOUND', `${label} не найден.`, 404);
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw studioError('UNSAFE_PATH', `${label} должен быть обычным файлом внутри проекта.`, 400);
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path)) throw studioError('DIRECTORY_NOT_FOUND', `${label} не найден.`, 404);
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw studioError('UNSAFE_PATH', `${label} должен быть обычным каталогом внутри проекта.`, 400);
  }
}

function decodeXmlAttribute(value) {
  return String(value ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function semanticStem(text) {
  const transliterated = [ ...String(text ?? '').toLocaleLowerCase('ru-RU').normalize('NFKD') ]
    .map((character) => transliteration.get(character) ?? character)
    .join('')
    .replace(/[\u0300-\u036f]/gu, ' ');
  const words = transliterated.match(/[a-z0-9]+/gu) || [];
  return words.slice(0, 8).map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join('');
}

function semanticPrefix(localName) {
  if (/callActivity/iu.test(localName)) return 'CallActivity';
  if (/task|activity/iu.test(localName)) return 'Task';
  if (/gateway/iu.test(localName)) return 'Gateway';
  if (/event/iu.test(localName)) return 'Event';
  if (/sequenceFlow/iu.test(localName)) return 'Flow';
  if (/messageFlow/iu.test(localName)) return 'MessageFlow';
  return `${localName[0]?.toUpperCase() || 'Element'}${localName.slice(1)}`;
}

/**
 * Чистая диагностическая функция. Она намеренно не переписывает XML: имя BPMN-ID
 * должно передавать бизнес-смысл, а механическая замена способна испортить ссылки.
 */
function findGeneratedBpmnIds(xml) {
  const issues = [];
  const usedSuggestions = new Map();
  const elementPattern = /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b([^<>]*?)\/?>/gu;
  let match;
  while ((match = elementPattern.exec(String(xml))) !== null) {
    const localName = match[1];
    const attributes = new Map();
    const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/gu;
    let attribute;
    while ((attribute = attributePattern.exec(match[2])) !== null) {
      attributes.set(attribute[1].replace(/^.*:/u, ''), decodeXmlAttribute(attribute[3]));
    }
    const id = attributes.get('id');
    if (!id || !generatedIdPattern.test(id)) continue;
    const label = attributes.get('name') || '';
    const prefix = semanticPrefix(localName);
    const base = `${prefix}_${semanticStem(label) || 'DescribeMeaning'}`;
    const count = (usedSuggestions.get(base) || 0) + 1;
    usedSuggestions.set(base, count);
    issues.push({
      id,
      element: localName,
      label: label || null,
      suggested_id: count === 1 ? base : `${base}${count}`,
      auto_fix_applied: false,
      reason: 'Нужно выбрать смысловой идентификатор и проверить все ссылки на элемент.'
    });
  }
  return issues;
}

async function inspectBpmnXml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw studioError('EMPTY_BPMN', 'BPMN-модель не может быть пустой.', 422);
  }
  if (Buffer.byteLength(xml, 'utf8') > 6 * 1024 * 1024) {
    throw studioError('BPMN_TOO_LARGE', 'BPMN-модель больше допустимых 6 МБ.', 413);
  }

  let parsed;
  try {
    parsed = await new BpmnModdle().fromXML(xml);
  } catch (error) {
    throw studioError('INVALID_BPMN_XML', `BPMN XML не разобран: ${error.message}`, 422);
  }
  if (parsed.rootElement?.$type !== 'bpmn:Definitions') {
    throw studioError('INVALID_BPMN_ROOT', 'Корневой элемент файла должен быть BPMN Definitions.', 422);
  }
  const processes = (parsed.rootElement.rootElements || []).filter((element) => element.$type === 'bpmn:Process');
  const collaborations = (parsed.rootElement.rootElements || []).filter((element) => element.$type === 'bpmn:Collaboration');
  if (!processes.length) throw studioError('BPMN_PROCESS_MISSING', 'В BPMN-файле не найден процесс.', 422);
  const executable = processes.filter((element) => element.isExecutable === true).map((element) => element.id || '(без ID)');
  if (executable.length) {
    throw studioError(
      'EXECUTABLE_CANONICAL_MODEL',
      'Эталонная модель должна быть нейтральной и иметь isExecutable=false. Исполняемый адаптер хранится отдельно.',
      422,
      { process_ids: executable }
    );
  }
  const parserWarnings = (parsed.warnings || []).map((warning) => warning.message || String(warning));
  if (parserWarnings.length) {
    throw studioError('BPMN_REFERENCE_ERRORS', 'В BPMN найдены повреждённые или неразрешённые ссылки.', 422, {
      warnings: parserWarnings
    });
  }
  return {
    definitions_id: parsed.rootElement.id || null,
    process_ids: processes.map((element) => element.id || null),
    collaboration_ids: collaborations.map((element) => element.id || null),
    generated_id_issues: findGeneratedBpmnIds(xml)
  };
}

function assertBpmnIdentity(meta, inspection) {
  const expected = {
    definitions_id: meta?.bpmn?.definitions_id ?? null,
    process_element_id: meta?.bpmn?.process_element_id ?? null,
    collaboration_id: meta?.bpmn?.collaboration_id ?? null
  };
  const actual = {
    definitions_id: inspection.definitions_id,
    process_ids: inspection.process_ids,
    collaboration_ids: inspection.collaboration_ids
  };
  const matches = typeof expected.definitions_id === 'string'
    && expected.definitions_id.length > 0
    && typeof expected.process_element_id === 'string'
    && expected.process_element_id.length > 0
    && typeof expected.collaboration_id === 'string'
    && expected.collaboration_id.length > 0
    && actual.definitions_id === expected.definitions_id
    && actual.process_ids.length === 1
    && actual.process_ids[0] === expected.process_element_id
    && actual.collaboration_ids.length === 1
    && actual.collaboration_ids[0] === expected.collaboration_id;
  if (!matches) {
    throw studioError(
      'BPMN_PROCESS_MISMATCH',
      'Идентификаторы Definitions, Process или Collaboration в схеме не совпадают с метаданными этого процесса. Обновите Studio и повторите изменение.',
      422,
      { expected, actual }
    );
  }
}

function reopenOwnerDecisionAfterChange(meta, changed) {
  if (!changed) return { meta, reopened: false };
  const recordedDecision = new Set([ 'approved', 'rework', 'rejected' ]).has(meta?.review?.human_decision);
  const decidedTechnicalStatus = new Set([ 'approved', 'rework', 'rejected' ]).has(meta?.status);
  const decidedBusinessStatus = new Set([ 'canonical', 'rejected' ]).has(meta?.canonicality?.business_status);
  if (!recordedDecision && !decidedTechnicalStatus && !decidedBusinessStatus) {
    return { meta, reopened: false };
  }
  const nextMeta = structuredClone(meta || {});
  nextMeta.status = 'review-ready';
  nextMeta.canonicality = {
    ...(nextMeta.canonicality || {}),
    business_status: 'pending_human_decision'
  };
  nextMeta.review = {
    ...(nextMeta.review || {}),
    human_decision: 'not_recorded'
  };
  return { meta: nextMeta, reopened: true };
}

function appendDecisionReopenedNotice(notice, reopened) {
  return reopened
    ? `${notice} Ранее записанное решение владельца сброшено: изменённый процесс нужно проверить и утвердить заново.`
    : notice;
}

function atomicWriteUtf8(path, text) {
  const directory = dirname(path);
  const temporary = join(directory, `.${path.split(/[\\/]/u).at(-1)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, text, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    try {
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    } catch {
      // Windows не всегда разрешает fsync каталога; сам файл уже синхронизирован.
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function commitTextFilesWithRollback(changes, writer = atomicWriteUtf8) {
  const snapshots = [];
  const completed = [];
  const unique = new Set();
  for (const change of changes) {
    if (unique.has(change.path)) throw new Error(`Повторная запись одного файла в транзакции: ${change.path}`);
    unique.add(change.path);
    snapshots.push({
      path: change.path,
      existed: existsSync(change.path),
      text: existsSync(change.path) ? readFileSync(change.path, 'utf8') : null
    });
  }
  try {
    for (const change of changes) {
      writer(change.path, change.text);
      completed.push(change.path);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const snapshot of snapshots.filter((item) => completed.includes(item.path)).reverse()) {
      try {
        if (snapshot.existed) writer(snapshot.path, snapshot.text);
        else rmSync(snapshot.path, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push({ path: snapshot.path, message: rollbackError.message });
      }
    }
    if (rollbackErrors.length) {
      throw studioError(
        'TRANSITION_ROLLBACK_FAILED',
        'Изменение перехода не завершено, а автоматический откат одного из файлов не удался. Не продолжайте работу до проверки пакета.',
        500,
        { cause: error.message, rollback_errors: rollbackErrors }
      );
    }
    throw error;
  }
}

function defaultCommandRunner({ command, args, cwd, timeoutMs = 180_000 }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: [ 'ignore', 'pipe', 'pipe' ]
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-200_000);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString('utf8')); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString('utf8')); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(studioError('COMMAND_START_FAILED', `Не удалось запустить локальную проверку: ${error.message}`, 500));
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: exitCode ?? -1, signal, stdout, stderr, timedOut });
    });
  });
}

function cleanCommandOutput(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/gu, '').trim();
}

function createStudioCore(options = {}) {
  const projectRoot = resolve(options.projectRoot || defaultProjectRoot);
  const processesRoot = resolve(projectRoot, 'processes');
  const registryPath = resolve(projectRoot, 'registry', 'processes.json');
  const toolsRoot = resolve(projectRoot, 'tools', 'bpmn');
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const archifyAdapterPath = resolve(options.archifyAdapterPath || join(toolsRoot, 'archify-adapter.mjs'));
  const transitionWriter = options.transitionWriter || atomicWriteUtf8;
  const beforeTransitionCommit = options.beforeTransitionCommit;
  const processLocks = new Map();

  assertDirectory(processesRoot, 'Каталог процессов');
  if (realpathSync(processesRoot) !== processesRoot) {
    throw studioError('UNSAFE_PATH', 'Каталог processes не должен быть символической ссылкой.', 400);
  }

  function packagePaths(value) {
    const slug = validateSlug(value);
    const processRoot = assertContained(processesRoot, resolve(processesRoot, slug), 'Путь процесса');
    assertDirectory(processRoot, `Пакет процесса ${slug}`);
    const bpmnRoot = assertContained(processRoot, resolve(processRoot, 'bpmn'), 'Каталог BPMN');
    const bpmnPath = assertContained(processRoot, resolve(bpmnRoot, 'process.bpmn'), 'BPMN-файл');
    const metaPath = assertContained(processRoot, resolve(bpmnRoot, 'process.meta.json'), 'Метаданные процесса');
    assertDirectory(bpmnRoot, 'Каталог BPMN');
    assertRegularFile(bpmnPath, 'BPMN-файл');
    assertRegularFile(metaPath, 'Метаданные процесса');
    return { slug, processRoot, bpmnRoot, bpmnPath, metaPath };
  }

  function readJson(path, label) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw studioError('INVALID_JSON', `${label} не прочитан: ${error.message}`, 422);
    }
  }

  function readOptionalSupportingText(root, target, label, maximumBytes) {
    const path = assertContained(root, target, label);
    let entry;
    try {
      entry = lstatSync(path);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw studioError('INVALID_SUPPORTING_FILE', `${label} не прочитан: ${error.message}`, 422);
    }

    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw studioError('UNSAFE_PATH', `${label} должен быть обычным файлом внутри пакета процесса.`, 400);
    }
    if (entry.size > maximumBytes) {
      throw studioError(
        'SUPPORTING_FILE_TOO_LARGE',
        `${label} превышает допустимый размер ${maximumBytes} байт.`,
        422
      );
    }

    let descriptor;
    try {
      descriptor = openSync(path, 'r');
      const openedEntry = fstatSync(descriptor);
      if (
        !openedEntry.isFile()
        || openedEntry.dev !== entry.dev
        || openedEntry.ino !== entry.ino
      ) {
        throw studioError('UNSAFE_PATH', `${label} изменился во время безопасного чтения.`, 400);
      }
      if (openedEntry.size > maximumBytes) {
        throw studioError(
          'SUPPORTING_FILE_TOO_LARGE',
          `${label} превышает допустимый размер ${maximumBytes} байт.`,
          422
        );
      }
      return readFileSync(descriptor, 'utf8');
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw studioError('INVALID_SUPPORTING_FILE', `${label} не прочитан: ${error.message}`, 422);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  function supportingProcessFiles(paths) {
    const processCardText = readOptionalSupportingText(
      paths.processRoot,
      resolve(paths.processRoot, 'process-card.md'),
      'Карточка процесса',
      maximumProcessCardBytes
    );
    const questionsText = readOptionalSupportingText(
      paths.bpmnRoot,
      resolve(paths.bpmnRoot, 'questions.json'),
      'Вопросы владельцу процесса',
      maximumQuestionsBytes
    );

    const processCard = processCardText === null
      ? { available: false, markdown: null, sha256: null }
      : { available: true, markdown: processCardText, sha256: sha256(processCardText) };

    if (questionsText === null) {
      return {
        process_card: processCard,
        questions: {
          available: false,
          sha256: null,
          items: [],
          counts: { open: 0, blocking_open: 0 }
        }
      };
    }

    let questionsDocument;
    try {
      questionsDocument = JSON.parse(questionsText);
    } catch (error) {
      throw studioError('INVALID_QUESTIONS_JSON', `Вопросы владельцу процесса не прочитаны: ${error.message}`, 422);
    }
    if (
      !questionsDocument
      || typeof questionsDocument !== 'object'
      || Array.isArray(questionsDocument)
      || !Array.isArray(questionsDocument.questions)
    ) {
      throw studioError(
        'INVALID_QUESTIONS_JSON',
        'Вопросы владельцу процесса должны содержать JSON-объект с массивом questions.',
        422
      );
    }

    const items = questionsDocument.questions;
    return {
      process_card: processCard,
      questions: {
        available: true,
        sha256: sha256(questionsText),
        items,
        counts: {
          open: items.filter((item) => item?.status === 'open').length,
          blocking_open: items.filter((item) => item?.status === 'open' && item?.blocking === true).length
        }
      }
    };
  }

  function registryRecords() {
    if (!existsSync(registryPath)) return [];
    assertRegularFile(registryPath, 'Реестр процессов');
    const registry = readJson(registryPath, 'Реестр процессов');
    const records = [];
    for (const entry of Array.isArray(registry.processes) ? registry.processes : []) {
      const match = String(entry?.bpmn_ref ?? '').match(/^processes\/([^/]+)\/bpmn\/process\.bpmn$/u);
      if (!match || !entry?.process_id || !entry?.title) continue;
      try {
        records.push({ ...entry, slug: validateSlug(match[1]) });
      } catch {
        // Повреждённая запись не становится допустимой целью Studio.
      }
    }
    return records;
  }

  function registeredProcessIds() {
    return new Set(registryRecords().map((entry) => entry.process_id));
  }

  function archifyFreshness(paths, available) {
    const receiptPath = assertContained(
      paths.processRoot,
      resolve(paths.processRoot, 'map', 'process-map.build-receipt.json'),
      'Квитанция сборки Archify'
    );
    const stale = (reason) => ({ fresh: false, reason });

    if (!available) {
      return stale('Карта Archify ещё не собрана.');
    }
    if (!existsSync(receiptPath)) {
      return stale('Нет квитанции сборки Archify; актуальность карты не подтверждена.');
    }

    let receipt;
    try {
      const entry = lstatSync(receiptPath);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        return stale('Квитанция сборки Archify должна быть обычным файлом внутри пакета процесса.');
      }
      receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    } catch {
      return stale('Квитанция сборки Archify повреждена и не может подтвердить актуальность карты.');
    }

    const receiptBpmnSha = receipt?.source?.bpmn?.sha256;
    const receiptMetadataSha = receipt?.source?.metadata?.sha256;
    if (
      receipt?.schema !== 'archify-map-build-receipt/v1'
      || !sha256Pattern.test(String(receiptBpmnSha || ''))
      || !sha256Pattern.test(String(receiptMetadataSha || ''))
    ) {
      return stale('Квитанция сборки Archify имеет неподдерживаемый формат или не содержит SHA-256 исходников.');
    }

    const bpmnChanged = receiptBpmnSha !== sha256(readFileSync(paths.bpmnPath, 'utf8'));
    const metadataChanged = receiptMetadataSha !== sha256(readFileSync(paths.metaPath, 'utf8'));
    if (bpmnChanged && metadataChanged) {
      return stale('BPMN и метаданные изменены после последней сборки карты Archify.');
    }
    if (bpmnChanged) {
      return stale('BPMN изменён после последней сборки карты Archify.');
    }
    if (metadataChanged) {
      return stale('Метаданные изменены после последней сборки карты Archify.');
    }
    return { fresh: true, reason: null };
  }

  function processViews(paths) {
    const candidates = {
      archify: resolve(paths.processRoot, 'map', 'process-map.html'),
      navigation: resolve(paths.bpmnRoot, 'derived', 'process-navigation.html'),
      svg: resolve(paths.bpmnRoot, 'derived', 'process.svg'),
      png: resolve(paths.bpmnRoot, 'derived', 'process.png')
    };
    const result = {};
    for (const [ name, path ] of Object.entries(candidates)) {
      assertContained(paths.processRoot, path, `Представление ${name}`);
      const available = existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink();
      result[name] = {
        available,
        url: available && (name === 'archify' || name === 'navigation')
          ? `/view/${encodeURIComponent(paths.slug)}/${name}`
          : null
      };
      if (name === 'archify') Object.assign(result[name], archifyFreshness(paths, available));
    }
    return result;
  }

  function safeFallbackCard(paths, targetRef) {
    if (!targetRef || typeof targetRef !== 'string') return null;
    const base = targetRef.startsWith('./') || targetRef.startsWith('../') ? paths.bpmnRoot : projectRoot;
    const target = resolve(base, targetRef);
    try {
      assertContained(projectRoot, target, 'Карточка следующего процесса');
      if (!target.toLocaleLowerCase().endsWith('.md') || !existsSync(target)) return null;
      const entry = lstatSync(target);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 256 * 1024) return null;
      if (realpathSync(target) !== target) return null;
      const markdown = readFileSync(target, 'utf8');
      const title = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim() || null;
      return { target_ref: targetRef, title, markdown };
    } catch {
      return null;
    }
  }

  function transitionPresentations(paths, meta) {
    const registryIndex = new Map(registryRecords().map((entry) => [ entry.process_id, entry ]));
    return (Array.isArray(meta.process_links) ? meta.process_links : []).map((link) => {
      const registered = link?.target_process_id ? registryIndex.get(link.target_process_id) : null;
      if (registered) {
        return {
          ...link,
          target_resolution: 'registered_bpmn',
          target_title: registered.title,
          target_slug: registered.slug,
          open: {
            kind: 'process',
            slug: registered.slug,
            view_url: null,
            target_ref: link.target_ref || null,
            card_markdown: null
          }
        };
      }
      const card = safeFallbackCard(paths, link?.target_ref);
      if (card) {
        return {
          ...link,
          target_resolution: 'fallback_card',
          target_title: card.title,
          target_slug: null,
          open: {
            kind: 'card',
            slug: null,
            view_url: null,
            target_ref: card.target_ref,
            card_markdown: card.markdown
          }
        };
      }
      return {
        ...link,
        target_resolution: 'unresolved',
        target_title: null,
        target_slug: null,
        open: {
          kind: 'none',
          slug: null,
          view_url: null,
          target_ref: null,
          card_markdown: null
        }
      };
    });
  }

  function readProcess(value, { includeXml = true } = {}) {
    const paths = packagePaths(value);
    const xml = readFileSync(paths.bpmnPath, 'utf8');
    const metaText = readFileSync(paths.metaPath, 'utf8');
    let meta;
    try {
      meta = JSON.parse(metaText);
    } catch (error) {
      throw studioError('INVALID_JSON', `Метаданные процесса не прочитаны: ${error.message}`, 422);
    }
    const registered = registeredProcessIds().has(meta.process_id);
    const base = {
      slug: paths.slug,
      title: meta.title || paths.slug,
      process_id: meta.process_id || null,
      sha256: sha256(xml),
      meta_sha256: sha256(metaText),
      meta,
      supporting: supportingProcessFiles(paths),
      transitions: transitionPresentations(paths, meta),
      status: {
        technical: meta.status || null,
        business: meta.canonicality?.business_status || null,
        registered,
        label: humanProcessStatus(meta)
      },
      views: processViews(paths),
      generated_id_issues: findGeneratedBpmnIds(xml)
    };
    if (includeXml) base.xml = xml;
    return base;
  }

  function listProcesses() {
    const items = [];
    const skipped = [];
    for (const entry of readdirSync(processesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const item = readProcess(validateSlug(entry.name), { includeXml: false });
        items.push(item);
      } catch (error) {
        skipped.push({ slug: entry.name, message: error.message });
      }
    }
    items.sort((left, right) => left.title.localeCompare(right.title, 'ru'));
    return { items, skipped };
  }

  function listTransitionTargets(value) {
    const slug = validateSlug(value);
    const source = readProcess(slug, { includeXml: false });
    const registered = [];
    const skipped = [];
    for (const record of registryRecords()) {
      if (record.slug === slug || record.process_id === source.process_id) continue;
      try {
        const targetPaths = packagePaths(record.slug);
        const targetMeta = readJson(targetPaths.metaPath, `Метаданные процесса ${record.slug}`);
        if (targetMeta.process_id !== record.process_id) {
          throw studioError('REGISTRY_TARGET_MISMATCH', 'Идентификатор пакета не совпадает с реестром.', 422);
        }
        registered.push({
          slug: record.slug,
          process_id: record.process_id,
          title: record.title,
          status: {
            technical: record.status || targetMeta.status || null,
            business: record.business_status || targetMeta.canonicality?.business_status || null
          }
        });
      } catch (error) {
        skipped.push({ slug: record.slug, process_id: record.process_id, message: error.message });
      }
    }
    registered.sort((left, right) => left.title.localeCompare(right.title, 'ru'));

    const registryIds = new Set(registryRecords().map((entry) => entry.process_id));
    const reserved = [];
    const reservedIds = new Set();
    for (const transition of source.transitions) {
      if (
        transition.target_status !== 'candidate'
        || !transition.target_process_id
        || registryIds.has(transition.target_process_id)
        || transition.open?.kind !== 'card'
        || reservedIds.has(transition.target_process_id)
      ) continue;
      const slugFromRef = String(transition.target_ref || '').match(/\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.md$/u)?.[1] || null;
      reservedIds.add(transition.target_process_id);
      reserved.push({
        slug: slugFromRef,
        process_id: transition.target_process_id,
        title: transition.target_title || transition.label,
        target_ref: transition.target_ref,
        link_id: transition.link_id
      });
    }

    return {
      schema: 'bpmn-studio-transition-targets/v1',
      source: {
        slug: source.slug,
        process_id: source.process_id,
        title: source.title,
        bpmn_sha256: source.sha256,
        meta_sha256: source.meta_sha256
      },
      supported_relations: [ ...supportedTransitionRelations ],
      supported_target_kinds: [ ...supportedTargetKinds ],
      targets: { registered, reserved },
      transitions: source.transitions,
      skipped
    };
  }

  function resolveTransitionTarget(paths, rawTarget, label) {
    const kind = String(rawTarget?.kind ?? '').trim();
    if (!supportedTargetKinds.includes(kind)) {
      throw studioError('TARGET_KIND_INVALID', 'Выберите существующий процесс, будущий процесс или вариант «пока неизвестно».', 400);
    }
    if (kind === 'unknown') return { target: { kind }, cardChange: null };

    if (kind === 'registered') {
      const targetSlug = validateSlug(rawTarget?.slug);
      const record = registryRecords().find((entry) => entry.slug === targetSlug);
      if (!record) {
        throw studioError('REGISTERED_TARGET_NOT_FOUND', 'Выбранный процесс не найден в актуальном реестре. Обновите список целей.', 404, {
          target_slug: targetSlug
        });
      }
      if (record.slug === paths.slug) {
        throw studioError('SELF_TRANSITION_NOT_ALLOWED', 'В мастере для новичка нельзя вызвать тот же самый процесс.', 422);
      }
      const targetPaths = packagePaths(record.slug);
      const targetMeta = readJson(targetPaths.metaPath, `Метаданные процесса ${record.slug}`);
      if (targetMeta.process_id !== record.process_id) {
        throw studioError('REGISTRY_TARGET_MISMATCH', 'Идентификатор выбранного пакета не совпадает с реестром.', 422);
      }
      const cardPath = assertContained(targetPaths.processRoot, resolve(targetPaths.processRoot, 'process-card.md'), 'Карточка выбранного процесса');
      const hasCard = existsSync(cardPath) && lstatSync(cardPath).isFile() && !lstatSync(cardPath).isSymbolicLink();
      return {
        target: {
          kind,
          title: record.title,
          process_id: record.process_id,
          target_ref: hasCard ? `processes/${record.slug}/process-card.md` : null
        },
        cardChange: null
      };
    }

    const title = validateTitle(rawTarget?.title);
    const targetSlug = rawTarget?.slug === undefined || String(rawTarget.slug).trim() === ''
      ? slugifyTitle(title)
      : validateSlug(rawTarget.slug);
    if (targetSlug === paths.slug) {
      throw studioError('SELF_TRANSITION_NOT_ALLOWED', 'Короткое имя будущего процесса должно отличаться от текущего.', 422);
    }
    const targetProcessId = processIdFromSlug(targetSlug);
    const registeredCollision = registryRecords().find((entry) => entry.slug === targetSlug || entry.process_id === targetProcessId);
    if (registeredCollision) {
      throw studioError(
        'TARGET_ALREADY_REGISTERED',
        'Этот процесс уже зарегистрирован. Выберите его в списке существующих процессов.',
        409,
        { target_slug: registeredCollision.slug, target_process_id: registeredCollision.process_id }
      );
    }

    const relatedRoot = assertContained(paths.processRoot, resolve(paths.processRoot, 'related-processes'), 'Каталог будущих процессов');
    const cardPath = assertContained(relatedRoot, resolve(relatedRoot, `${targetSlug}.md`), 'Карточка будущего процесса');
    const targetRef = `processes/${paths.slug}/related-processes/${targetSlug}.md`;
    const cardText = renderReservedProcessCard({
      sourceTitle: readJson(paths.metaPath, 'Метаданные процесса').title || paths.slug,
      sourceSlug: paths.slug,
      targetTitle: title,
      targetSlug,
      targetProcessId,
      label
    });
    return {
      target: { kind, title, process_id: targetProcessId, target_ref: targetRef },
      cardChange: {
        directory: relatedRoot,
        path: cardPath,
        text: cardText,
        identityMarker: `<!-- bpmn-studio-reserved-process/v1 slug="${targetSlug}" process_id="${targetProcessId}" -->`
      }
    };
  }

  function mapTransitionError(error) {
    if (error instanceof ProcessTransitionContractError) {
      throw studioError(error.code, error.message, error.status, error.details);
    }
    throw error;
  }

  function ensureTransitionCard(change) {
    if (!change) return { write: false, createdDirectory: false };
    let createdDirectory = false;
    if (existsSync(change.directory)) {
      assertDirectory(change.directory, 'Каталог будущих процессов');
      if (realpathSync(change.directory) !== change.directory) {
        throw studioError('UNSAFE_PATH', 'Каталог будущих процессов не должен быть символической ссылкой.', 400);
      }
    } else {
      mkdirSync(change.directory);
      createdDirectory = true;
    }
    if (!existsSync(change.path)) return { write: true, createdDirectory };
    const entry = lstatSync(change.path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw studioError('UNSAFE_PATH', 'Карточка будущего процесса должна быть обычным Markdown-файлом.', 400);
    }
    if (entry.size > 256 * 1024) {
      throw studioError('RESERVED_CARD_CONFLICT', 'Файл с таким коротким именем уже существует и не является карточкой, созданной Studio.', 409);
    }
    const existingText = readFileSync(change.path, 'utf8');
    if (!existingText.includes(change.identityMarker)) {
      throw studioError(
        'RESERVED_CARD_CONFLICT',
        'Файл с таким коротким именем уже существует, но относится к другой или неподтверждённой цели. Выберите другое короткое имя.',
        409
      );
    }
    return { write: false, createdDirectory };
  }

  function assertTransitionConcurrency(paths, expectedBpmnSha256, expectedMetaSha256) {
    const expectedBpmn = validateExpectedSha(expectedBpmnSha256);
    const expectedMeta = validateExpectedMetaSha(expectedMetaSha256);
    const currentBpmn = sha256(readFileSync(paths.bpmnPath, 'utf8'));
    const currentMeta = sha256(readFileSync(paths.metaPath, 'utf8'));
    if (currentBpmn !== expectedBpmn) {
      throw studioError(
        'BPMN_CONFLICT',
        'BPMN уже изменён в другом окне. Обновите процесс и повторите свои правки.',
        409,
        { expected_sha256: expectedBpmn, current_sha256: currentBpmn, current_meta_sha256: currentMeta }
      );
    }
    if (currentMeta !== expectedMeta) {
      throw studioError(
        'META_CONFLICT',
        'Связи процесса уже изменены в другом окне. Обновите процесс и повторите свои правки.',
        409,
        { expected_meta_sha256: expectedMeta, current_meta_sha256: currentMeta, current_bpmn_sha256: currentBpmn }
      );
    }
  }

  async function saveTransition(value, {
    linkId = null,
    xml,
    expectedBpmnSha256,
    expectedMetaSha256,
    sourceElementId,
    relation,
    label,
    target: rawTarget
  }) {
    const slug = validateSlug(value);
    if (String(relation ?? '') !== 'call') {
      throw studioError('TRANSITION_RELATION_UNSUPPORTED', 'Studio пока безопасно создаёт только вызов другого процесса с возвратом.', 422, {
        supported_relations: [ ...supportedTransitionRelations ]
      });
    }
    await inspectBpmnXml(xml);
    return withProcessLock(slug, async () => {
      const paths = packagePaths(slug);
      assertTransitionConcurrency(paths, expectedBpmnSha256, expectedMetaSha256);
      const currentMeta = readJson(paths.metaPath, 'Метаданные процесса');
      const resolved = resolveTransitionTarget(paths, rawTarget, label);
      let mutation;
      try {
        mutation = await upsertCallTransition({
          xml,
          meta: currentMeta,
          linkId,
          sourceElementId,
          label,
          target: resolved.target
        });
      } catch (error) {
        mapTransitionError(error);
      }
      const inspection = await inspectBpmnXml(mutation.xml);
      assertBpmnIdentity(currentMeta, inspection);
      const currentXml = readFileSync(paths.bpmnPath, 'utf8');
      const mutationChanged = mutation.xml !== currentXml
        || JSON.stringify(mutation.meta) !== JSON.stringify(currentMeta);
      const decisionState = reopenOwnerDecisionAfterChange(mutation.meta, mutationChanged);
      mutation.meta = decisionState.meta;

      const cardState = ensureTransitionCard(resolved.cardChange);
      const changes = [];
      if (resolved.cardChange && cardState.write) changes.push({ path: resolved.cardChange.path, text: resolved.cardChange.text });
      changes.push(
        { path: paths.bpmnPath, text: mutation.xml },
        { path: paths.metaPath, text: `${JSON.stringify(mutation.meta, null, 2)}\n` }
      );
      try {
        await beforeTransitionCommit?.({ operation: linkId ? 'update' : 'create', slug, paths });
        assertTransitionConcurrency(paths, expectedBpmnSha256, expectedMetaSha256);
        commitTextFilesWithRollback(changes, transitionWriter);
      } catch (error) {
        if (cardState.createdDirectory) {
          try { rmdirSync(resolved.cardChange.directory); } catch { /* каталог уже не пуст или занят */ }
        }
        throw error;
      }
      const processData = readProcess(slug);
      return {
        transition: processData.transitions.find((item) => item.link_id === mutation.transition.link_id) || mutation.transition,
        process: processData,
        inspection,
        owner_decision_reopened: decisionState.reopened,
        notice: appendDecisionReopenedNotice(mutation.target.kind === 'registered'
          ? 'Переход создан. Следующий зарегистрированный процесс можно открыть в этом же окне Studio.'
          : mutation.target.kind === 'reserved'
            ? 'Переход создан. Короткое имя и идентификатор будущего процесса зарезервированы.'
            : 'Переход сохранён как неизвестный. Studio не подставляла процесс по догадке.', decisionState.reopened)
      };
    });
  }

  async function deleteTransition(value, {
    linkId,
    xml,
    expectedBpmnSha256,
    expectedMetaSha256
  }) {
    const slug = validateSlug(value);
    await inspectBpmnXml(xml);
    return withProcessLock(slug, async () => {
      const paths = packagePaths(slug);
      assertTransitionConcurrency(paths, expectedBpmnSha256, expectedMetaSha256);
      const currentMeta = readJson(paths.metaPath, 'Метаданные процесса');
      let mutation;
      try {
        mutation = await removeCallTransition({ xml, meta: currentMeta, linkId });
      } catch (error) {
        mapTransitionError(error);
      }
      const inspection = await inspectBpmnXml(mutation.xml);
      assertBpmnIdentity(currentMeta, inspection);
      const currentXml = readFileSync(paths.bpmnPath, 'utf8');
      const mutationChanged = mutation.xml !== currentXml
        || JSON.stringify(mutation.meta) !== JSON.stringify(currentMeta);
      const decisionState = reopenOwnerDecisionAfterChange(mutation.meta, mutationChanged);
      mutation.meta = decisionState.meta;
      await beforeTransitionCommit?.({ operation: 'delete', slug, paths });
      assertTransitionConcurrency(paths, expectedBpmnSha256, expectedMetaSha256);
      commitTextFilesWithRollback([
        { path: paths.bpmnPath, text: mutation.xml },
        { path: paths.metaPath, text: `${JSON.stringify(mutation.meta, null, 2)}\n` }
      ], transitionWriter);
      return {
        transition: null,
        removed_transition: mutation.transition,
        process: readProcess(slug),
        inspection,
        owner_decision_reopened: decisionState.reopened,
        notice: appendDecisionReopenedNotice(
          'Переход удалён; на схеме осталась обычная задача либо блок удалён, скрытой ссылки на другой процесс больше нет.',
          decisionState.reopened
        )
      };
    });
  }

  async function withProcessLock(slug, operation) {
    const queueKey = '__project_mutation__';
    const previous = processLocks.get(queueKey) || Promise.resolve();
    let release;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    processLocks.set(queueKey, gate);
    await previous.catch(() => undefined);
    try {
      return await withProjectMutationLock(
        { processesRoot },
        () => withBpmnOperationLock({ processesRoot, slug }, operation),
      );
    } catch (error) {
      if (error instanceof BpmnOperationLockError) {
        throw studioError(error.code, error.message, error.status, error.details);
      }
      throw error;
    } finally {
      release();
      if (processLocks.get(queueKey) === gate) processLocks.delete(queueKey);
    }
  }

  async function saveBpmn(value, { xml, expectedSha256 }) {
    const slug = validateSlug(value);
    const expected = validateExpectedSha(expectedSha256);
    const inspection = await inspectBpmnXml(xml);
    return withProcessLock(slug, async () => {
      const paths = packagePaths(slug);
      const currentXml = readFileSync(paths.bpmnPath, 'utf8');
      const currentSha256 = sha256(currentXml);
      if (currentSha256 !== expected) {
        throw studioError(
          'BPMN_CONFLICT',
          'BPMN уже изменён в другом окне. Обновите процесс и повторите свои правки.',
          409,
          { expected_sha256: expected, current_sha256: currentSha256 }
        );
      }
      const currentMeta = readJson(paths.metaPath, 'Метаданные процесса');
      assertBpmnIdentity(currentMeta, inspection);
      const bpmnChanged = sha256(xml) !== currentSha256;
      const decisionState = reopenOwnerDecisionAfterChange(currentMeta, bpmnChanged);
      const changes = [];
      if (bpmnChanged) changes.push({ path: paths.bpmnPath, text: xml });
      if (decisionState.reopened) {
        changes.push({ path: paths.metaPath, text: `${JSON.stringify(decisionState.meta, null, 2)}\n` });
      }
      if (changes.length) commitTextFilesWithRollback(changes, transitionWriter);
      const processData = readProcess(slug);
      return {
        process: processData,
        inspection,
        owner_decision_reopened: decisionState.reopened,
        notice: appendDecisionReopenedNotice(inspection.generated_id_issues.length
          ? 'Файл сохранён, но автоматически созданные BPMN-ID нужно заменить смысловыми перед регистрацией.'
          : 'BPMN-модель сохранена.', decisionState.reopened)
      };
    });
  }

  async function runCli(scriptName, args, timeoutMs = 180_000) {
    const scriptPath = resolve(toolsRoot, scriptName);
    assertContained(toolsRoot, scriptPath, 'Служебный сценарий');
    assertRegularFile(scriptPath, `Сценарий ${scriptName}`);
    return commandRunner({ command: process.execPath, args: [ scriptPath, ...args ], cwd: toolsRoot, timeoutMs });
  }

  async function createProcess({ title: rawTitle, slug: rawSlug }) {
    const title = validateTitle(rawTitle);
    const slug = rawSlug === undefined || String(rawSlug).trim() === ''
      ? slugifyTitle(title)
      : validateSlug(rawSlug);
    return withProcessLock(slug, async () => {
      const target = assertContained(processesRoot, resolve(processesRoot, slug), 'Путь нового процесса');
      if (existsSync(target)) throw studioError('PROCESS_EXISTS', 'Процесс с таким коротким именем уже существует.', 409);
      const result = await runCli('create-process-package.mjs', [ '--title', title, '--slug', slug, '--no-open' ]);
      if (result.timedOut) throw studioError('CREATE_TIMEOUT', 'Создание процесса не завершилось за отведённое время.', 504);
      if (result.exitCode !== 0) {
        throw studioError('CREATE_FAILED', 'Пакет процесса не создан.', 422, {
          output: cleanCommandOutput(result.stderr || result.stdout)
        });
      }
      if (!existsSync(target)) throw studioError('CREATE_RESULT_MISSING', 'Мастер завершился без готового пакета процесса.', 500);
      return { process: readProcess(slug), output: cleanCommandOutput(result.stdout) };
    });
  }

  async function runCheck(slug) {
    const paths = packagePaths(slug);
    const checks = [];
    const validation = await runCli('validate-package.mjs', [ paths.bpmnRoot ]);
    checks.push({
      id: 'package',
      title: 'Структура и метаданные пакета',
      passed: validation.exitCode === 0 && !validation.timedOut,
      output: cleanCommandOutput(validation.stderr || validation.stdout)
    });
    const lintCli = resolve(toolsRoot, 'node_modules', 'bpmnlint', 'bin', 'bpmnlint.js');
    const lintConfig = resolve(projectRoot, 'docs', '.bpmnlintrc');
    assertRegularFile(lintCli, 'Локальный bpmnlint');
    assertRegularFile(lintConfig, 'Настройки проверки BPMN');
    const lint = await commandRunner({
      command: process.execPath,
      args: [ lintCli, '--config', lintConfig, paths.bpmnPath ],
      cwd: toolsRoot,
      timeoutMs: 180_000
    });
    checks.push({
      id: 'bpmn-lint',
      title: 'Канонические правила BPMN',
      passed: lint.exitCode === 0 && !lint.timedOut,
      output: cleanCommandOutput(lint.stderr || lint.stdout)
    });
    return {
      action: 'check',
      passed: checks.every((check) => check.passed),
      checks,
      process: readProcess(slug)
    };
  }

  async function runMutationAction(slug, action, scriptName) {
    packagePaths(slug);
    const result = await runCli(scriptName, [ '--slug', slug ], 300_000);
    if (result.timedOut) throw studioError('ACTION_TIMEOUT', 'Операция не завершилась за отведённое время.', 504, { action });
    if (result.exitCode !== 0) {
      throw studioError('ACTION_FAILED', `Операция «${action === 'register' ? 'Зарегистрировать' : 'Обновить'}» не выполнена.`, 422, {
        action,
        output: cleanCommandOutput(result.stderr || result.stdout)
      });
    }
    return {
      action,
      passed: true,
      output: cleanCommandOutput(result.stdout),
      process: readProcess(slug)
    };
  }

  async function openArchify(slug) {
    const paths = packagePaths(slug);
    let buildResult = null;
    if (existsSync(archifyAdapterPath)) {
      assertRegularFile(archifyAdapterPath, 'Адаптер Archify');
      const adapter = await import(`${pathToFileURL(archifyAdapterPath).href}?studio=${statSync(archifyAdapterPath).mtimeMs}`);
      const build = adapter.buildArchifyMap
        || adapter.buildArchifyForProcess
        || adapter.ensureArchifyView
        || adapter.default;
      if (typeof build !== 'function') {
        throw studioError('ARCHIFY_ADAPTER_INVALID', 'Адаптер Archify не содержит поддерживаемой функции сборки.', 500);
      }
      try {
        buildResult = await build({
          projectRoot,
          slug,
          processRoot: paths.processRoot,
          bpmnPath: paths.bpmnPath,
          open: false
        });
      } catch (error) {
        throw studioError('ARCHIFY_BUILD_FAILED', `Archify не собрал карту процесса: ${error.message}`, 422);
      }
    }
    const processData = readProcess(slug);
    if (!processData.views.archify.available) {
      throw studioError(
        'ARCHIFY_ADAPTER_UNAVAILABLE',
        'Человекочитаемая карта ещё не собрана, а локальный адаптер Archify недоступен.',
        501
      );
    }
    return {
      action: 'open-archify',
      passed: true,
      built: buildResult !== null,
      build_result: buildResult,
      view: processData.views.archify,
      process: processData
    };
  }

  async function performAction(value, rawAction) {
    const slug = validateSlug(value);
    const action = String(rawAction ?? '').trim();
    if (action === 'check') return runCheck(slug);
    if (action === 'register') return runMutationAction(slug, action, 'register-process.mjs');
    if (action === 'update') return runMutationAction(slug, action, 'update-process.mjs');
    if (action === 'open-archify') return withProcessLock(slug, () => openArchify(slug));
    throw studioError('UNKNOWN_ACTION', 'Неизвестное действие студии.', 400, {
      supported_actions: [ 'check', 'register', 'update', 'open-archify' ]
    });
  }

  function resolveView(value, rawView) {
    const paths = packagePaths(value);
    const view = String(rawView ?? '');
    const candidates = {
      archify: resolve(paths.processRoot, 'map', 'process-map.html'),
      navigation: resolve(paths.bpmnRoot, 'derived', 'process-navigation.html')
    };
    if (!(view in candidates)) throw studioError('UNKNOWN_VIEW', 'Неизвестное представление процесса.', 404);
    const path = assertContained(paths.processRoot, candidates[view], 'Представление процесса');
    assertRegularFile(path, 'Представление процесса');
    return path;
  }

  return {
    projectRoot,
    processesRoot,
    listProcesses,
    readProcess,
    listTransitionTargets,
    saveTransition,
    deleteTransition,
    saveBpmn,
    createProcess,
    performAction,
    resolveView
  };
}

export {
  StudioError,
  atomicWriteUtf8,
  commitTextFilesWithRollback,
  createStudioCore,
  defaultCommandRunner,
  findGeneratedBpmnIds,
  inspectBpmnXml,
  sha256,
  studioError,
  validateExpectedSha,
  validateExpectedMetaSha,
  validateSlug,
  slugifyTitle,
  validateTitle
};

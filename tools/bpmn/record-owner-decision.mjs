import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import {
  acquireProjectMutationLock,
  projectMutationLockOwnerPidEnvironment,
  projectMutationLockTokenEnvironment,
  releaseBpmnOperationLock
} from './bpmn-operation-lock.mjs';

const defaultProjectRoot = resolve(import.meta.dirname, '..', '..');
const updateProcessPath = resolve(import.meta.dirname, 'update-process.mjs');
const allowedOutcomes = new Set([ 'approve', 'rework', 'reject' ]);
const windowsReservedNames = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return `Фиксация решения владельца зарегистрированного бизнес-процесса.

Использование:
  node record-owner-decision.mjs
  node record-owner-decision.mjs --slug short-name

Мастер предложит выбрать процесс и одно из решений: утвердить, вернуть на
доработку или отклонить. Контрольные суммы BPMN, карточки и доказательств
рассчитываются автоматически. После записи мастер запускает полное техническое
обновление процесса. Если оно не проходит, новое решение откатывается.

Мастер фиксирует заявление человека, но не аутентифицирует его личность и
полномочия. Перед слиянием изменение должен подтвердить уполномоченный владелец
через защищённое правило Merge Request в GitLab.`;
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

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} не удалось прочитать как JSON: ${error.message}`);
  }
}

function readJsonDocument(path, label) {
  const content = readFileSync(path);
  try {
    return { content, data: JSON.parse(content.toString('utf8')) };
  } catch (error) {
    fail(`${label} не удалось прочитать как JSON: ${error.message}`);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function portableProjectRef(projectRoot, path, label) {
  const ref = relative(projectRoot, path);
  if (!ref || ref === '..' || ref.startsWith(`..${sep}`) || isAbsolute(ref)) {
    fail(`${label} выходит за пределы проекта: ${path}`);
  }
  return ref.split(sep).join('/');
}

function assertDirectDirectory(parent, child, expectedName, label) {
  if (!existsSync(child) || !statSync(child).isDirectory()) fail(`${label} не найдена: ${child}`);
  const logical = relative(parent, child);
  const physical = relative(realpathSync(parent), realpathSync(child));
  if (logical !== expectedName || physical !== expectedName) {
    fail(`${label} должна быть обычной папкой непосредственно внутри ${parent}; ссылки не допускаются.`);
  }
}

function packageOwnedFile(baseRoot, packageRoot, ref, label) {
  if (typeof ref !== 'string' || !ref.trim()) fail(`${label} не указан.`);
  const path = resolve(baseRoot, ref);
  const logical = relative(packageRoot, path);
  if (!logical || logical === '..' || logical.startsWith(`..${sep}`) || isAbsolute(logical)) {
    fail(`${label} выходит за пределы пакета процесса: ${ref}`);
  }
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${label} не найден: ${path}`);
  const physical = relative(realpathSync(packageRoot), realpathSync(path));
  if (!physical || physical === '..' || physical.startsWith(`..${sep}`) || isAbsolute(physical)) {
    fail(`${label} физически находится за пределами пакета процесса: ${ref}`);
  }
  return path;
}

function referencedPackageFile(projectRoot, bpmnRoot, packageRoot, ref, label) {
  const base = ref.startsWith('./') || ref.startsWith('../') ? bpmnRoot : projectRoot;
  return packageOwnedFile(base, packageRoot, ref, label);
}

function loadRegisteredProcess(projectRoot, slug) {
  const normalizedSlug = validateSlug(slug);
  const processesRoot = resolve(projectRoot, 'processes');
  const registryPath = resolve(projectRoot, 'registry', 'processes.json');
  if (!existsSync(processesRoot) || !statSync(processesRoot).isDirectory()) fail(`Каталог процессов не найден: ${processesRoot}`);
  if (!existsSync(registryPath) || !statSync(registryPath).isFile()) fail(`Реестр процессов не найден: ${registryPath}`);

  const packageRoot = resolve(processesRoot, normalizedSlug);
  assertDirectDirectory(processesRoot, packageRoot, normalizedSlug, `Пакет processes/${normalizedSlug}`);
  const bpmnRoot = resolve(packageRoot, 'bpmn');
  assertDirectDirectory(packageRoot, bpmnRoot, 'bpmn', 'Папка bpmn');

  const metaPath = packageOwnedFile(bpmnRoot, packageRoot, 'process.meta.json', 'Файл process.meta.json');
  const metaDocument = readJsonDocument(metaPath, 'process.meta.json');
  const meta = metaDocument.data;
  const registry = readJson(registryPath, 'registry/processes.json');
  if (!Array.isArray(registry.processes)) fail('В registry/processes.json отсутствует массив processes.');
  const expectedMetaRef = portableProjectRef(projectRoot, metaPath, 'Ссылка на метаданные');
  const entries = registry.processes.filter((entry) => entry.meta_ref === expectedMetaRef);
  if (!entries.length) fail(`Процесс «${meta.title || normalizedSlug}» ещё не зарегистрирован.`);
  if (entries.length !== 1) fail(`Для ${expectedMetaRef} найдено несколько записей реестра.`);
  if (entries[0].process_id !== meta.process_id) {
    fail(`Идентификатор процесса в реестре не совпадает с process.meta.json: ${entries[0].process_id} / ${meta.process_id}`);
  }

  const bpmnPath = packageOwnedFile(bpmnRoot, packageRoot, meta.bpmn?.file, 'BPMN-файл');
  const questionsPath = packageOwnedFile(bpmnRoot, packageRoot, meta.review?.questions_file, 'Файл вопросов');
  const decisionsPath = packageOwnedFile(bpmnRoot, packageRoot, meta.review?.decisions_file, 'Файл решений');
  if (new Set([ metaPath, questionsPath, decisionsPath ]).size !== 3) {
    fail('Метаданные, вопросы и решения должны храниться в трёх разных файлах.');
  }
  const questionsDocument = readJsonDocument(questionsPath, basename(questionsPath));
  const decisionsDocument = readJsonDocument(decisionsPath, basename(decisionsPath));
  const questions = questionsDocument.data;
  const decisions = decisionsDocument.data;
  if (!Array.isArray(questions.questions)) fail('В файле вопросов отсутствует массив questions.');
  if (!Array.isArray(decisions.decisions)) fail('В файле решений отсутствует массив decisions.');
  if (meta.process_id !== questions.process_id || meta.process_id !== decisions.process_id) {
    fail('process_id различается между process.meta.json, questions.json и decisions.json.');
  }
  if (meta.version !== questions.model_version || meta.version !== decisions.model_version) {
    fail('Версия модели различается между process.meta.json, questions.json и decisions.json.');
  }

  const sourceCardPath = referencedPackageFile(projectRoot, bpmnRoot, packageRoot, meta.source_card?.ref, 'Карточка процесса');
  if (!Array.isArray(meta.evidence) || !meta.evidence.length) fail('В process.meta.json не указаны доказательства процесса.');
  const evidencePaths = meta.evidence.map((item, index) =>
    referencedPackageFile(projectRoot, bpmnRoot, packageRoot, item.ref, `Доказательство ${index + 1}`)
  );

  return {
    slug: normalizedSlug,
    projectRoot,
    registryPath,
    packageRoot,
    bpmnRoot,
    metaPath,
    questionsPath,
    decisionsPath,
    bpmnPath,
    sourceCardPath,
    evidencePaths,
    registryEntry: entries[0],
    meta,
    metaOriginal: metaDocument.content,
    questions,
    questionsOriginal: questionsDocument.content,
    decisions,
    decisionsOriginal: decisionsDocument.content
  };
}

function nonEmptyText(value, label) {
  const text = String(value ?? '').trim();
  if (text.length < 3) fail(`${label} должен содержать не менее трёх символов.`);
  return text;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) fail('Не удалось определить время решения владельца.');
  return date.toISOString();
}

function answerFor(answers, questionId) {
  if (answers instanceof Map) return answers.get(questionId);
  return answers?.[questionId];
}

function makeDecisionId(processId, outcome, decidedAt, existingIds) {
  const stamp = decidedAt.replace(/[-:.]/gu, '');
  const base = `DECISION-${processId}-${stamp}-${outcome.toUpperCase()}`;
  if (!existingIds.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function prepareOwnerDecision(selected, { outcome, ownerRole, comment, answers = {}, now = new Date() }) {
  if (!allowedOutcomes.has(outcome)) fail(`Неизвестное решение владельца: ${outcome}`);
  const role = nonEmptyText(ownerRole, 'Роль уполномоченного владельца');
  const decisionComment = nonEmptyText(comment, 'Комментарий к итоговому решению');
  const decidedAt = isoTimestamp(now);
  const meta = structuredClone(selected.meta);
  const questions = structuredClone(selected.questions);
  const decisions = structuredClone(selected.decisions);

  meta.source_card.sha256 = sha256(selected.sourceCardPath);
  meta.evidence.forEach((item, index) => {
    item.sha256 = sha256(selected.evidencePaths[index]);
  });

  if (outcome === 'approve') {
    const openBlocking = questions.questions.filter((question) => question.blocking && question.status === 'open');
    for (const question of openBlocking) {
      const answer = nonEmptyText(answerFor(answers, question.question_id), `Ответ на вопрос «${question.title}»`);
      question.status = 'answered';
      question.answer = answer;
      question.answered_by = role;
      question.answered_at = decidedAt;
    }
    meta.status = 'approved';
    meta.canonicality.syntax_status = 'validated';
    meta.canonicality.profile_status = 'validated';
    meta.canonicality.business_status = 'canonical';
    meta.review.human_decision = 'approved';
  } else if (outcome === 'rework') {
    meta.status = 'rework';
    meta.canonicality.business_status = 'pending_human_decision';
    meta.review.human_decision = 'rework';
  } else {
    meta.status = 'rejected';
    meta.canonicality.business_status = 'rejected';
    meta.review.human_decision = 'rejected';
  }
  meta.review.owner_role = role;

  const existingIds = new Set(decisions.decisions.map((decision) => decision.decision_id));
  const decision = {
    decision_id: makeDecisionId(meta.process_id, outcome, decidedAt, existingIds),
    question_id: null,
    outcome,
    actor: role,
    comment: decisionComment,
    decided_at: decidedAt,
    bpmn_sha256: sha256(selected.bpmnPath),
    source_card_sha256: meta.source_card.sha256,
    evidence_sha256: meta.evidence.map((item) => item.sha256)
  };
  decisions.decisions.push(decision);

  return { meta, questions, decisions, decision };
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fsyncFile(path) {
  const descriptor = openSync(path, 'r+');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function unlinkIfExists(path) {
  const directory = dirname(path);
  const ghostPrefix = `${basename(path).toUpperCase()}.TMP`;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  const quietPassesRequired = path.endsWith('.backup-json') ? 10 : 1;
  let quietPasses = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      unlinkSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT' && !new Set([ 'EPERM', 'EBUSY', 'EACCES' ]).has(error.code)) throw error;
    }
    const ghosts = readdirSync(directory)
      .filter((name) => name.toUpperCase().startsWith(ghostPrefix))
      .map((name) => resolve(directory, name));
    if (!ghosts.length && !existsSync(path)) {
      quietPasses += 1;
      if (quietPasses >= quietPassesRequired) return;
    } else {
      quietPasses = 0;
    }
    for (const ghost of ghosts) {
      try {
        unlinkSync(ghost);
      } catch (error) {
        if (!new Set([ 'ENOENT', 'EPERM', 'EBUSY', 'EACCES' ]).has(error.code)) throw error;
      }
    }
    Atomics.wait(waitBuffer, 0, 0, 10);
  }
  fail(`Не удалось удалить временный файл транзакции рядом с ${path}.`);
}

function createTransactionFiles(selected, prepared) {
  const suffix = `${process.pid}-${randomBytes(8).toString('hex')}`;
  return [
    { label: 'process.meta.json', path: selected.metaPath, original: selected.metaOriginal, replacement: jsonBuffer(prepared.meta) },
    { label: basename(selected.questionsPath), path: selected.questionsPath, original: selected.questionsOriginal, replacement: jsonBuffer(prepared.questions) },
    { label: basename(selected.decisionsPath), path: selected.decisionsPath, original: selected.decisionsOriginal, replacement: jsonBuffer(prepared.decisions) }
  ].map((file) => ({
    ...file,
    tempPath: resolve(dirname(file.path), `.${basename(file.path)}.${suffix}.tmp`),
    backupPath: resolve(dirname(file.path), `.${basename(file.path)}.${suffix}.backup-json`),
    backedUp: false,
    installed: false
  }));
}

function prepareTransactionFiles(files) {
  try {
    for (const file of files) {
      writeFileSync(file.tempPath, file.replacement, { flag: 'wx' });
      fsyncFile(file.tempPath);
    }
    for (const file of files) {
      if (!readFileSync(file.path).equals(file.original)) {
        fail(`${file.label} изменился во время подготовки решения. Запустите мастер ещё раз.`);
      }
    }
  } catch (error) {
    for (const file of files) unlinkIfExists(file.tempPath);
    throw error;
  }
}

function commitTransactionFiles(files) {
  try {
    for (const file of files) {
      if (!readFileSync(file.path).equals(file.original)) {
        fail(`${file.label} изменился непосредственно перед записью решения. Запустите мастер ещё раз.`);
      }
    }
    for (const file of files) {
      renameSync(file.path, file.backupPath);
      file.backedUp = true;
    }
    for (const file of files) {
      renameSync(file.tempPath, file.path);
      file.installed = true;
    }
  } catch (error) {
    const rollbackErrors = rollbackTransactionFiles(files);
    cleanupTransactionFiles(files, rollbackErrors.length === 0);
    const suffix = rollbackErrors.length ? ` Ошибки отката: ${rollbackErrors.join('; ')}.` : '';
    throw new Error(`Не удалось атомарно записать решение: ${error.message}.${suffix}`);
  }
}

function rollbackTransactionFiles(files) {
  const errors = [];
  for (const file of [ ...files ].reverse()) {
    try {
      if (file.installed) {
        if (!existsSync(file.path)) {
          errors.push(`${file.label}: новый файл исчез до отката`);
          continue;
        }
        const current = readFileSync(file.path);
        if (current.equals(file.original)) {
          file.installed = false;
          if (file.backedUp && existsSync(file.backupPath)) unlinkIfExists(file.backupPath);
          file.backedUp = false;
          continue;
        }
        if (!current.equals(file.replacement)) {
          errors.push(`${file.label}: файл изменён после записи; резервная копия сохранена: ${file.backupPath}`);
          continue;
        }
        unlinkIfExists(file.path);
        file.installed = false;
      }
      if (file.backedUp) {
        if (existsSync(file.path)) {
          errors.push(`${file.label}: нельзя восстановить резервную копию поверх изменённого файла`);
          continue;
        }
        renameSync(file.backupPath, file.path);
        file.backedUp = false;
      }
    } catch (error) {
      errors.push(`${file.label}: ${error.message}`);
    }
  }
  return errors;
}

function cleanupTransactionFiles(files, removeBackups) {
  for (const file of files) {
    unlinkIfExists(file.tempPath);
    if (removeBackups) unlinkIfExists(file.backupPath);
  }
}

function runUpdateProcess({
  slug,
  projectRoot,
  projectMutationLockToken,
  projectMutationLockOwnerPid
}) {
  if (resolve(projectRoot) !== defaultProjectRoot) {
    fail('Штатный update-process.mjs можно запускать только для основного проекта. В тестах передайте отдельный updateRunner.');
  }
  const result = spawnSync(process.execPath, [ updateProcessPath, '--slug', slug ], {
    cwd: dirname(updateProcessPath),
    env: {
      ...process.env,
      [projectMutationLockTokenEnvironment]: projectMutationLockToken,
      [projectMutationLockOwnerPidEnvironment]: String(projectMutationLockOwnerPid)
    },
    stdio: 'inherit'
  });
  if (result.error) fail(`Не удалось запустить техническое обновление: ${result.error.message}`);
  if (result.status !== 0) fail(`Техническое обновление завершилось с кодом ${result.status ?? 'неизвестно'}.`);
}

function recordOwnerDecision({
  projectRoot = defaultProjectRoot,
  slug,
  outcome,
  ownerRole,
  comment,
  answers = {},
  now = new Date(),
  updateRunner = runUpdateProcess
}) {
  const resolvedProjectRoot = resolve(projectRoot);
  const projectLock = acquireProjectMutationLock(resolve(resolvedProjectRoot, 'processes'), { borrowedClaim: null });
  try {
    const selected = loadRegisteredProcess(resolvedProjectRoot, slug);
    const prepared = prepareOwnerDecision(selected, { outcome, ownerRole, comment, answers, now });
    const files = createTransactionFiles(selected, prepared);
    prepareTransactionFiles(files);
    commitTransactionFiles(files);
    try {
      updateRunner({
        slug: selected.slug,
        projectRoot: selected.projectRoot,
        selected,
        prepared,
        projectMutationLockToken: projectLock.borrowToken,
        projectMutationLockOwnerPid: projectLock.pid
      });
      cleanupTransactionFiles(files, true);
      return { selected, prepared };
    } catch (error) {
      const rollbackErrors = rollbackTransactionFiles(files);
      cleanupTransactionFiles(files, rollbackErrors.length === 0);
      const suffix = rollbackErrors.length
        ? ` Ошибки безопасного отката: ${rollbackErrors.join('; ')}.`
        : ' Новое решение и ответы полностью отменены.';
      throw new Error(`${error.message}${suffix}`);
    }
  } finally {
    releaseBpmnOperationLock(projectLock);
  }
}

function registeredCandidates(projectRoot) {
  const registryPath = resolve(projectRoot, 'registry', 'processes.json');
  const registry = readJson(registryPath, 'registry/processes.json');
  if (!Array.isArray(registry.processes)) fail('В registry/processes.json отсутствует массив processes.');
  const candidates = [];
  const warnings = [];
  for (const entry of registry.processes) {
    const match = /^processes\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/bpmn\/process\.meta\.json$/u.exec(entry.meta_ref || '');
    if (!match) {
      warnings.push(`Пропущена нестандартная запись «${entry.title || entry.process_id || 'без названия'}».`);
      continue;
    }
    try {
      const selected = loadRegisteredProcess(projectRoot, match[1]);
      candidates.push({ slug: selected.slug, title: selected.meta.title, status: selected.meta.status });
    } catch (error) {
      warnings.push(`Пропущен процесс «${entry.title || entry.process_id}»: ${error.message}`);
    }
  }
  candidates.sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  return { candidates, warnings };
}

async function askNonEmpty(terminal, prompt, label) {
  while (true) {
    const answer = (await terminal.question(prompt)).trim();
    try {
      return nonEmptyText(answer, label);
    } catch (error) {
      console.error(error.message);
    }
  }
}

async function chooseSlug(terminal, projectRoot) {
  const { candidates, warnings } = registeredCandidates(projectRoot);
  warnings.forEach((warning) => console.warn(warning));
  if (!candidates.length) fail('Зарегистрированные процессы не найдены.');
  console.log('Выберите процесс:');
  candidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate.title}`));
  while (true) {
    const answer = (await terminal.question(`Номер процесса [1-${candidates.length}]: `)).trim();
    const number = Number(answer);
    if (Number.isInteger(number) && number >= 1 && number <= candidates.length) return candidates[number - 1].slug;
    console.error('Введите номер процесса из списка.');
  }
}

async function chooseOutcome(terminal) {
  console.log('\nКакое решение принял уполномоченный владелец?');
  console.log('  1. Утвердить текущую версию');
  console.log('  2. Вернуть на доработку');
  console.log('  3. Отклонить текущую версию');
  const outcomes = [ 'approve', 'rework', 'reject' ];
  while (true) {
    const answer = (await terminal.question('Номер решения [1-3]: ')).trim();
    const number = Number(answer);
    if (Number.isInteger(number) && number >= 1 && number <= 3) return outcomes[number - 1];
    console.error('Введите 1, 2 или 3.');
  }
}

async function collectInteractiveInput(terminal, selected) {
  console.log(`\nПроцесс: ${selected.meta.title}`);
  console.log(`Текущий статус: ${selected.meta.status}`);
  console.log('Важно: локальный мастер не проверяет личность и полномочия. Итоговое изменение должно пройти защищённое согласование Merge Request в GitLab.');
  const outcome = await chooseOutcome(terminal);
  const ownerRole = await askNonEmpty(
    terminal,
    'Полное название роли уполномоченного владельца: ',
    'Роль уполномоченного владельца'
  );
  const answers = {};
  if (outcome === 'approve') {
    const openBlocking = selected.questions.questions.filter((question) => question.blocking && question.status === 'open');
    if (openBlocking.length) console.log('\nДля утверждения ответьте на все блокирующие вопросы.');
    for (let index = 0; index < openBlocking.length; index += 1) {
      const question = openBlocking[index];
      console.log(`\nВопрос ${index + 1} из ${openBlocking.length}: ${question.title}`);
      answers[question.question_id] = await askNonEmpty(terminal, 'Ответ владельца: ', 'Ответ владельца');
    }
  }
  const comment = await askNonEmpty(terminal, '\nКомментарий к итоговому решению: ', 'Комментарий к итоговому решению');
  const labels = {
    approve: 'утвердить текущую версию',
    rework: 'вернуть текущую версию на доработку',
    reject: 'отклонить текущую версию'
  };
  console.log('\nПроверьте решение перед записью:');
  console.log(`  Процесс: ${selected.meta.title}`);
  console.log(`  Решение: ${labels[outcome]}`);
  console.log(`  Роль владельца: ${ownerRole}`);
  console.log(`  Комментарий: ${comment}`);
  const confirmation = (await terminal.question('Введите ДА, если указанное решение действительно принял уполномоченный владелец: ')).trim().toLocaleLowerCase('ru-RU');
  if (confirmation !== 'да') fail('Решение не записано: пользователь отменил операцию.');
  return { outcome, ownerRole, comment, answers };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!process.stdin.isTTY) {
    fail('Мастер решения работает в интерактивном окне терминала. Запустите корневой CMD-файл двойным щелчком.');
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const slug = options.slug === undefined ? await chooseSlug(terminal, defaultProjectRoot) : validateSlug(options.slug);
    const selected = loadRegisteredProcess(defaultProjectRoot, slug);
    const input = await collectInteractiveInput(terminal, selected);
    const result = recordOwnerDecision({ slug, ...input });
    const resultLabels = {
      approve: 'Текущая версия утверждена владельцем.',
      rework: 'Текущая версия возвращена владельцем на доработку.',
      reject: 'Текущая версия отклонена владельцем.'
    };
    console.log(`\n${resultLabels[input.outcome]}`);
    console.log('Техническая проверка, перестроение схем и синхронизация реестра завершены успешно.');
    console.log('Локальная запись не аутентифицирует владельца: подтвердите изменение защищённым согласованием Merge Request в GitLab.');
    if (input.outcome === 'approve') {
      console.log('Статусы технической проверки подтверждены выполненными проверками; бизнес-утверждение записано только по вашему явному выбору.');
    }
    console.log(`Запись решения: ${result.prepared.decision.decision_id}`);
  } finally {
    terminal.close();
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Ошибка фиксации решения владельца: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  cleanupTransactionFiles,
  commitTransactionFiles,
  loadRegisteredProcess,
  parseArguments,
  prepareOwnerDecision,
  prepareTransactionFiles,
  recordOwnerDecision,
  registeredCandidates,
  rollbackTransactionFiles,
  validateSlug
};

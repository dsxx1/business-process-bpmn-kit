import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { buildArchifyMap } from './archify-adapter.mjs';

const codeProjectRoot = resolve(import.meta.dirname, '..', '..');
const sha256Pattern = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function portablePath(root, path) {
  return relative(root, path).split(sep).join('/');
}

function assertContained(root, candidate, label) {
  const relation = relative(root, candidate);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail(`${label} выходит за пределы разрешённого каталога.`);
  }
}

function safeDirectory(root, parts, label) {
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    assertContained(root, current, label);
    if (!existsSync(current)) fail(`${label} не найден: ${portablePath(root, current)}`);
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) fail(`${label} не должен проходить через символическую ссылку или точку соединения.`);
    if (!entry.isDirectory()) fail(`${label} должен быть обычным каталогом.`);
  }
  const physical = realpathSync(current);
  assertContained(realpathSync(root), physical, label);
  return current;
}

function safeProjectRef(root, ref, label, expectedRef = null) {
  if (typeof ref !== 'string' || !ref.trim()) fail(`${label}: ссылка не указана.`);
  if (ref !== ref.trim() || isAbsolute(ref) || ref.includes('\\')) {
    fail(`${label}: требуется переносимая относительная ссылка внутри проекта.`);
  }
  const parts = ref.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail(`${label}: ссылка содержит небезопасный сегмент пути.`);
  }
  if (expectedRef !== null && ref !== expectedRef) {
    fail(`${label}: ожидается ${expectedRef}, получено ${ref}.`);
  }

  let current = root;
  for (const [ index, part ] of parts.entries()) {
    current = resolve(current, part);
    assertContained(root, current, label);
    if (!existsSync(current)) fail(`${label} не найден: ${ref}`);
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) {
      fail(`${label} не должен проходить через символическую ссылку или точку соединения: ${ref}`);
    }
    if (index < parts.length - 1 && !entry.isDirectory()) {
      fail(`${label}: промежуточный компонент не является каталогом: ${ref}`);
    }
    if (index === parts.length - 1 && !entry.isFile()) {
      fail(`${label} должен быть обычным файлом: ${ref}`);
    }
  }

  const physical = realpathSync(current);
  assertContained(realpathSync(root), physical, label);
  return current;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} содержит некорректный JSON: ${error.message}`);
  }
}

function verifyDigest(path, expected, label, { requireBytes = false } = {}) {
  if (!expected || typeof expected !== 'object' || !sha256Pattern.test(String(expected.sha256 || ''))) {
    fail(`${label}: в квитанции отсутствует корректный SHA-256.`);
  }
  if (requireBytes && (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0)) {
    fail(`${label}: в квитанции отсутствует корректный размер файла.`);
  }
  const bytes = readFileSync(path);
  const actual = { sha256: sha256(bytes), bytes: bytes.length };
  if (actual.sha256 !== expected.sha256) {
    fail(`${label}: SHA-256 не совпадает с квитанцией.`);
  }
  if (requireBytes && actual.bytes !== expected.bytes) {
    fail(`${label}: размер не совпадает с квитанцией.`);
  }
  return { ...actual, bytesContent: bytes };
}

function verifyToolIdentity(receipt, packagePath) {
  const packageDocument = readJson(packagePath, 'Описание встроенного Archify');
  const tool = receipt.tool;
  if (!tool || typeof tool !== 'object') fail('В квитанции отсутствует описание Archify.');
  const expected = {
    name: 'Archify',
    version: packageDocument.version,
    upstream_version: packageDocument.archifyBuild?.upstreamVersion,
    upstream_revision: packageDocument.archifyBuild?.upstreamRevision,
    build_profile: packageDocument.archifyBuild?.profile,
    license: packageDocument.license,
  };
  for (const [ key, value ] of Object.entries(expected)) {
    if (tool[key] !== value) fail(`Квитанция Archify: поле ${key} не совпадает с package.json.`);
  }
  if (!Number.isSafeInteger(tool.vendored_files) || tool.vendored_files < 1) {
    fail('Квитанция Archify: vendored_files должен быть положительным целым числом.');
  }
}

function copyRebuildInputs(paths, temporaryProjectRoot, slug, { includeMapSources = true } = {}) {
  const temporaryProcessRoot = resolve(temporaryProjectRoot, 'processes', slug);
  const temporaryBpmnRoot = resolve(temporaryProcessRoot, 'bpmn');
  const temporaryMapRoot = resolve(temporaryProcessRoot, 'map');
  mkdirSync(temporaryBpmnRoot, { recursive: true });
  mkdirSync(temporaryMapRoot, { recursive: true });
  copyFileSync(paths.bpmn, resolve(temporaryBpmnRoot, 'process.bpmn'));
  copyFileSync(paths.metadata, resolve(temporaryBpmnRoot, 'process.meta.json'));
  if (includeMapSources) {
    copyFileSync(paths.workflow, resolve(temporaryMapRoot, 'process-map.workflow.json'));
    copyFileSync(paths.bindings, resolve(temporaryMapRoot, 'process-map.bindings.json'));
  }
}

export async function verifyArchifyFreshness({
  slug,
  projectRoot = codeProjectRoot,
} = {}) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    fail('Укажите короткое название процесса из латинских букв, цифр и дефисов.');
  }

  const requestedProjectRoot = resolve(projectRoot);
  if (!existsSync(requestedProjectRoot)) fail('Корень проекта не найден.');
  const projectRootEntry = lstatSync(requestedProjectRoot);
  if (projectRootEntry.isSymbolicLink() || !projectRootEntry.isDirectory()) {
    fail('Корень проекта должен быть обычным каталогом, а не символической ссылкой или точкой соединения.');
  }
  const resolvedProjectRoot = realpathSync(requestedProjectRoot);
  const processRoot = safeDirectory(resolvedProjectRoot, [ 'processes', slug ], 'Каталог процесса');
  const expected = {
    bpmn: `processes/${slug}/bpmn/process.bpmn`,
    metadata: `processes/${slug}/bpmn/process.meta.json`,
    workflow: `processes/${slug}/map/process-map.workflow.json`,
    bindings: `processes/${slug}/map/process-map.bindings.json`,
    artifact: `processes/${slug}/map/process-map.html`,
    receipt: `processes/${slug}/map/process-map.build-receipt.json`,
    runtime: 'vendor/archify',
    localizer: 'tools/bpmn/localize-map-ru.mjs',
    mapValidator: 'tools/bpmn/validate-map-ui.mjs',
    bindingsValidator: 'tools/bpmn/validate-map-bindings.mjs',
  };

  const receiptPath = safeProjectRef(resolvedProjectRoot, expected.receipt, 'Квитанция Archify', expected.receipt);
  const receipt = readJson(receiptPath, 'Квитанция Archify');
  if (receipt.schema !== 'archify-map-build-receipt/v1') {
    fail(`Неподдерживаемая схема квитанции Archify: ${receipt.schema || '(не указана)'}.`);
  }
  if (receipt.process?.slug !== slug) fail('Квитанция Archify относится к другому процессу.');

  const paths = {
    bpmn: safeProjectRef(resolvedProjectRoot, receipt.source?.bpmn?.ref, 'BPMN', expected.bpmn),
    metadata: safeProjectRef(resolvedProjectRoot, receipt.source?.metadata?.ref, 'Метаданные', expected.metadata),
    workflow: safeProjectRef(resolvedProjectRoot, receipt.source?.workflow?.ref, 'Исходник карты Archify', expected.workflow),
    bindings: safeProjectRef(resolvedProjectRoot, receipt.source?.bindings?.ref, 'Привязки карты к BPMN', expected.bindings),
    artifact: safeProjectRef(resolvedProjectRoot, receipt.artifact?.ref, 'HTML-карта Archify', expected.artifact),
  };

  const digests = {
    bpmn: verifyDigest(paths.bpmn, receipt.source.bpmn, 'BPMN', { requireBytes: true }),
    metadata: verifyDigest(paths.metadata, receipt.source.metadata, 'Метаданные', { requireBytes: true }),
    workflow: verifyDigest(paths.workflow, receipt.source.workflow, 'Исходник карты Archify', { requireBytes: true }),
    bindings: verifyDigest(paths.bindings, receipt.source.bindings, 'Привязки карты к BPMN', { requireBytes: true }),
    artifact: verifyDigest(paths.artifact, receipt.artifact, 'HTML-карта Archify', { requireBytes: true }),
  };

  const metadata = readJson(paths.metadata, 'Метаданные процесса');
  if (receipt.process?.process_id !== metadata.process_id || receipt.process?.title !== metadata.title) {
    fail('Идентичность процесса в квитанции Archify не совпадает с метаданными.');
  }

  if (receipt.tool?.runtime_ref !== expected.runtime) {
    fail(`Квитанция Archify: ожидается runtime_ref ${expected.runtime}.`);
  }
  safeDirectory(codeProjectRoot, expected.runtime.split('/'), 'Встроенный runtime Archify');
  const packagePath = safeProjectRef(codeProjectRoot, `${expected.runtime}/package.json`, 'package.json Archify');
  const manifestPath = safeProjectRef(codeProjectRoot, `${expected.runtime}/VENDORED-FILES.sha256`, 'Манифест Archify');
  verifyDigest(packagePath, { sha256: receipt.tool?.package_sha256 }, 'package.json Archify');
  const manifestDigest = verifyDigest(manifestPath, { sha256: receipt.tool?.manifest_sha256 }, 'Манифест Archify');
  const manifestFiles = manifestDigest.bytesContent.toString('utf8').split(/\r?\n/u).filter(Boolean);
  if (manifestFiles.length !== receipt.tool?.vendored_files) {
    fail('Количество файлов в манифесте Archify не совпадает с квитанцией.');
  }
  verifyToolIdentity(receipt, packagePath);

  const localizerPath = safeProjectRef(codeProjectRoot, receipt.presentation?.localizer_ref, 'Локализатор карты', expected.localizer);
  const mapValidatorPath = safeProjectRef(codeProjectRoot, receipt.presentation?.validator_ref, 'Валидатор интерфейса карты', expected.mapValidator);
  const bindingsValidatorPath = safeProjectRef(
    codeProjectRoot,
    receipt.validation?.map_to_bpmn?.validator_ref,
    'Валидатор привязок карты',
    expected.bindingsValidator,
  );
  verifyDigest(localizerPath, { sha256: receipt.presentation?.localizer_sha256 }, 'Локализатор карты');
  verifyDigest(mapValidatorPath, { sha256: receipt.presentation?.validator_sha256 }, 'Валидатор интерфейса карты');
  verifyDigest(
    bindingsValidatorPath,
    { sha256: receipt.validation?.map_to_bpmn?.validator_sha256 },
    'Валидатор привязок карты',
  );

  const temporaryProjectRoot = mkdtempSync(join(tmpdir(), `bpmn-archify-freshness-${process.pid}-${randomBytes(4).toString('hex')}-`));
  try {
    mkdirSync(resolve(temporaryProjectRoot, 'processes'));
    copyRebuildInputs(paths, temporaryProjectRoot, slug, {
      includeMapSources: receipt.source?.automatic_draft !== true,
    });
    const rebuilt = await buildArchifyMap({ slug, projectRoot: temporaryProjectRoot });
    const rebuiltArtifact = readFileSync(rebuilt.paths.artifact);
    const rebuiltReceipt = readFileSync(rebuilt.paths.receipt);
    const committedReceipt = readFileSync(receiptPath);
    if (!digests.artifact.bytesContent.equals(rebuiltArtifact)) {
      fail('HTML-карта Archify устарела: повторная сборка дала другие байты.');
    }
    if (!committedReceipt.equals(rebuiltReceipt)) {
      fail('Квитанция Archify устарела: повторная сборка дала другие байты.');
    }
  } finally {
    if (existsSync(temporaryProjectRoot)) rmSync(temporaryProjectRoot, { recursive: true, force: true });
  }

  return {
    status: 'passed',
    slug,
    process_id: metadata.process_id,
    receipt: portablePath(resolvedProjectRoot, receiptPath),
    artifact_sha256: digests.artifact.sha256,
    checked_receipt_files: 10,
    vendored_files: receipt.tool.vendored_files,
    deterministic_rebuild: true,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const slug = args.find((arg) => !arg.startsWith('--'));
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--json');
  if (!slug || unknown.length || args.filter((arg) => !arg.startsWith('--')).length !== 1) {
    console.error('Использование: node verify-archify-freshness.mjs <короткое-название> [--json]');
    process.exitCode = 2;
    return;
  }
  try {
    const result = await verifyArchifyFreshness({ slug });
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(`Archify-карта актуальна: ${result.slug}; SHA-256 ${result.artifact_sha256}.`);
  } catch (error) {
    console.error(`Проверка актуальности Archify не пройдена: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await runCli();

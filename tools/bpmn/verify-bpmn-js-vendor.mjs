import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_NAME = 'bpmn-js';
const EXPECTED_VERSION = '18.25.1';
const EXPECTED_NPM_INTEGRITY = 'sha512-wT/TjzUQw3o5vU6nI2tytOhOm9atf2tOgCdCKF6sQUvokZ0nOEH7yfE9IvwKXclfdUxvdawgU80h909hvQJ9hw==';
const MANIFEST_NAME = 'VENDORED-FILES.sha256';
const defaultVendoredBpmnJsRoot = resolve(import.meta.dirname, '../../vendor/bpmn-js');

const REQUIRED_RUNTIME_FILES = Object.freeze([
  'LICENSE',
  'PROVENANCE.md',
  'SOURCE.json',
  'assets/bpmn-font/css/bpmn.css',
  'assets/bpmn-font/font/bpmn.eot',
  'assets/bpmn-font/font/bpmn.svg',
  'assets/bpmn-font/font/bpmn.ttf',
  'assets/bpmn-font/font/bpmn.woff',
  'assets/bpmn-font/font/bpmn.woff2',
  'assets/bpmn-js.css',
  'assets/diagram-js.css',
  'bpmn-modeler.production.min.js'
]);

const EXPECTED_UPSTREAM_PATHS = Object.freeze([
  'LICENSE',
  'dist/bpmn-modeler.production.min.js',
  'dist/assets/bpmn-js.css',
  'dist/assets/diagram-js.css',
  'dist/assets/bpmn-font/css/bpmn.css',
  'dist/assets/bpmn-font/font/bpmn.eot',
  'dist/assets/bpmn-font/font/bpmn.svg',
  'dist/assets/bpmn-font/font/bpmn.ttf',
  'dist/assets/bpmn-font/font/bpmn.woff',
  'dist/assets/bpmn-font/font/bpmn.woff2'
]);

function stableCompare(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message, details = undefined) {
  const error = new Error(message);
  error.code = 'BPMN_JS_VENDOR_INVALID';
  error.details = details;
  throw error;
}

function posixRelative(root, candidate) {
  return relative(root, candidate).split(sep).join('/');
}

function requireInside(root, candidate, label) {
  const rel = relative(root, candidate);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${label} должен находиться внутри каталога встроенного bpmn-js.`, { path: candidate });
  }
  return candidate;
}

function requireRegularFile(path, root, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail(`${label} отсутствует: ${path}`, { cause: error.message });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} должен быть обычным файлом без символических ссылок: ${path}`);
  }
  const real = realpathSync(path);
  requireInside(root, real, label);
  return real;
}

function vendoredRelativeFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = resolve(directory, entry.name);
    if (candidate !== root) requireInside(root, candidate, 'Файл встроенного bpmn-js');
    if (entry.isSymbolicLink()) {
      fail(`Встроенный bpmn-js не должен содержать символическую ссылку: ${candidate}`);
    }
    if (entry.isDirectory()) {
      files.push(...vendoredRelativeFiles(root, candidate));
    } else if (entry.isFile()) {
      const relativePath = posixRelative(root, candidate);
      if (relativePath !== MANIFEST_NAME) files.push(relativePath);
    } else {
      fail(`Во встроенном bpmn-js найден неподдерживаемый объект: ${candidate}`);
    }
  }
  return files.sort(stableCompare);
}

function validateManifestPath(relativePath) {
  if (
    !relativePath
    || relativePath.includes('\\')
    || relativePath.startsWith('/')
    || relativePath.endsWith('/')
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    fail(`Некорректный путь в манифесте bpmn-js: ${relativePath}`);
  }
}

function readSourceMetadata(root) {
  let source;
  try {
    source = JSON.parse(readFileSync(resolve(root, 'SOURCE.json'), 'utf8'));
  } catch (error) {
    fail(`SOURCE.json встроенного bpmn-js содержит некорректный JSON: ${error.message}`);
  }
  if (source.name !== EXPECTED_NAME || source.version !== EXPECTED_VERSION) {
    fail(`Ожидался ${EXPECTED_NAME} ${EXPECTED_VERSION}, указан ${source.name || '?'} ${source.version || '?'}.`);
  }
  if (source.npm_integrity !== EXPECTED_NPM_INTEGRITY) {
    fail('npm integrity в SOURCE.json не совпадает с зафиксированной поставкой bpmn-js.');
  }
  if (JSON.stringify(source.selected_upstream_paths) !== JSON.stringify(EXPECTED_UPSTREAM_PATHS)) {
    fail('Список upstream-файлов в SOURCE.json не совпадает с минимальным профилем bpmn-js.');
  }
  return source;
}

function verifyVendoredBpmnJs(configuredRoot = defaultVendoredBpmnJsRoot) {
  const rootPath = resolve(configuredRoot);
  let rootStat;
  try {
    rootStat = lstatSync(rootPath);
  } catch (error) {
    fail(`Каталог встроенного bpmn-js отсутствует: ${rootPath}`, { cause: error.message });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail(`Каталог встроенного bpmn-js должен быть обычным каталогом: ${rootPath}`);
  }
  const root = realpathSync(rootPath);
  const manifestPath = resolve(root, MANIFEST_NAME);
  const manifestRealPath = requireRegularFile(manifestPath, root, 'Манифест встроенного bpmn-js');
  const manifestBytes = readFileSync(manifestRealPath);
  const lines = manifestBytes.toString('utf8').split(/\r?\n/u).filter(Boolean);
  if (!lines.length) fail('Манифест встроенного bpmn-js пуст.');

  const manifestFiles = [];
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/u);
    if (!match) fail(`Некорректная строка манифеста bpmn-js: ${line}`);
    const [, expectedHash, relativePath] = match;
    validateManifestPath(relativePath);
    manifestFiles.push(relativePath);
    const candidate = resolve(root, ...relativePath.split('/'));
    requireInside(root, candidate, 'Файл встроенного bpmn-js');
    const real = requireRegularFile(candidate, root, 'Файл встроенного bpmn-js');
    const actualHash = digest(readFileSync(real));
    if (actualHash !== expectedHash) {
      fail(`Нарушена целостность встроенного bpmn-js: ${relativePath}`, {
        expected_sha256: expectedHash,
        actual_sha256: actualHash
      });
    }
  }

  const sortedManifestFiles = [...manifestFiles].sort(stableCompare);
  if (new Set(manifestFiles).size !== manifestFiles.length) {
    fail('Манифест встроенного bpmn-js содержит повторяющиеся пути.');
  }
  if (JSON.stringify(manifestFiles) !== JSON.stringify(sortedManifestFiles)) {
    fail('Пути в манифесте bpmn-js должны быть отсортированы по ASCII.');
  }
  if (JSON.stringify(sortedManifestFiles) !== JSON.stringify(REQUIRED_RUNTIME_FILES)) {
    fail('Манифест bpmn-js не совпадает с минимальным runtime allowlist.', {
      missing: REQUIRED_RUNTIME_FILES.filter((path) => !sortedManifestFiles.includes(path)),
      unexpected: sortedManifestFiles.filter((path) => !REQUIRED_RUNTIME_FILES.includes(path))
    });
  }

  const actualFiles = vendoredRelativeFiles(root);
  if (JSON.stringify(actualFiles) !== JSON.stringify(sortedManifestFiles)) {
    fail('Состав встроенного bpmn-js не совпадает с VENDORED-FILES.sha256.', {
      missing: sortedManifestFiles.filter((path) => !actualFiles.includes(path)),
      unlisted: actualFiles.filter((path) => !sortedManifestFiles.includes(path))
    });
  }

  const source = readSourceMetadata(root);
  return {
    status: 'ok',
    package: source.name,
    version: source.version,
    profile: source.vendoring_profile,
    files: manifestFiles.length,
    manifest_sha256: digest(manifestBytes),
    root
  };
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    console.log(JSON.stringify(verifyVendoredBpmnJs(), null, 2));
  } catch (error) {
    console.error(`Проверка встроенного bpmn-js не пройдена: ${error.message}`);
    process.exitCode = 1;
  }
}

export {
  EXPECTED_VERSION,
  defaultVendoredBpmnJsRoot,
  verifyVendoredBpmnJs
};

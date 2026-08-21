import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const STAMP_SCHEMA = 'bpmn-studio-install/v1';
const STAMP_NAME = '.bpmn-studio-install.json';

const DEFAULT_REQUIRED_ASSETS = Object.freeze([
  'node_modules/bpmn-js/dist/bpmn-modeler.production.min.js',
  'node_modules/bpmn-js/dist/assets/diagram-js.css',
  'node_modules/bpmn-js/dist/assets/bpmn-js.css',
  'node_modules/bpmn-js/dist/assets/bpmn-font/css/bpmn.css',
  'node_modules/bpmn-js/dist/assets/bpmn-font/font/bpmn.woff2',
  'node_modules/bpmnlint/bin/bpmnlint.js'
]);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function regularFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} не найден.`);
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${label} должен быть обычным файлом.`);
  }
  return path;
}

function readJsonFile(path, label) {
  regularFile(path, label);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} повреждён: ${error.message}`);
  }
}

function containedNodeModulesPath(toolsRoot, relativePath, label) {
  const nodeModulesRoot = resolve(toolsRoot, 'node_modules');
  const target = resolve(toolsRoot, String(relativePath).replaceAll('/', sep));
  const relation = relative(nodeModulesRoot, target);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} имеет небезопасный путь в package-lock.json.`);
  }
  return { nodeModulesRoot, target };
}

function verifyRealLocation(nodeModulesRoot, path, label) {
  const realRoot = realpathSync(nodeModulesRoot);
  const realTarget = realpathSync(path);
  const relation = relative(realRoot, realTarget);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} выходит за пределы node_modules.`);
  }
}

function readManifest(toolsRoot) {
  const packagePath = resolve(toolsRoot, 'package.json');
  const lockPath = resolve(toolsRoot, 'package-lock.json');
  const packageBytes = readFileSync(regularFile(packagePath, 'package.json'));
  const lockBytes = readFileSync(regularFile(lockPath, 'package-lock.json'));
  let lock;
  try {
    lock = JSON.parse(lockBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`package-lock.json повреждён: ${error.message}`);
  }
  if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json имеет неподдерживаемый формат.');
  }
  return {
    lock,
    packageHash: sha256(packageBytes),
    lockHash: sha256(lockBytes)
  };
}

function verifyInventory(toolsRoot, lock, requiredAssets) {
  const nodeModulesRoot = resolve(toolsRoot, 'node_modules');
  if (!existsSync(nodeModulesRoot)) throw new Error('Папка node_modules ещё не создана.');
  const rootEntry = lstatSync(nodeModulesRoot);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error('Папка node_modules должна быть обычной локальной папкой.');
  }

  let packagesVerified = 0;
  for (const [ lockPath, locked ] of Object.entries(lock.packages)) {
    if (!lockPath || locked?.link) continue;
    if (!lockPath.startsWith('node_modules/')) {
      throw new Error(`Неподдерживаемый путь пакета в package-lock.json: ${lockPath}`);
    }
    const { target: packageRoot } = containedNodeModulesPath(toolsRoot, lockPath, 'Пакет');
    const packageJsonPath = resolve(packageRoot, 'package.json');
    if (!existsSync(packageJsonPath)) {
      if (locked?.optional) continue;
      throw new Error(`Не установлен обязательный пакет ${lockPath.slice('node_modules/'.length)}.`);
    }
    const packageEntry = lstatSync(packageRoot);
    if (packageEntry.isSymbolicLink() || !packageEntry.isDirectory()) {
      throw new Error(`Пакет ${lockPath.slice('node_modules/'.length)} должен быть обычной локальной папкой.`);
    }
    const installed = readJsonFile(packageJsonPath, `Описание пакета ${lockPath.slice('node_modules/'.length)}`);
    verifyRealLocation(nodeModulesRoot, packageJsonPath, `Пакет ${lockPath.slice('node_modules/'.length)}`);
    if (String(installed.version || '') !== String(locked?.version || '')) {
      throw new Error(`Версия пакета ${lockPath.slice('node_modules/'.length)} не совпадает с package-lock.json.`);
    }
    packagesVerified += 1;
  }

  for (const relativePath of requiredAssets) {
    const { target } = containedNodeModulesPath(toolsRoot, relativePath, 'Компонент редактора');
    regularFile(target, `Компонент редактора ${relativePath.slice('node_modules/'.length)}`);
    verifyRealLocation(nodeModulesRoot, target, `Компонент редактора ${relativePath.slice('node_modules/'.length)}`);
  }
  return packagesVerified;
}

function verifyStudioDependencies(toolsRoot, options = {}) {
  const root = resolve(toolsRoot);
  const requireStamp = options.requireStamp !== false;
  const requiredAssets = options.requiredAssets || DEFAULT_REQUIRED_ASSETS;
  try {
    const manifest = readManifest(root);
    const packagesVerified = verifyInventory(root, manifest.lock, requiredAssets);
    if (requireStamp) {
      const stampPath = resolve(root, 'node_modules', STAMP_NAME);
      const stamp = readJsonFile(stampPath, 'Отметка завершённой установки');
      if (stamp.schema !== STAMP_SCHEMA) throw new Error('Отметка установки имеет неподдерживаемый формат.');
      if (stamp.package_lock_sha256 !== manifest.lockHash) {
        throw new Error('package-lock.json изменился после последней завершённой установки.');
      }
      if (stamp.package_json_sha256 !== manifest.packageHash) {
        throw new Error('package.json изменился после последней завершённой установки.');
      }
      if (stamp.packages_verified !== packagesVerified) {
        throw new Error('Отметка установки не совпадает с текущим набором пакетов.');
      }
    }
    return {
      ready: true,
      reason: null,
      lockHash: manifest.lockHash,
      packageHash: manifest.packageHash,
      packagesVerified
    };
  } catch (error) {
    return {
      ready: false,
      reason: error?.message || 'Не удалось проверить локальные компоненты.',
      lockHash: null,
      packageHash: null,
      packagesVerified: 0
    };
  }
}

function writeStudioDependencyStamp(toolsRoot, options = {}) {
  const root = resolve(toolsRoot);
  const result = verifyStudioDependencies(root, { ...options, requireStamp: false });
  if (!result.ready) throw new Error(result.reason);
  const stampPath = resolve(root, 'node_modules', STAMP_NAME);
  const stamp = {
    schema: STAMP_SCHEMA,
    package_lock_sha256: result.lockHash,
    package_json_sha256: result.packageHash,
    packages_verified: result.packagesVerified,
    node_minimum: '22.12'
  };
  if (existsSync(stampPath)) {
    const entry = lstatSync(stampPath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error('Отметка завершённой установки должна быть обычным локальным файлом.');
    }
  }
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return { ...result, stampPath };
}

function printHelp() {
  process.stdout.write([
    'Проверка локальных компонентов BPMN-студии.',
    '',
    '  node verify-studio-dependencies.mjs --check',
    '  node verify-studio-dependencies.mjs --write-stamp'
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const unknown = args.filter((arg) => ![ '--check', '--write-stamp' ].includes(arg));
  if (unknown.length || args.includes('--check') && args.includes('--write-stamp')) {
    throw new Error('Укажите одно действие: --check или --write-stamp.');
  }
  if (args.includes('--write-stamp')) {
    const result = writeStudioDependencyStamp(import.meta.dirname);
    process.stdout.write(`Установка проверена: ${result.packagesVerified} пакетов.\n`);
    return;
  }
  const result = verifyStudioDependencies(import.meta.dirname);
  if (!result.ready) {
    process.stderr.write(`Локальные компоненты нужно установить заново. Причина: ${result.reason}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Локальные компоненты готовы: ${result.packagesVerified} пакетов.\n`);
}

const isCli = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`Проверка локальных компонентов не завершена: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  DEFAULT_REQUIRED_ASSETS,
  STAMP_NAME,
  verifyStudioDependencies,
  writeStudioDependencyStamp
};

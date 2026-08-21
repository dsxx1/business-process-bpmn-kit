import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const processesRoot = resolve(projectRoot, 'processes');
const registryPath = resolve(projectRoot, 'registry', 'processes.json');
const catalogPath = resolve(projectRoot, 'catalog.html');
const creatorPath = resolve(import.meta.dirname, 'create-process-package.mjs');
const registerPath = resolve(import.meta.dirname, 'register-process.mjs');
const suffix = `${process.pid}-${Date.now()}`;
const slug = `test-registration-${suffix}`;
const title = `Проверка мастера регистрации ${suffix}`;
const packageRoot = resolve(processesRoot, slug);
const rollbackSlug = `test-registration-rollback-${suffix}`;
const rollbackTitle = `Проверка отката регистрации ${suffix}`;
const rollbackPackageRoot = resolve(processesRoot, rollbackSlug);
const blockerSlug = `test-registration-blocker-${suffix}`;
const blockerRoot = resolve(processesRoot, blockerSlug);
const originalRegistryText = readFileSync(registryPath, 'utf8');
const originalCatalog = existsSync(catalogPath)
  ? { existed: true, content: readFileSync(catalogPath) }
  : { existed: false, content: null };

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(script, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [ script, ...args ], {
    cwd: import.meta.dirname,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  assert.equal(
    result.status,
    expectedStatus,
    `Неожиданный код ${result.status} для ${script} ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  return result;
}

function safeCleanup() {
  writeFileSync(registryPath, originalRegistryText, 'utf8');
  if (originalCatalog.existed) writeFileSync(catalogPath, originalCatalog.content);
  else if (existsSync(catalogPath)) rmSync(catalogPath, { force: true });
  for (const [ expectedSlug, root ] of [
    [ slug, packageRoot ],
    [ rollbackSlug, rollbackPackageRoot ],
    [ blockerSlug, blockerRoot ]
  ]) {
    const relation = relative(processesRoot, root);
    if (relation !== expectedSlug || relation.includes(sep) || !expectedSlug.startsWith('test-registration-')) {
      throw new Error(`Отказ от удаления неожиданного тестового пути: ${root}`);
    }
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

try {
  assert.ok(slug.length <= 64, 'Тестовое короткое имя должно проходить ограничение схемы.');
  assert.ok(rollbackSlug.length <= 64, 'Короткое имя проверки отката должно проходить ограничение схемы.');
  for (const root of [ packageRoot, rollbackPackageRoot, blockerRoot ]) {
    assert.ok(!existsSync(root), `Тестовая папка уже существует: ${root}`);
  }

  run(creatorPath, [ '--title', rollbackTitle, '--slug', rollbackSlug, '--no-open' ]);
  mkdirSync(resolve(blockerRoot, 'bpmn'), { recursive: true });
  writeFileSync(resolve(blockerRoot, 'bpmn', 'process.meta.json'), '{\n', 'utf8');
  const rolledBack = run(registerPath, [ '--slug', rollbackSlug ], 1);
  assert.match(rolledBack.stderr, /Финальная проверка реестра/u);
  assert.equal(readFileSync(registryPath, 'utf8'), originalRegistryText, 'При финальной ошибке реестр должен быть восстановлен байт в байт.');
  if (originalCatalog.existed) {
    assert.deepEqual(readFileSync(catalogPath), originalCatalog.content, 'При финальной ошибке каталог должен быть восстановлен байт в байт.');
  } else {
    assert.equal(existsSync(catalogPath), false, 'После отката не должен оставаться впервые созданный каталог.');
  }
  for (const file of [ 'process.svg', 'process.png', 'process-navigation.html' ]) {
    assert.equal(
      existsSync(resolve(rollbackPackageRoot, 'bpmn', 'derived', file)),
      false,
      `После отката не должен оставаться ${file}.`
    );
  }
  rmSync(blockerRoot, { recursive: true, force: true });
  rmSync(rollbackPackageRoot, { recursive: true, force: true });

  run(creatorPath, [ '--title', title, '--slug', slug, '--no-open' ]);
  const cardPath = resolve(packageRoot, 'process-card.md');
  writeFileSync(cardPath, `${readFileSync(cardPath, 'utf8')}\nПроверено интеграционным тестом мастера регистрации.\n`, 'utf8');

  const registration = run(registerPath, [ '--slug', slug ]);
  assert.match(registration.stdout, /Процесс технически подготовлен и зарегистрирован/u);
  assert.match(registration.stdout, /Статус остался «черновик»/u);

  const metaPath = resolve(packageRoot, 'bpmn', 'process.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assert.equal(meta.status, 'draft');
  assert.equal(meta.canonicality.business_status, 'pending_human_decision');
  assert.equal(meta.review.human_decision, 'not_recorded');
  assert.equal(meta.source_card.sha256, sha256(cardPath), 'Мастер должен обновить SHA-256 изменённой карточки.');

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const entry = registry.processes.find((item) => item.process_id === meta.process_id);
  assert.deepEqual(entry, {
    process_id: meta.process_id,
    title,
    status: 'draft',
    business_status: 'pending_human_decision',
    bpmn_ref: `processes/${slug}/bpmn/process.bpmn`,
    meta_ref: `processes/${slug}/bpmn/process.meta.json`,
    navigation_ref: `processes/${slug}/bpmn/derived/process-navigation.html`
  });

  const registeredCatalogText = readFileSync(catalogPath, 'utf8');
  assert.match(registeredCatalogText, new RegExp(title, 'u'), 'Новый зарегистрированный процесс должен появиться в общем каталоге.');
  assert.match(registeredCatalogText, new RegExp(`processes/${slug}/bpmn/derived/process-navigation\\.html`, 'u'));

  for (const file of [ 'process.svg', 'process.png', 'process-navigation.html' ]) {
    const path = resolve(packageRoot, 'bpmn', 'derived', file);
    assert.ok(existsSync(path) && statSync(path).size > 0, `Не создан производный файл: ${path}`);
  }

  const repeated = run(registerPath, [ '--slug', slug ], 1);
  assert.match(repeated.stderr, /уже зарегистрирован или конфликтует/u);
  assert.equal(
    readFileSync(registryPath, 'utf8'),
    `${JSON.stringify(registry, null, 2)}\n`,
    'Повторный запуск не должен менять реестр.'
  );
  assert.equal(readFileSync(catalogPath, 'utf8'), registeredCatalogText, 'Неуспешный повторный запуск не должен менять каталог.');

  const traversal = run(registerPath, [ '--slug', '..' ], 1);
  assert.match(traversal.stderr, /Короткое имя должно начинаться/u);
  assert.equal(readFileSync(registryPath, 'utf8'), `${JSON.stringify(registry, null, 2)}\n`);
  assert.equal(readFileSync(catalogPath, 'utf8'), registeredCatalogText);

  console.log(JSON.stringify({
    status: 'passed',
    scenarios: [
      'rollback-registry-navigation-and-catalog-after-final-verification-error',
      'create-edit-register-rebuild-catalog-verify-no-overwrite'
    ],
    process_id: meta.process_id
  }, null, 2));
} finally {
  safeCleanup();
}

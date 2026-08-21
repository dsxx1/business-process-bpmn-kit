import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, relative, resolve, sep } from 'node:path';

import {
  captureTransactionFile,
  cleanupFileTransaction,
  commitFileTransaction,
  rollbackFileTransaction,
  stageProcessCatalog
} from './registered-navigation-transaction.mjs';
import {
  hashRefreshChangedOnlyHashes,
  hashRefreshSafelyReopenedReview,
  parseArguments,
  rollbackRefreshedMeta,
  synchronizedRegistry,
  validateSlug
} from './update-process.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const tempRoot = mkdtempSync(resolve(tmpdir(), 'business-process-update-test-'));
const projectTempToken = `${process.pid}-${Date.now()}`;
const candidateRegistryPath = resolve(projectRoot, `.test-update-process-registry-${projectTempToken}.json`);
const catalogFinalPath = resolve(projectRoot, `.test-update-process-catalog-${projectTempToken}.html`);
const catalogTempPath = resolve(projectRoot, `.test-update-process-catalog-${projectTempToken}.new.html`);
const catalogBackupPath = resolve(projectRoot, `.test-update-process-catalog-${projectTempToken}.backup.html`);
const projectTempPaths = [ candidateRegistryPath, catalogFinalPath, catalogTempPath, catalogBackupPath ];

function safeCleanup() {
  const relation = relative(tmpdir(), tempRoot);
  if (!relation || relation.startsWith(`..${sep}`) || relation.includes(sep) || !basename(tempRoot).startsWith('business-process-update-test-')) {
    throw new Error(`Отказ от удаления неожиданной тестовой папки: ${tempRoot}`);
  }
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  for (const path of projectTempPaths) {
    if (relative(projectRoot, path) !== basename(path) || !basename(path).startsWith('.test-update-process-')) {
      throw new Error(`Отказ от удаления неожиданного тестового файла: ${path}`);
    }
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

function transaction(finalName, value, existed = true) {
  const finalPath = resolve(tempRoot, finalName);
  const tempPath = resolve(tempRoot, `.${finalName}.new`);
  const backupPath = resolve(tempRoot, `.${finalName}.backup`);
  if (existed) writeFileSync(finalPath, `old-${value}`, 'utf8');
  const snapshot = captureTransactionFile(finalPath);
  writeFileSync(tempPath, `new-${value}`, 'utf8');
  return { finalPath, tempPath, backupPath, snapshot };
}

try {
  assert.deepEqual(parseArguments([ '--slug', 'skupka-zolota' ]), { slug: 'skupka-zolota', help: false });
  assert.deepEqual(parseArguments([ '--slug=skupka-zolota' ]), { slug: 'skupka-zolota', help: false });
  assert.equal(validateSlug('skupka-zolota'), 'skupka-zolota');
  assert.throws(() => validateSlug('../outside'), /Короткое имя должно начинаться/u);
  assert.throws(() => parseArguments([ '--unknown' ]), /Неизвестный параметр/u);

  const current = {
    process_id: 'OLD-ID',
    title: 'Старое название',
    status: 'review-ready',
    business_status: 'pending_human_decision',
    bpmn_ref: 'processes/sample/bpmn/process.bpmn',
    meta_ref: 'processes/sample/bpmn/process.meta.json',
    navigation_ref: 'processes/sample/bpmn/derived/process-navigation.html'
  };
  const untouched = { ...current, process_id: 'ANOTHER', meta_ref: 'processes/another/bpmn/process.meta.json' };
  const replacement = { ...current, process_id: 'NEW-ID', title: 'Новое название', status: 'approved', business_status: 'canonical' };
  const sourceRegistry = { schema: 'business-process-bpmn-registry/v1', processes: [ current, untouched ] };
  const synchronized = synchronizedRegistry(sourceRegistry, current, replacement);
  assert.deepEqual(synchronized.processes.map((entry) => entry.process_id), [ 'ANOTHER', 'NEW-ID' ]);
  assert.equal(synchronized.processes[1].status, 'approved');
  assert.equal(synchronized.processes[1].business_status, 'canonical');
  assert.equal(sourceRegistry.processes[0].process_id, 'OLD-ID', 'Исходный реестр нельзя менять на месте.');

  const files = [
    transaction('process.svg', 'svg'),
    transaction('process.png', 'png'),
    transaction('process-navigation.html', 'navigation', false)
  ];
  commitFileTransaction(files);
  assert.equal(readFileSync(files[0].finalPath, 'utf8'), 'new-svg');
  assert.equal(readFileSync(files[1].finalPath, 'utf8'), 'new-png');
  assert.equal(readFileSync(files[2].finalPath, 'utf8'), 'new-navigation');
  assert.ok(existsSync(files[0].backupPath));
  assert.deepEqual(rollbackFileTransaction(files), []);
  assert.equal(readFileSync(files[0].finalPath, 'utf8'), 'old-svg');
  assert.equal(readFileSync(files[1].finalPath, 'utf8'), 'old-png');
  assert.equal(existsSync(files[2].finalPath), false);
  cleanupFileTransaction(files, true);

  const concurrent = transaction('concurrent.html', 'original');
  writeFileSync(concurrent.finalPath, 'changed-by-another-process', 'utf8');
  assert.throws(() => commitFileTransaction([ concurrent ]), /изменился во время подготовки/u);
  assert.equal(readFileSync(concurrent.finalPath, 'utf8'), 'changed-by-another-process');
  cleanupFileTransaction([ concurrent ], true);

  writeFileSync(candidateRegistryPath, `${JSON.stringify({
    schema: 'business-process-bpmn-registry/v1',
    processes: [ {
      process_id: 'CATALOG-TEMP-REGISTRY',
      title: 'Процесс из временной версии реестра',
      status: 'approved',
      business_status: 'canonical',
      bpmn_ref: 'processes/skupka-zolota/bpmn/process.bpmn',
      meta_ref: 'processes/skupka-zolota/bpmn/process.meta.json',
      navigation_ref: 'processes/skupka-zolota/bpmn/derived/process-navigation.html'
    } ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(catalogFinalPath, 'old-catalog-bytes', 'utf8');
  const catalogFile = stageProcessCatalog({
    registryPathForBuild: candidateRegistryPath,
    finalPath: catalogFinalPath,
    transactionOverride: { tempPath: catalogTempPath, backupPath: catalogBackupPath }
  });
  assert.equal(readFileSync(catalogFinalPath, 'utf8'), 'old-catalog-bytes', 'Подготовка каталога не должна менять опубликованный файл.');
  assert.match(readFileSync(catalogTempPath, 'utf8'), /Процесс из временной версии реестра/u);
  assert.match(readFileSync(catalogTempPath, 'utf8'), /Решение владельца зафиксировано/u);
  commitFileTransaction([ catalogFile ]);
  assert.match(readFileSync(catalogFinalPath, 'utf8'), /Процесс из временной версии реестра/u);
  assert.equal(readFileSync(catalogBackupPath, 'utf8'), 'old-catalog-bytes');
  assert.deepEqual(rollbackFileTransaction([ catalogFile ]), []);
  assert.equal(readFileSync(catalogFinalPath, 'utf8'), 'old-catalog-bytes', 'Откат должен восстановить каталог байт в байт.');
  cleanupFileTransaction([ catalogFile ], true);

  const metaPath = resolve(tempRoot, 'process.meta.json');
  const originalMetaText = '{"title":"Решение владельца","source_card":{"sha256":"old-card"},"evidence":[{"evidence_id":"questions","sha256":"old-questions"}]}\n';
  const refreshedMetaText = `${JSON.stringify({
    title: 'Решение владельца',
    source_card: { sha256: 'new-card' },
    evidence: [ { evidence_id: 'questions', sha256: 'new-questions' } ]
  }, null, 2)}\n`;
  assert.equal(hashRefreshChangedOnlyHashes(originalMetaText, refreshedMetaText), true);
  assert.equal(
    hashRefreshChangedOnlyHashes(originalMetaText, refreshedMetaText.replace('Решение владельца', 'Другое решение')),
    false,
    'Откат допустим только для обновления контрольных сумм.'
  );
  const approvedMetaText = `${JSON.stringify({
    status: 'approved',
    canonicality: { business_status: 'canonical' },
    review: { human_decision: 'approved' },
    source_card: { sha256: 'old-card' },
    evidence: [ { evidence_id: 'questions', sha256: 'old-questions' } ]
  }, null, 2)}\n`;
  const reopenedMetaText = `${JSON.stringify({
    status: 'review-ready',
    canonicality: { business_status: 'pending_human_decision' },
    review: { human_decision: 'not_recorded' },
    source_card: { sha256: 'new-card' },
    evidence: [ { evidence_id: 'questions', sha256: 'new-questions' } ]
  }, null, 2)}\n`;
  assert.equal(hashRefreshSafelyReopenedReview(approvedMetaText, reopenedMetaText), true);
  assert.equal(
    hashRefreshSafelyReopenedReview(approvedMetaText, reopenedMetaText.replace('pending_human_decision', 'rejected')),
    false,
    'Откат не должен принимать произвольную смену бизнес-статуса.'
  );
  writeFileSync(metaPath, refreshedMetaText, 'utf8');
  assert.equal(rollbackRefreshedMeta(metaPath, originalMetaText, refreshedMetaText), true);
  assert.equal(readFileSync(metaPath, 'utf8'), originalMetaText, 'process.meta.json должен быть восстановлен байт в байт.');
  writeFileSync(metaPath, refreshedMetaText.replace('Решение владельца', 'Параллельное изменение'), 'utf8');
  assert.throws(
    () => rollbackRefreshedMeta(metaPath, originalMetaText, refreshedMetaText),
    /изменён кем-то ещё/u
  );

  console.log(JSON.stringify({
    status: 'passed',
    scenarios: [
      'argument-and-path-guardrails',
      'registry-metadata-synchronization',
      'derived-files-backup-and-rollback',
      'concurrent-derived-change-rejected',
      'catalog-built-from-temporary-registry-and-rolled-back',
      'refreshed-meta-byte-exact-rollback-with-concurrency-guard',
      'owner-decision-reopen-is-a-bounded-safe-transition'
    ]
  }, null, 2));
} finally {
  safeCleanup();
}

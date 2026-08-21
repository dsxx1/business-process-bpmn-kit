import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { refreshDraftPackageHashes } from './refresh-draft-package-hashes.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createMeta(root, slug, processId, status) {
  const bpmnRoot = resolve(root, 'processes', slug, 'bpmn');
  mkdirSync(bpmnRoot, { recursive: true });
  const metaPath = resolve(bpmnRoot, 'process.meta.json');
  writeJson(metaPath, { process_id: processId, status });
  return { bpmnRoot, metaPath };
}

const testRoot = mkdtempSync(join(tmpdir(), 'bpmn-draft-hashes-'));
try {
  mkdirSync(resolve(testRoot, 'registry'), { recursive: true });
  const registered = createMeta(testRoot, 'registered', 'REGISTERED-PROCESS', 'review-ready');
  const draft = createMeta(testRoot, 'new-draft', 'NEW-DRAFT', 'draft');
  writeJson(resolve(testRoot, 'registry', 'processes.json'), {
    schema: 'business-process-bpmn-registry/v1',
    processes: [ { meta_ref: 'processes/registered/bpmn/process.meta.json' } ]
  });

  const called = [];
  const result = refreshDraftPackageHashes({
    projectRoot: testRoot,
    refreshPackage: ({ bpmnRoot, meta }) => called.push({ bpmnRoot, processId: meta.process_id })
  });

  assert.deepEqual(called, [ { bpmnRoot: draft.bpmnRoot, processId: 'NEW-DRAFT' } ]);
  assert.equal(result.refreshed_draft_processes, 1);
  assert.equal(result.processes[0].meta_ref, 'processes/new-draft/bpmn/process.meta.json');
  assert.notEqual(called[0].bpmnRoot, registered.bpmnRoot);

  const invalid = createMeta(testRoot, 'unregistered-ready', 'UNREGISTERED-READY', 'review-ready');
  assert.throws(
    () => refreshDraftPackageHashes({ projectRoot: testRoot, refreshPackage: () => undefined }),
    /Незарегистрированный пакет UNREGISTERED-READY/u
  );
  assert.ok(invalid.metaPath.endsWith('process.meta.json'));

  console.log('Проверка обновления контрольных сумм незарегистрированных черновиков пройдена.');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

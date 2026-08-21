import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const sourceRoot = resolve(projectRoot, 'processes', 'skupka-zolota');
const projectTempRoot = resolve(projectRoot, 'temp');
const tempRoot = resolve(projectTempRoot, 'handoff-contract-test');
const copiedRoot = resolve(tempRoot, 'copied-process');
const copiedBpmnRoot = resolve(copiedRoot, 'bpmn');
const copiedMetaPath = resolve(copiedBpmnRoot, 'process.meta.json');
const validatorPath = resolve(import.meta.dirname, 'validate-package.mjs');
const hashesPath = resolve(import.meta.dirname, 'refresh-package-hashes.mjs');

function run(script, args) {
  return spawnSync(process.execPath, [ script, ...args ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
}

if (tempRoot !== resolve(projectTempRoot, 'handoff-contract-test') || !tempRoot.startsWith(`${projectTempRoot}${sep}`)) {
  throw new Error('Небезопасный путь временной проверки передачи процесса');
}

rmSync(tempRoot, { recursive: true, force: true });
try {
  cpSync(sourceRoot, copiedRoot, { recursive: true });
  const meta = JSON.parse(readFileSync(copiedMetaPath, 'utf8'));
  meta.source_card.ref = '../process-card.md';
  meta.evidence[0].ref = '../evidence.md';
  const handoff = meta.process_links.find((link) => link.link_id === 'LINK-GOLD-BUYING-04');
  handoff.source_element_id = 'EndEvent_NotComplete';
  writeFileSync(copiedMetaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  const refreshResult = run(hashesPath, [ copiedBpmnRoot ]);
  assert.equal(refreshResult.status, 0, refreshResult.stderr || refreshResult.stdout);
  const result = run(validatorPath, [ copiedBpmnRoot ]);
  assert.notEqual(result.status, 0, 'Обычное конечное событие не должно проходить как межпроцессная передача');
  assert.match(`${result.stderr}\n${result.stdout}`, /must use a message End Event with messageRef/u);

  console.log(JSON.stringify({
    status: 'passed',
    ordinary_end_event_rejected_for_handoff: true
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

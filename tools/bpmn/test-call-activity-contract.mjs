import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const sourceRoot = resolve(projectRoot, 'processes', 'skupka-zolota');
const projectTempRoot = resolve(projectRoot, 'temp');
const tempRoot = resolve(projectTempRoot, 'call-activity-contract-test');
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

function writeMeta(meta) {
  writeFileSync(copiedMetaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function expectValidationFailure(baseMeta, mutate, expectedMessage) {
  const candidate = structuredClone(baseMeta);
  mutate(candidate);
  writeMeta(candidate);
  const result = run(validatorPath, [ copiedBpmnRoot ]);
  assert.notEqual(result.status, 0, `Validation unexpectedly passed for: ${expectedMessage}`);
  assert.match(`${result.stderr}\n${result.stdout}`, expectedMessage);
}

if (
  tempRoot !== resolve(projectTempRoot, 'call-activity-contract-test')
  || !tempRoot.startsWith(`${projectTempRoot}${sep}`)
  || copiedRoot !== resolve(tempRoot, 'copied-process')
  || !copiedRoot.startsWith(`${tempRoot}${sep}`)
) {
  throw new Error('Небезопасный путь временной копии процесса');
}

try {
  rmSync(copiedRoot, { recursive: true, force: true });
  cpSync(sourceRoot, copiedRoot, { recursive: true });

  const copiedMeta = JSON.parse(readFileSync(copiedMetaPath, 'utf8'));
  copiedMeta.source_card.ref = '../process-card.md';
  copiedMeta.evidence[0].ref = '../evidence.md';
  writeMeta(copiedMeta);

  const refreshResult = run(hashesPath, [ copiedBpmnRoot ]);
  assert.equal(refreshResult.status, 0, refreshResult.stderr || refreshResult.stdout);
  const validMeta = JSON.parse(readFileSync(copiedMetaPath, 'utf8'));

  const baselineResult = run(validatorPath, [ copiedBpmnRoot ]);
  assert.equal(baselineResult.status, 0, baselineResult.stderr || baselineResult.stdout);

  expectValidationFailure(
    validMeta,
    (meta) => { meta.process_links = meta.process_links.filter((link) => link.source_element_id !== 'CallActivity_HighEvaluation'); },
    /Call activity CallActivity_HighEvaluation has no process link/u
  );
  expectValidationFailure(
    validMeta,
    (meta) => {
      const link = meta.process_links.find((item) => item.source_element_id === 'CallActivity_HighEvaluation');
      link.target_status = 'unresolved';
      link.target_process_id = null;
      link.target_ref = null;
    },
    /Call activity CallActivity_HighEvaluation process link has no target_process_id/u
  );
  expectValidationFailure(
    validMeta,
    (meta) => {
      const link = meta.process_links.find((item) => item.source_element_id === 'CallActivity_HighEvaluation');
      link.target_process_id = 'WRONG-PROCESS';
    },
    /calls HIGH-EVALUATION-APPROVAL, but process link targets WRONG-PROCESS/u
  );

  console.log(JSON.stringify({
    status: 'passed',
    baseline_package_valid: true,
    rejected_call_activity_contracts: [ 'missing_link', 'missing_target_process_id', 'mismatched_target_process_id' ]
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

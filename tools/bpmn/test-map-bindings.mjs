import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const sourcePath = resolve(projectRoot, 'processes', 'skupka-zolota', 'map', 'process-map.bindings.json');
const tempRoot = resolve(projectRoot, 'temp', 'map-bindings-test');
const tempPath = resolve(tempRoot, 'bindings.json');
const validatorPath = resolve(import.meta.dirname, 'validate-map-bindings.mjs');

function run(path) {
  return spawnSync(process.execPath, [ validatorPath, path ], { cwd: import.meta.dirname, encoding: 'utf8' });
}

function expectFailure(base, mutate, pattern) {
  const candidate = structuredClone(base);
  mutate(candidate);
  writeFileSync(tempPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  const result = run(tempPath);
  assert.notEqual(result.status, 0, `Проверка неожиданно пропустила ошибку ${pattern}`);
  assert.match(`${result.stderr}\n${result.stdout}`, pattern);
}

if (tempRoot !== resolve(projectRoot, 'temp', 'map-bindings-test') || !tempRoot.startsWith(`${resolve(projectRoot, 'temp')}${sep}`)) {
  throw new Error('Небезопасный путь временной проверки привязок карты.');
}

rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });
try {
  const base = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const baseline = run(sourcePath);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

  expectFailure(base, (value) => { value.bindings[0].map_node_id = 'missing-node'; }, /отсутствующий узел карты/u);
  expectFailure(base, (value) => { value.bindings[0].bpmn_element_ids[0] = 'Task_Missing'; }, /отсутствующий BPMN-элемент/u);
  expectFailure(base, (value) => { value.bindings.find((item) => item.map_node_id === 'approval').bpmn_element_ids = [ 'Gateway_HighApproved' ]; }, /начинается в CallActivity_HighEvaluation/u);
  expectFailure(base, (value) => { value.bindings.find((item) => item.map_node_id === 'warehouse').process_link_ids = [ 'LINK-GOLD-BUYING-06' ]; }, /не показаны на карте: LINK-GOLD-BUYING-07/u);
  expectFailure(base, (value) => { value.bindings.push(structuredClone(value.bindings[0])); }, /Привязки узлов карты содержит повтор/u);

  console.log(JSON.stringify({
    status: 'passed',
    baseline_valid: true,
    rejected_contracts: [ 'missing_map_node', 'missing_bpmn_element', 'wrong_link_source', 'missing_process_link', 'duplicate_binding' ]
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

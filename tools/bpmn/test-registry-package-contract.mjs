import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertRegistryEntryMatchesPackage,
  assertUnregisteredPackageIsDraft
} from './registry-package-contract.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const registry = JSON.parse(readFileSync(resolve(projectRoot, 'registry', 'processes.json'), 'utf8'));
const entry = registry.processes[0];
const metaPath = resolve(projectRoot, entry.meta_ref);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

function verify(candidate) {
  return assertRegistryEntryMatchesPackage({ projectRoot, entry: candidate, metaPath, meta });
}

assert.doesNotThrow(() => verify(entry));
assert.throws(() => verify({ ...entry, process_id: 'WRONG-PROCESS' }), /process_id mismatch/u);
assert.throws(() => verify({ ...entry, title: 'Чужое название процесса' }), /title mismatch/u);
assert.throws(() => verify({ ...entry, status: 'draft' }), /status mismatch/u);
assert.throws(() => verify({ ...entry, business_status: 'canonical' }), /business_status mismatch/u);
assert.throws(
  () => verify({ ...entry, bpmn_ref: 'templates/process-package/bpmn/process.bpmn' }),
  /bpmn_ref mismatch/u
);
assert.throws(
  () => verify({ ...entry, navigation_ref: 'templates/process-package/bpmn/derived/process-navigation.html' }),
  /navigation_ref mismatch/u
);
assert.doesNotThrow(() => assertUnregisteredPackageIsDraft({
  metaPath: 'processes/new-process/bpmn/process.meta.json',
  meta: { process_id: 'NEW-PROCESS', status: 'draft' }
}));
assert.throws(
  () => assertUnregisteredPackageIsDraft({
    metaPath: 'processes/new-process/bpmn/process.meta.json',
    meta: { process_id: 'NEW-PROCESS', status: 'review-ready' }
  }),
  /перед переводом из черновика добавьте его в registry\/processes\.json/u
);

console.log(JSON.stringify({
  status: 'passed',
  valid_registry_entry: true,
  unregistered_draft_allowed: true,
  unregistered_non_draft_rejected: true,
  rejected_mismatches: [ 'process_id', 'title', 'status', 'business_status', 'bpmn_ref', 'navigation_ref' ]
}, null, 2));

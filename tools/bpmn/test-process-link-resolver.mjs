import assert from 'node:assert/strict';
import { buildRegistryIndex, resolveProcessTarget } from './process-link-resolver.mjs';

const registry = buildRegistryIndex({
  processes: [
    {
      process_id: 'REGISTERED-PROCESS',
      navigation_ref: 'processes/registered-process/bpmn/derived/process-navigation.html'
    }
  ]
});

const registered = resolveProcessTarget({
  target_process_id: 'REGISTERED-PROCESS',
  target_ref: 'processes/legacy-process/README.md'
}, registry);
assert.equal(registered.target_resolution, 'registered_bpmn');
assert.equal(registered.navigation_target_ref, 'processes/registered-process/bpmn/derived/process-navigation.html');

const fallback = resolveProcessTarget({
  target_process_id: 'CANDIDATE-PROCESS',
  target_ref: 'processes/candidate-process/README.md'
}, registry);
assert.equal(fallback.target_resolution, 'fallback_card');
assert.equal(fallback.navigation_target_ref, 'processes/candidate-process/README.md');

const unresolved = resolveProcessTarget({ target_process_id: null, target_ref: null }, registry);
assert.equal(unresolved.target_resolution, 'unresolved');
assert.equal(unresolved.navigation_target_ref, null);

console.log(JSON.stringify({
  status: 'passed',
  registered_target_prefers_bpmn: true,
  candidate_falls_back_to_card: true,
  unresolved_stays_explicit: true
}, null, 2));

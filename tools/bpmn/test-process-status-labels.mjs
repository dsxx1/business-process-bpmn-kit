import assert from 'node:assert/strict';

import { humanProcessStatus } from './process-status-labels.mjs';

assert.equal(
  humanProcessStatus({ status: 'draft', canonicality: { business_status: 'pending_human_decision' } }),
  'Черновик · Ожидает решения владельца'
);
assert.equal(
  humanProcessStatus({ status: 'approved', canonicality: { business_status: 'canonical' } }),
  'Решение об утверждении зафиксировано · Отмечен как канонический'
);
assert.equal(
  humanProcessStatus({ status: 'rejected', canonicality: { business_status: 'rejected' } }),
  'Решение об отклонении зафиксировано · Отмечен как отклонённый'
);

console.log(JSON.stringify({
  status: 'passed',
  approved_canonical_label: true,
  rejected_label: true,
  hardcoded_pending_status_removed: true
}, null, 2));

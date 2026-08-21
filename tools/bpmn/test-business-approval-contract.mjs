import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const templateRoot = resolve(projectRoot, 'templates', 'process-package');
const tempRoot = resolve(projectRoot, 'temp', 'business-approval-contract-test');
const bpmnRoot = resolve(tempRoot, 'bpmn');
const validatorPath = resolve(import.meta.dirname, 'validate-package.mjs');
const refreshPath = resolve(import.meta.dirname, 'refresh-package-hashes.mjs');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validate(expectedStatus) {
  const result = spawnSync(process.execPath, [ validatorPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  assert.equal(result.status, expectedStatus, `Неожиданный результат валидатора.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

if (tempRoot !== resolve(projectRoot, 'temp', 'business-approval-contract-test') || !tempRoot.startsWith(`${resolve(projectRoot, 'temp')}${sep}`)) {
  throw new Error('Небезопасный путь временной проверки бизнес-утверждения.');
}

rmSync(tempRoot, { recursive: true, force: true });
try {
  cpSync(templateRoot, tempRoot, { recursive: true });
  const metaPath = resolve(bpmnRoot, 'process.meta.json');
  const questionsPath = resolve(bpmnRoot, 'questions.json');
  const decisionsPath = resolve(bpmnRoot, 'decisions.json');
  const bpmnPath = resolve(bpmnRoot, 'process.bpmn');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const questions = JSON.parse(readFileSync(questionsPath, 'utf8'));
  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));

  meta.status = 'approved';
  meta.canonicality.business_status = 'canonical';
  meta.review.owner_role = 'Владелец процесса';
  meta.review.human_decision = 'approved';
  decisions.decisions.push({
    decision_id: 'DECISION-PROCESS-TEMPLATE-001',
    question_id: questions.questions[0].question_id,
    outcome: 'approve',
    actor: 'Владелец процесса',
    comment: 'Текущая версия процесса утверждена владельцем.',
    decided_at: '2026-08-20T00:00:00Z',
    bpmn_sha256: sha256(bpmnPath),
    source_card_sha256: meta.source_card.sha256,
    evidence_sha256: meta.evidence.map((evidence) => evidence.sha256)
  });
  writeJson(metaPath, meta);
  writeJson(decisionsPath, decisions);

  const blocked = validate(1);
  assert.match(blocked.stderr, /open blocking questions/u);

  questions.questions.forEach((question) => {
    if (question.blocking) question.status = 'answered';
  });
  writeJson(questionsPath, questions);
  const answerWithoutAuditFields = validate(1);
  assert.match(answerWithoutAuditFields.stderr, /must have required property/u);

  questions.questions.forEach((question) => {
    if (!question.blocking) return;
    question.answer = 'Ответ владельца процесса';
    question.answered_by = 'Владелец процесса';
    question.answered_at = '2026-08-20T00:00:00Z';
  });
  writeJson(questionsPath, questions);
  validate(0);

  writeFileSync(bpmnPath, `${readFileSync(bpmnPath, 'utf8')}\n`, 'utf8');
  const staleDecision = validate(1);
  assert.match(staleDecision.stderr, /approved human decision/u);

  const updatedBpmnHash = sha256(bpmnPath);
  const updatedMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const updatedDecisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  updatedDecisions.decisions[0].bpmn_sha256 = updatedBpmnHash;
  writeJson(decisionsPath, updatedDecisions);
  validate(0);

  const sourceCardPath = resolve(tempRoot, 'process-card.md');
  writeFileSync(sourceCardPath, `${readFileSync(sourceCardPath, 'utf8')}\n`, 'utf8');
  updatedMeta.source_card.sha256 = sha256(sourceCardPath);
  writeJson(metaPath, updatedMeta);
  const staleSourceCardDecision = validate(1);
  assert.match(staleSourceCardDecision.stderr, /approved human decision/u);
  const reopenApproved = spawnSync(process.execPath, [ refreshPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  assert.equal(reopenApproved.status, 0, reopenApproved.stderr);
  const reopenedApprovedMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assert.equal(reopenedApprovedMeta.status, 'review-ready');
  assert.equal(reopenedApprovedMeta.canonicality.business_status, 'pending_human_decision');
  assert.equal(reopenedApprovedMeta.review.human_decision, 'not_recorded');
  validate(0);

  updatedMeta.status = 'rejected';
  updatedMeta.canonicality.business_status = 'rejected';
  updatedMeta.review.human_decision = 'rejected';
  updatedMeta.review.owner_role = 'Владелец процесса';
  updatedDecisions.decisions.push({
    decision_id: 'DECISION-PROCESS-TEMPLATE-REJECT-001',
    question_id: null,
    outcome: 'reject',
    actor: 'Владелец процесса',
    comment: 'Текущая версия процесса отклонена владельцем.',
    decided_at: '2026-08-20T01:00:00Z',
    bpmn_sha256: updatedBpmnHash,
    source_card_sha256: updatedMeta.source_card.sha256,
    evidence_sha256: updatedMeta.evidence.map((evidence) => evidence.sha256)
  });
  writeJson(metaPath, updatedMeta);
  writeJson(decisionsPath, updatedDecisions);
  validate(0);

  updatedMeta.status = 'review-ready';
  writeJson(metaPath, updatedMeta);
  const mismatchedRejectedStatus = validate(1);
  assert.match(mismatchedRejectedStatus.stderr, /process status rejected/u);

  updatedMeta.status = 'rework';
  updatedMeta.canonicality.business_status = 'pending_human_decision';
  updatedMeta.review.human_decision = 'rework';
  updatedDecisions.decisions.push({
    decision_id: 'DECISION-PROCESS-TEMPLATE-REWORK-001',
    question_id: null,
    outcome: 'rework',
    actor: 'Владелец процесса',
    comment: 'Текущую версию нужно уточнить и повторно согласовать.',
    decided_at: '2026-08-20T02:00:00Z',
    bpmn_sha256: updatedBpmnHash,
    source_card_sha256: updatedMeta.source_card.sha256,
    evidence_sha256: updatedMeta.evidence.map((evidence) => evidence.sha256)
  });
  writeJson(metaPath, updatedMeta);
  writeJson(decisionsPath, updatedDecisions);
  validate(0);

  updatedDecisions.decisions.at(-1).bpmn_sha256 = '0'.repeat(64);
  writeJson(decisionsPath, updatedDecisions);
  const staleReworkDecision = validate(1);
  assert.match(staleReworkDecision.stderr, /current process materials/u);
  const reopenRework = spawnSync(process.execPath, [ refreshPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  assert.equal(reopenRework.status, 0, reopenRework.stderr);
  const reopenedReworkMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  assert.equal(reopenedReworkMeta.status, 'review-ready');
  assert.equal(reopenedReworkMeta.canonicality.business_status, 'pending_human_decision');
  assert.equal(reopenedReworkMeta.review.human_decision, 'not_recorded');
  validate(0);

  console.log(JSON.stringify({
    status: 'passed',
    open_blocking_questions_rejected: true,
    answered_questions_require_audit_fields: true,
    current_bpmn_approval_required: true,
    current_source_card_approval_required: true,
    rejected_status_contract_verified: true,
    current_rework_decision_required: true,
    changed_materials_reopen_owner_review: true,
    process_level_decision_supported: true
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

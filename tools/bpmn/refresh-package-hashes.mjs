import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const toolRoot = resolve(import.meta.dirname, '..', '..');
const packageRoot = resolve(process.argv[2] || '../../processes/skupka-zolota/bpmn');
const metaPath = resolve(packageRoot, 'process.meta.json');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const recordedOutcome = new Map([
  [ 'approved', 'approve' ],
  [ 'rework', 'rework' ],
  [ 'rejected', 'reject' ]
]);

function referencePath(ref) {
  const base = ref.startsWith('./') || ref.startsWith('../') ? packageRoot : toolRoot;
  const path = resolve(base, ref);
  if (path !== toolRoot && !path.startsWith(`${toolRoot}${sep}`)) throw new Error(`Reference leaves project root: ${ref}`);
  const processPackageRoot = resolve(packageRoot, '..');
  if (path !== processPackageRoot && !path.startsWith(`${processPackageRoot}${sep}`)) {
    throw new Error(`Package evidence reference leaves its process package: ${ref}`);
  }
  return path;
}

function bpmnPackagePath(ref) {
  const path = resolve(packageRoot, ref);
  if (path !== packageRoot && !path.startsWith(`${packageRoot}${sep}`)) {
    throw new Error(`BPMN package reference leaves its bpmn folder: ${ref}`);
  }
  return path;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const currentBpmnSha256 = sha256(bpmnPackagePath(meta.bpmn.file));
const currentSourceCardSha256 = sha256(referencePath(meta.source_card.ref));
const currentEvidenceSha256 = meta.evidence.map((evidence) => sha256(referencePath(evidence.ref)));
const expectedOutcome = recordedOutcome.get(meta.review?.human_decision);
let ownerDecisionReopened = false;

if (expectedOutcome) {
  const decisions = JSON.parse(readFileSync(bpmnPackagePath(meta.review.decisions_file), 'utf8'));
  const recordedDecision = [ ...(decisions.decisions || []) ].reverse().find((decision) =>
    decision.outcome === expectedOutcome && decision.actor === meta.review.owner_role
  );
  const decisionIsWellFormed = recordedDecision
    && typeof recordedDecision.bpmn_sha256 === 'string'
    && typeof recordedDecision.source_card_sha256 === 'string'
    && Array.isArray(recordedDecision.evidence_sha256);
  const materialsChanged = decisionIsWellFormed && (
    recordedDecision.bpmn_sha256 !== currentBpmnSha256
    || recordedDecision.source_card_sha256 !== currentSourceCardSha256
    || recordedDecision.evidence_sha256.length !== currentEvidenceSha256.length
    || recordedDecision.evidence_sha256.some((hash, index) => hash !== currentEvidenceSha256[index])
  );

  if (materialsChanged) {
    meta.status = 'review-ready';
    meta.canonicality.business_status = 'pending_human_decision';
    meta.review.human_decision = 'not_recorded';
    ownerDecisionReopened = true;
  }
}

meta.source_card.sha256 = currentSourceCardSha256;
meta.evidence.forEach((evidence, index) => {
  evidence.sha256 = currentEvidenceSha256[index];
});
writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  status: 'updated',
  process_id: meta.process_id,
  owner_decision_reopened: ownerDecisionReopened,
  source_card_sha256: meta.source_card.sha256,
  evidence: meta.evidence.map((item) => ({ evidence_id: item.evidence_id, sha256: item.sha256 }))
}, null, 2));

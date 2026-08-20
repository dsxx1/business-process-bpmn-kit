import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const toolRoot = resolve(import.meta.dirname, '..', '..');
const packageRoot = resolve(process.argv[2] || '../../processes/skupka-zolota/bpmn');
const metaPath = resolve(packageRoot, 'process.meta.json');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

meta.source_card.sha256 = sha256(referencePath(meta.source_card.ref));
for (const evidence of meta.evidence) evidence.sha256 = sha256(referencePath(evidence.ref));
writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  status: 'updated',
  process_id: meta.process_id,
  source_card_sha256: meta.source_card.sha256,
  evidence: meta.evidence.map((item) => ({ evidence_id: item.evidence_id, sha256: item.sha256 }))
}, null, 2));

import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { verifyArchifyFreshness } from './verify-archify-freshness.mjs';
import { buildArchifyMap } from './archify-adapter.mjs';

const sourceRoot = resolve(import.meta.dirname, '..', '..');
const slug = 'skupka-zolota';
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bpmn-verify-archify-freshness-'));

function copyFixture(root) {
  const sourceProcessRoot = resolve(sourceRoot, 'processes', slug);
  const processRoot = resolve(root, 'processes', slug);
  const bpmnRoot = resolve(processRoot, 'bpmn');
  const mapRoot = resolve(processRoot, 'map');
  mkdirSync(bpmnRoot, { recursive: true });
  mkdirSync(mapRoot, { recursive: true });
  for (const name of [ 'process.bpmn', 'process.meta.json' ]) {
    copyFileSync(resolve(sourceProcessRoot, 'bpmn', name), resolve(bpmnRoot, name));
  }
  for (const name of [
    'process-map.workflow.json',
    'process-map.bindings.json',
    'process-map.html',
    'process-map.build-receipt.json',
  ]) {
    copyFileSync(resolve(sourceProcessRoot, 'map', name), resolve(mapRoot, name));
  }
  return { processRoot, mapRoot };
}

try {
  const validRoot = resolve(fixtureRoot, 'valid');
  copyFixture(validRoot);
  const passed = await verifyArchifyFreshness({ slug, projectRoot: validRoot });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.deterministic_rebuild, true);

  const automaticRoot = resolve(fixtureRoot, 'automatic-draft');
  const automaticSlug = 'automatic-draft';
  const automaticBpmnRoot = resolve(automaticRoot, 'processes', automaticSlug, 'bpmn');
  mkdirSync(automaticBpmnRoot, { recursive: true });
  for (const name of [ 'process.bpmn', 'process.meta.json' ]) {
    copyFileSync(resolve(sourceRoot, 'templates', 'process-package', 'bpmn', name), resolve(automaticBpmnRoot, name));
  }
  const automaticBuild = await buildArchifyMap({ slug: automaticSlug, projectRoot: automaticRoot });
  assert.equal(automaticBuild.receipt.source.automatic_draft, true);
  const automaticPassed = await verifyArchifyFreshness({ slug: automaticSlug, projectRoot: automaticRoot });
  assert.equal(automaticPassed.status, 'passed');

  const staleRoot = resolve(fixtureRoot, 'stale-artifact');
  const stale = copyFixture(staleRoot);
  const staleArtifact = resolve(stale.mapRoot, 'process-map.html');
  writeFileSync(staleArtifact, `${readFileSync(staleArtifact, 'utf8')}\n<!-- stale -->\n`, 'utf8');
  await assert.rejects(
    verifyArchifyFreshness({ slug, projectRoot: staleRoot }),
    /HTML-карта Archify: SHA-256 не совпадает/iu,
  );

  const toolHashRoot = resolve(fixtureRoot, 'stale-tool-hash');
  const toolHash = copyFixture(toolHashRoot);
  const toolHashReceiptPath = resolve(toolHash.mapRoot, 'process-map.build-receipt.json');
  const toolHashReceipt = JSON.parse(readFileSync(toolHashReceiptPath, 'utf8'));
  toolHashReceipt.presentation.localizer_sha256 = '0'.repeat(64);
  writeFileSync(toolHashReceiptPath, `${JSON.stringify(toolHashReceipt, null, 2)}\n`, 'utf8');
  await assert.rejects(
    verifyArchifyFreshness({ slug, projectRoot: toolHashRoot }),
    /Локализатор карты: SHA-256 не совпадает/iu,
  );

  const linkedRoot = resolve(fixtureRoot, 'linked-map');
  const linked = copyFixture(linkedRoot);
  const backingMap = resolve(linked.processRoot, 'map-real');
  renameSync(linked.mapRoot, backingMap);
  symlinkSync(backingMap, linked.mapRoot, 'junction');
  await assert.rejects(
    verifyArchifyFreshness({ slug, projectRoot: linkedRoot }),
    /символическую ссылку или точку соединения/iu,
  );

  console.log(JSON.stringify({
    status: 'passed',
    scenarios: [
      'актуальная gold Archify-карта',
      'детерминированный автоматический черновик Archify',
      'устаревший HTML-артефакт',
      'устаревший hash инструмента',
      'запрет symlink или junction в пути квитанции',
    ],
  }, null, 2));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

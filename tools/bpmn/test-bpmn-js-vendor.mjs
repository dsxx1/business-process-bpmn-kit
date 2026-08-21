import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { startStudioServer } from './studio-server.mjs';
import {
  EXPECTED_VERSION,
  defaultVendoredBpmnJsRoot,
  verifyVendoredBpmnJs
} from './verify-bpmn-js-vendor.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectInvalid(action, pattern) {
  assert.throws(action, (error) => (
    error?.code === 'BPMN_JS_VENDOR_INVALID' && pattern.test(error.message)
  ));
}

const liveResult = verifyVendoredBpmnJs();
assert.equal(liveResult.version, EXPECTED_VERSION);
assert.equal(liveResult.files, 12);
assert.equal(resolve(liveResult.root), resolve(defaultVendoredBpmnJsRoot));

const tempRoot = mkdtempSync(join(tmpdir(), 'bpmn-js-vendor-test-'));
try {
  const tamperedRoot = join(tempRoot, 'tampered');
  cpSync(defaultVendoredBpmnJsRoot, tamperedRoot, { recursive: true });
  appendFileSync(join(tamperedRoot, 'bpmn-modeler.production.min.js'), '\n// tampered\n', 'utf8');
  expectInvalid(() => verifyVendoredBpmnJs(tamperedRoot), /Нарушена целостность/u);

  const unlistedRoot = join(tempRoot, 'unlisted');
  cpSync(defaultVendoredBpmnJsRoot, unlistedRoot, { recursive: true });
  writeFileSync(join(unlistedRoot, 'unexpected.txt'), 'unexpected\n', 'utf8');
  expectInvalid(() => verifyVendoredBpmnJs(unlistedRoot), /Состав встроенного bpmn-js/u);

  const linkedRoot = join(tempRoot, 'linked');
  cpSync(defaultVendoredBpmnJsRoot, linkedRoot, { recursive: true });
  let symbolicLinkChecked = false;
  try {
    symlinkSync(join(linkedRoot, 'assets'), join(linkedRoot, 'linked-assets'), 'junction');
    expectInvalid(() => verifyVendoredBpmnJs(linkedRoot), /символическую ссылку/u);
    symbolicLinkChecked = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error;
  }

  const studio = await startStudioServer({ core: {}, token: 'v'.repeat(32), port: 0 });
  try {
    const response = await fetch(`${studio.origin}/vendor/bpmn-modeler.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^text\/javascript/u);
    const servedBytes = Buffer.from(await response.arrayBuffer());
    const vendoredBytes = readFileSync(join(defaultVendoredBpmnJsRoot, 'bpmn-modeler.production.min.js'));
    assert.equal(sha256(servedBytes), sha256(vendoredBytes));

    const cssResponse = await fetch(`${studio.origin}/vendor/bpmn-font/css/bpmn.css`);
    assert.equal(cssResponse.status, 200);
    assert.match(await cssResponse.text(), /font-family:\s*['"]bpmn['"]/u);
  } finally {
    await studio.close();
  }

  console.log(JSON.stringify({
    status: 'passed',
    package: liveResult.package,
    version: liveResult.version,
    files: liveResult.files,
    manifest_sha256: liveResult.manifest_sha256,
    tamper_rejected: true,
    unlisted_file_rejected: true,
    symbolic_link_checked: symbolicLinkChecked,
    studio_serves_repo_vendor: true
  }, null, 2));
} finally {
  const resolvedTempRoot = resolve(tempRoot);
  if (!basename(resolvedTempRoot).startsWith('bpmn-js-vendor-test-')) {
    throw new Error(`Отказ очищать неожиданный временный путь: ${resolvedTempRoot}`);
  }
  rmSync(resolvedTempRoot, { recursive: true, force: true });
}

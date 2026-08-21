import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, resolve, sep } from 'node:path';

import {
  StudioError,
  atomicWriteUtf8,
  createStudioCore,
  findGeneratedBpmnIds,
  inspectBpmnXml,
  sha256,
  validateTitle
} from './studio-core.mjs';
import { startStudioServer } from './studio-server.mjs';

const sourceProjectRoot = resolve(import.meta.dirname, '..', '..');
const tempParent = resolve(sourceProjectRoot, 'temp');
mkdirSync(tempParent, { recursive: true });
const testRoot = mkdtempSync(resolve(tempParent, 'studio-core-test-'));
if (!testRoot.startsWith(`${tempParent}${sep}`)) throw new Error('Небезопасный временный путь теста BPMN-студии.');

function bpmnXml({ title = 'Проверить заявление', taskId = 'Task_CheckRequest', executable = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Demo" targetNamespace="https://example.invalid/bpmn">
  <bpmn:process id="Process_Demo" name="Демонстрационный процесс" isExecutable="${executable}">
    <bpmn:startEvent id="Event_RequestReceived" name="Заявление получено">
      <bpmn:outgoing>Flow_ToCheck</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="${taskId}" name="${title}">
      <bpmn:incoming>Flow_ToCheck</bpmn:incoming>
      <bpmn:outgoing>Flow_ToFinish</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="Event_RequestHandled" name="Заявление обработано">
      <bpmn:incoming>Flow_ToFinish</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_ToCheck" sourceRef="Event_RequestReceived" targetRef="${taskId}" />
    <bpmn:sequenceFlow id="Flow_ToFinish" sourceRef="${taskId}" targetRef="Event_RequestHandled" />
  </bpmn:process>
  <bpmn:collaboration id="Collaboration_Demo">
    <bpmn:participant id="Participant_Demo" name="Участник демонстрационного процесса" processRef="Process_Demo" />
  </bpmn:collaboration>
</bpmn:definitions>
`;
}

function processMeta({ slug = 'demo-process', title = 'Демонстрационный процесс' } = {}) {
  return {
    schema: 'business-process-bpmn-package/v1',
    process_id: slug.toUpperCase().replaceAll('-', '_'),
    title,
    variant: 'as-is',
    version: '0.1.0',
    status: 'draft',
    canonicality: {
      syntax_status: 'pending',
      profile_status: 'pending',
      business_status: 'pending_human_decision'
    },
    bpmn: {
      file: 'process.bpmn',
      definitions_id: 'Definitions_Demo',
      process_element_id: 'Process_Demo',
      collaboration_id: 'Collaboration_Demo',
      standard: 'BPMN 2.0.2',
      is_executable: false
    },
    process_links: [],
    review: { owner_role: null, human_decision: 'not_recorded' }
  };
}

function writePackage(root, slug, xml = bpmnXml(), title = 'Демонстрационный процесс') {
  const packageRoot = resolve(root, 'processes', slug);
  mkdirSync(resolve(packageRoot, 'bpmn'), { recursive: true });
  writeFileSync(resolve(packageRoot, 'bpmn', 'process.bpmn'), xml, 'utf8');
  writeFileSync(
    resolve(packageRoot, 'bpmn', 'process.meta.json'),
    `${JSON.stringify(processMeta({ slug, title }), null, 2)}\n`,
    'utf8'
  );
  return packageRoot;
}

function archifyReceipt(root, slug) {
  const bpmnPath = resolve(root, 'processes', slug, 'bpmn', 'process.bpmn');
  const metadataPath = resolve(root, 'processes', slug, 'bpmn', 'process.meta.json');
  return {
    schema: 'archify-map-build-receipt/v1',
    source: {
      bpmn: { sha256: sha256(readFileSync(bpmnPath, 'utf8')) },
      metadata: { sha256: sha256(readFileSync(metadataPath, 'utf8')) }
    }
  };
}

function initializeTestProject() {
  mkdirSync(resolve(testRoot, 'processes'), { recursive: true });
  mkdirSync(resolve(testRoot, 'registry'), { recursive: true });
  mkdirSync(resolve(testRoot, 'tools', 'bpmn', 'node_modules', 'bpmnlint', 'bin'), { recursive: true });
  mkdirSync(resolve(testRoot, 'docs'), { recursive: true });
  writeFileSync(resolve(testRoot, 'registry', 'processes.json'), JSON.stringify({
    schema: 'business-process-bpmn-registry/v1',
    processes: []
  }), 'utf8');
  for (const name of [
    'create-process-package.mjs',
    'validate-package.mjs',
    'register-process.mjs',
    'update-process.mjs'
  ]) {
    writeFileSync(resolve(testRoot, 'tools', 'bpmn', name), '// test double\n', 'utf8');
  }
  writeFileSync(resolve(testRoot, 'tools', 'bpmn', 'node_modules', 'bpmnlint', 'bin', 'bpmnlint.js'), '// test double\n', 'utf8');
  writeFileSync(resolve(testRoot, 'docs', '.bpmnlintrc'), '{}\n', 'utf8');
  writePackage(testRoot, 'demo-process');
}

const commands = [];
async function fakeCommandRunner(invocation) {
  commands.push(invocation);
  const script = basename(invocation.args[0] || '');
  if (script === 'create-process-package.mjs') {
    const title = invocation.args[invocation.args.indexOf('--title') + 1];
    const slug = invocation.args[invocation.args.indexOf('--slug') + 1];
    writePackage(testRoot, slug, bpmnXml({ title: 'Уточнить входные данные' }), title);
    return { exitCode: 0, stdout: 'Пакет создан', stderr: '', timedOut: false };
  }
  return { exitCode: 0, stdout: 'Проверка пройдена', stderr: '', timedOut: false };
}

initializeTestProject();
let server;

try {
  const core = createStudioCore({ projectRoot: testRoot, commandRunner: fakeCommandRunner });

  for (const title of [ 'Gold buying', 'ОП-03', '7' ]) assert.equal(validateTitle(title), title);
  assert.throws(() => validateTitle(''), (error) => error instanceof StudioError && error.code === 'INVALID_TITLE');
  assert.throws(() => validateTitle('Две\nстроки'), (error) => error instanceof StudioError && error.code === 'INVALID_TITLE');

  const generatedIssues = findGeneratedBpmnIds(bpmnXml({ taskId: 'Activity_1abc' }));
  assert.equal(generatedIssues.length, 1);
  assert.equal(generatedIssues[0].id, 'Activity_1abc');
  assert.equal(generatedIssues[0].auto_fix_applied, false);
  assert.match(generatedIssues[0].suggested_id, /^Task_ProveritZayavlenie/u);

  await assert.rejects(
    inspectBpmnXml(bpmnXml({ executable: true })),
    (error) => error instanceof StudioError && error.code === 'EXECUTABLE_CANONICAL_MODEL'
  );
  await assert.rejects(
    inspectBpmnXml('<not-bpmn>'),
    (error) => error instanceof StudioError && /BPMN/u.test(error.code)
  );

  const listed = core.listProcesses();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].slug, 'demo-process');
  assert.equal(listed.items[0].status.registered, false);
  assert.equal(listed.items[0].xml, undefined);
  assert.deepEqual(listed.items[0].supporting, {
    process_card: { available: false, markdown: null, sha256: null },
    questions: {
      available: false,
      sha256: null,
      items: [],
      counts: { open: 0, blocking_open: 0 }
    }
  });

  const mapRoot = resolve(testRoot, 'processes', 'demo-process', 'map');
  const archifyReceiptPath = resolve(mapRoot, 'process-map.build-receipt.json');
  mkdirSync(mapRoot, { recursive: true });
  writeFileSync(resolve(mapRoot, 'process-map.html'), '<!doctype html><html lang="ru"><title>Карта</title></html>', 'utf8');
  const missingReceiptView = core.readProcess('demo-process').views.archify;
  assert.equal(missingReceiptView.available, true);
  assert.equal(missingReceiptView.fresh, false);
  assert.match(missingReceiptView.reason, /квитанц/iu);
  writeFileSync(archifyReceiptPath, '{broken', 'utf8');
  const brokenReceiptView = core.readProcess('demo-process').views.archify;
  assert.equal(brokenReceiptView.fresh, false);
  assert.match(brokenReceiptView.reason, /поврежден/iu);
  writeFileSync(archifyReceiptPath, `${JSON.stringify(archifyReceipt(testRoot, 'demo-process'), null, 2)}\n`, 'utf8');

  const opened = core.readProcess('demo-process');
  assert.match(opened.xml, /Проверить заявление/u);
  assert.equal(opened.sha256, sha256(opened.xml));
  assert.equal(opened.views.archify.fresh, true);
  assert.equal(opened.views.archify.reason, null);

  const demoProcessRoot = resolve(testRoot, 'processes', 'demo-process');
  const processCardPath = resolve(demoProcessRoot, 'process-card.md');
  const questionsPath = resolve(demoProcessRoot, 'bpmn', 'questions.json');
  const processCardMarkdown = '# Демонстрационный процесс\n\nПонятное описание процесса для владельца.\n';
  const questionsDocument = {
    schema: 'business-process-bpmn-questions/v1',
    process_id: 'DEMO-PROCESS',
    model_version: '0.1.0',
    questions: [
      {
        question_id: 'Q-DEMO-PROCESS-001',
        title: 'Кто утверждает результат?',
        status: 'open',
        blocking: true,
        owner_role: null,
        source_element_ids: [ 'Process_Demo' ]
      },
      {
        question_id: 'Q-DEMO-PROCESS-002',
        title: 'Каков срок?',
        status: 'open',
        blocking: false,
        owner_role: null,
        source_element_ids: [ 'Task_CheckRequest' ]
      },
      {
        question_id: 'Q-DEMO-PROCESS-003',
        title: 'Источник подтверждён?',
        status: 'answered',
        blocking: true,
        owner_role: 'Владелец процесса',
        source_element_ids: [ 'Task_CheckRequest' ],
        answer: 'Да, источник подтверждён.',
        answered_by: 'Владелец процесса',
        answered_at: '2026-08-21T10:00:00+05:00'
      }
    ]
  };
  const questionsText = `${JSON.stringify(questionsDocument, null, 2)}\n`;
  writeFileSync(processCardPath, processCardMarkdown, 'utf8');
  writeFileSync(questionsPath, questionsText, 'utf8');

  const supported = core.readProcess('demo-process');
  assert.deepEqual(supported.supporting.process_card, {
    available: true,
    markdown: processCardMarkdown,
    sha256: sha256(processCardMarkdown)
  });
  assert.equal(supported.supporting.questions.available, true);
  assert.equal(supported.supporting.questions.sha256, sha256(questionsText));
  assert.deepEqual(supported.supporting.questions.items, questionsDocument.questions);
  assert.deepEqual(supported.supporting.questions.counts, { open: 2, blocking_open: 1 });

  writeFileSync(questionsPath, '{broken', 'utf8');
  assert.throws(
    () => core.readProcess('demo-process'),
    (error) => error instanceof StudioError
      && error.code === 'INVALID_QUESTIONS_JSON'
      && error.status === 422
  );
  writeFileSync(questionsPath, questionsText, 'utf8');

  rmSync(questionsPath);
  mkdirSync(questionsPath);
  assert.throws(
    () => core.readProcess('demo-process'),
    (error) => error instanceof StudioError
      && error.code === 'UNSAFE_PATH'
      && error.status === 400
  );
  rmSync(questionsPath, { recursive: true });
  writeFileSync(questionsPath, questionsText, 'utf8');

  writeFileSync(processCardPath, 'x'.repeat((512 * 1024) + 1), 'utf8');
  assert.throws(
    () => core.readProcess('demo-process'),
    (error) => error instanceof StudioError
      && error.code === 'SUPPORTING_FILE_TOO_LARGE'
      && error.status === 422
  );
  writeFileSync(processCardPath, processCardMarkdown, 'utf8');

  for (const mismatchedXml of [
    opened.xml.replace('Definitions_Demo', 'Definitions_Other'),
    opened.xml.replaceAll('Process_Demo', 'Process_Other'),
    opened.xml.replace('Collaboration_Demo', 'Collaboration_Other')
  ]) {
    await assert.rejects(
      core.saveBpmn('demo-process', { xml: mismatchedXml, expectedSha256: opened.sha256 }),
      (error) => error instanceof StudioError
        && error.code === 'BPMN_PROCESS_MISMATCH'
        && error.status === 422
        && error.details?.expected?.process_element_id === 'Process_Demo'
    );
    assert.equal(core.readProcess('demo-process').sha256, opened.sha256);
    assert.equal(core.readProcess('demo-process').meta_sha256, opened.meta_sha256);
  }

  const generatedXml = bpmnXml({ title: 'Сверить документы', taskId: 'Activity_1abc' });
  const saved = await core.saveBpmn('demo-process', {
    xml: generatedXml,
    expectedSha256: opened.sha256
  });
  assert.equal(saved.process.xml, generatedXml);
  assert.equal(saved.process.views.archify.fresh, false);
  assert.match(saved.process.views.archify.reason, /BPMN изменён/iu);
  assert.equal(saved.inspection.generated_id_issues.length, 1);
  assert.match(saved.notice, /BPMN-ID/u);
  assert.equal(
    readdirSync(resolve(testRoot, 'processes', 'demo-process', 'bpmn')).some((name) => name.endsWith('.tmp')),
    false,
    'После атомарной записи остался временный файл'
  );

  await assert.rejects(
    core.saveBpmn('demo-process', { xml: bpmnXml(), expectedSha256: opened.sha256 }),
    (error) => error instanceof StudioError && error.code === 'BPMN_CONFLICT' && error.status === 409
  );
  const beforeInvalidSave = core.readProcess('demo-process');
  await assert.rejects(
    core.saveBpmn('demo-process', { xml: '<broken>', expectedSha256: beforeInvalidSave.sha256 }),
    (error) => error instanceof StudioError && error.status === 422
  );
  assert.equal(core.readProcess('demo-process').sha256, beforeInvalidSave.sha256);

  const approvedRoot = writePackage(testRoot, 'approved-save');
  const approvedMetaPath = resolve(approvedRoot, 'bpmn', 'process.meta.json');
  const approvedMeta = JSON.parse(readFileSync(approvedMetaPath, 'utf8'));
  approvedMeta.status = 'approved';
  approvedMeta.canonicality.business_status = 'canonical';
  approvedMeta.review.human_decision = 'approved';
  writeFileSync(approvedMetaPath, `${JSON.stringify(approvedMeta, null, 2)}\n`, 'utf8');
  const approvedOpened = core.readProcess('approved-save');
  const approvedSaved = await core.saveBpmn('approved-save', {
    xml: bpmnXml({ title: 'Проверить изменённое заявление' }),
    expectedSha256: approvedOpened.sha256
  });
  assert.equal(approvedSaved.owner_decision_reopened, true);
  assert.equal(approvedSaved.process.meta.status, 'review-ready');
  assert.equal(approvedSaved.process.meta.canonicality.business_status, 'pending_human_decision');
  assert.equal(approvedSaved.process.meta.review.human_decision, 'not_recorded');
  assert.match(approvedSaved.notice, /утвердить заново/iu);

  const rollbackRoot = writePackage(testRoot, 'approved-save-rollback');
  const rollbackBpmnPath = resolve(rollbackRoot, 'bpmn', 'process.bpmn');
  const rollbackMetaPath = resolve(rollbackRoot, 'bpmn', 'process.meta.json');
  const rollbackMeta = JSON.parse(readFileSync(rollbackMetaPath, 'utf8'));
  rollbackMeta.status = 'approved';
  rollbackMeta.canonicality.business_status = 'canonical';
  rollbackMeta.review.human_decision = 'approved';
  writeFileSync(rollbackMetaPath, `${JSON.stringify(rollbackMeta, null, 2)}\n`, 'utf8');
  const rollbackBpmnBefore = readFileSync(rollbackBpmnPath, 'utf8');
  const rollbackMetaBefore = readFileSync(rollbackMetaPath, 'utf8');
  let failApprovedMetaOnce = true;
  const rollbackCore = createStudioCore({
    projectRoot: testRoot,
    commandRunner: fakeCommandRunner,
    transitionWriter(path, text) {
      if (failApprovedMetaOnce && path === rollbackMetaPath) {
        failApprovedMetaOnce = false;
        throw new Error('test approved metadata write failure');
      }
      atomicWriteUtf8(path, text);
    }
  });
  await assert.rejects(
    rollbackCore.saveBpmn('approved-save-rollback', {
      xml: bpmnXml({ title: 'Проверить откат утверждённой схемы' }),
      expectedSha256: sha256(rollbackBpmnBefore)
    }),
    /test approved metadata write failure/u
  );
  assert.equal(readFileSync(rollbackBpmnPath, 'utf8'), rollbackBpmnBefore);
  assert.equal(readFileSync(rollbackMetaPath, 'utf8'), rollbackMetaBefore);

  const created = await core.createProcess({ title: 'Рассмотреть новое обращение', slug: 'new-request' });
  assert.equal(created.process.title, 'Рассмотреть новое обращение');
  const createInvocation = commands.find((item) => basename(item.args[0] || '') === 'create-process-package.mjs');
  assert.deepEqual(createInvocation.args.slice(1), [
    '--title', 'Рассмотреть новое обращение', '--slug', 'new-request', '--no-open'
  ]);
  await assert.rejects(
    core.createProcess({ title: 'Дубликат', slug: 'new-request' }),
    (error) => error.code === 'PROCESS_EXISTS'
  );
  const autoSlug = await core.createProcess({ title: 'Проверить автоматическое имя' });
  assert.equal(autoSlug.process.slug, 'proverit-avtomaticheskoe-imya');

  const check = await core.performAction('demo-process', 'check');
  assert.equal(check.passed, true);
  assert.deepEqual(check.checks.map((item) => item.id), [ 'package', 'bpmn-lint' ]);
  const registered = await core.performAction('demo-process', 'register');
  assert.equal(registered.passed, true);
  const updated = await core.performAction('demo-process', 'update');
  assert.equal(updated.passed, true);
  await assert.rejects(
    core.performAction('demo-process', 'delete'),
    (error) => error.code === 'UNKNOWN_ACTION'
  );

  mkdirSync(resolve(testRoot, 'processes', 'demo-process', 'map'), { recursive: true });
  writeFileSync(
    resolve(testRoot, 'processes', 'demo-process', 'map', 'process-map.html'),
    '<!doctype html><html lang="ru"><title>Карта</title></html>',
    'utf8'
  );
  const archify = await core.performAction('demo-process', 'open-archify');
  assert.equal(archify.passed, true);
  assert.equal(archify.built, false);
  assert.equal(archify.view.available, true);

  const uiRoot = resolve(testRoot, 'studio-ui');
  mkdirSync(uiRoot, { recursive: true });
  writeFileSync(resolve(uiRoot, 'index.html'), '<!doctype html><html lang="ru"><title>Студия</title></html>', 'utf8');
  const token = '0123456789abcdef0123456789abcdef';
  server = await startStudioServer({ core, token, uiRoot, port: 0 });

  let response = await fetch(`${server.origin}/api/bootstrap`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');

  response = await fetch(`${server.origin}/api/bootstrap`, {
    headers: { 'X-Studio-Token': token, Origin: 'https://attacker.invalid' }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'INVALID_ORIGIN');

  const authorizedHeaders = { 'X-Studio-Token': token, Origin: server.origin };
  response = await fetch(`${server.origin}/api/bootstrap`, { headers: authorizedHeaders });
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.local_only, true);
  assert.equal(bootstrap.ai_required, false);
  assert.equal(bootstrap.processes.length, 5);

  response = await fetch(`${server.origin}/api/process/demo-process`, { headers: authorizedHeaders });
  assert.equal(response.status, 200);
  const apiProcess = (await response.json()).process;
  assert.equal(apiProcess.slug, 'demo-process');
  assert.match(apiProcess.views.archify.url, /token=/u);
  assert.equal(apiProcess.supporting.process_card.markdown, processCardMarkdown);
  assert.deepEqual(apiProcess.supporting.questions.counts, { open: 2, blocking_open: 1 });

  writeFileSync(questionsPath, '{broken', 'utf8');
  response = await fetch(`${server.origin}/api/process/demo-process`, { headers: authorizedHeaders });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'INVALID_QUESTIONS_JSON');
  writeFileSync(questionsPath, questionsText, 'utf8');

  response = await fetch(`${server.origin}/api/process/demo-process/bpmn`, {
    method: 'PUT',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ xml: bpmnXml(), expectedSha256: '0'.repeat(64) })
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'BPMN_CONFLICT');

  response = await fetch(`${server.origin}/api/process/demo-process/action`, {
    method: 'POST',
    headers: { ...authorizedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.passed, true);

  response = await fetch(`${server.origin}/api/process/demo-process/actions/check`, {
    method: 'POST',
    headers: authorizedHeaders
  });
  assert.equal(response.status, 200);

  response = await fetch(`${server.origin}/view/demo-process/archify?token=${token}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Карта/u);

  response = await fetch(`${server.origin}/vendor/bpmn-modeler.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/u);

  response = await fetch(`${server.origin}/api/process/%2e%2e%5csecret`, { headers: authorizedHeaders });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_SLUG');

  await server.close();
  server = undefined;

  console.log(JSON.stringify({
    status: 'passed',
    core: {
      safe_paths: true,
      bpmn_parse_before_write: true,
      optimistic_concurrency: true,
      atomic_write_cleanup: true,
      archify_freshness_receipt_contract: true,
      generated_ids_reported_without_unsafe_rewrite: true,
      create_cli_invocation: true,
      actions: [ 'check', 'register', 'update', 'open-archify' ]
    },
    server: {
      loopback_only: server === undefined,
      token_required: true,
      origin_checked: true,
      vendor_aliases: true,
      action_endpoint_aliases: true
    }
  }, null, 2));
} finally {
  if (server) await server.close();
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
}

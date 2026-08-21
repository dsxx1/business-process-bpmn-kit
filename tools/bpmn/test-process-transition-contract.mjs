import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  StudioError,
  atomicWriteUtf8,
  createStudioCore,
  sha256
} from './studio-core.mjs';
import { startStudioServer } from './studio-server.mjs';

function callXml({ processId = 'Process_Source', callId = 'CallActivity_CheckDocuments', calledElement = null } = {}) {
  const called = calledElement ? ` calledElement="${calledElement}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_${processId}" targetNamespace="https://example.invalid/bpmn">
  <bpmn:process id="${processId}" name="Исходный процесс" isExecutable="false">
    <bpmn:startEvent id="Event_RequestReceived" name="Запрос получен">
      <bpmn:outgoing>Flow_ToCall</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:callActivity id="${callId}" name="Выполнить связанную проверку"${called}>
      <bpmn:incoming>Flow_ToCall</bpmn:incoming>
      <bpmn:outgoing>Flow_ToEnd</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:endEvent id="Event_RequestHandled" name="Запрос обработан">
      <bpmn:incoming>Flow_ToEnd</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_ToCall" sourceRef="Event_RequestReceived" targetRef="${callId}" />
    <bpmn:sequenceFlow id="Flow_ToEnd" sourceRef="${callId}" targetRef="Event_RequestHandled" />
  </bpmn:process>
  <bpmn:collaboration id="Collaboration_${processId}">
    <bpmn:participant id="Participant_${processId}" name="Участник исходного процесса" processRef="${processId}" />
  </bpmn:collaboration>
</bpmn:definitions>
`;
}

function callActivityToTask(xml) {
  return String(xml)
    .replace(/\s+calledElement="[^"]*"/gu, '')
    .replace(/<bpmn:callActivity\b/gu, '<bpmn:task')
    .replace(/<\/bpmn:callActivity>/gu, '</bpmn:task>');
}

function withAdditionalCallActivity(xml) {
  return String(xml).replace(
    '  </bpmn:process>',
    '    <bpmn:callActivity id="CallActivity_OtherCheck" name="Выполнить другую проверку" />\n  </bpmn:process>'
  );
}

function simpleXml(processId, title) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_${processId}" targetNamespace="https://example.invalid/bpmn">
  <bpmn:process id="${processId}" name="${title}" isExecutable="false">
    <bpmn:startEvent id="Event_Start" name="Работа начата" />
    <bpmn:endEvent id="Event_End" name="Работа завершена" />
  </bpmn:process>
  <bpmn:collaboration id="Collaboration_${processId}">
    <bpmn:participant id="Participant_${processId}" name="Участник процесса" processRef="${processId}" />
  </bpmn:collaboration>
</bpmn:definitions>
`;
}

function meta({ processId, processElementId, title }) {
  return {
    schema: 'business-process-bpmn-package/v1',
    process_id: processId,
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
      definitions_id: `Definitions_${processElementId}`,
      process_element_id: processElementId,
      collaboration_id: `Collaboration_${processElementId}`,
      standard: 'BPMN 2.0.2',
      is_executable: false
    },
    process_links: [],
    review: { owner_role: null, human_decision: 'not_recorded' }
  };
}

function writePackage(root, { slug, processId, processElementId, title, xml }) {
  const processRoot = join(root, 'processes', slug);
  const bpmnRoot = join(processRoot, 'bpmn');
  mkdirSync(bpmnRoot, { recursive: true });
  writeFileSync(join(bpmnRoot, 'process.bpmn'), xml, 'utf8');
  writeFileSync(join(bpmnRoot, 'process.meta.json'), `${JSON.stringify(meta({ processId, processElementId, title }), null, 2)}\n`, 'utf8');
  writeFileSync(join(processRoot, 'process-card.md'), `# ${title}\n`, 'utf8');
  return { processRoot, bpmnRoot };
}

function registryEntry({ slug, processId, title }) {
  return {
    process_id: processId,
    title,
    status: 'draft',
    business_status: 'pending_human_decision',
    bpmn_ref: `processes/${slug}/bpmn/process.bpmn`,
    meta_ref: `processes/${slug}/bpmn/process.meta.json`,
    navigation_ref: `processes/${slug}/bpmn/derived/process-navigation.html`
  };
}

function writeRegistry(root, entries) {
  mkdirSync(join(root, 'registry'), { recursive: true });
  writeFileSync(join(root, 'registry', 'processes.json'), `${JSON.stringify({
    schema: 'business-process-bpmn-registry/v1',
    processes: entries
  }, null, 2)}\n`, 'utf8');
}

function markPackageApproved(bpmnRoot) {
  const metaPath = join(bpmnRoot, 'process.meta.json');
  const value = JSON.parse(readFileSync(metaPath, 'utf8'));
  value.status = 'approved';
  value.canonicality.business_status = 'canonical';
  value.review.human_decision = 'approved';
  writeFileSync(metaPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const testRoot = mkdtempSync(join(tmpdir(), 'bpmn-transition-contract-'));
let server;

try {
  const source = writePackage(testRoot, {
    slug: 'source-process',
    processId: 'SOURCE-PROCESS',
    processElementId: 'Process_Source',
    title: 'Обработка исходного запроса',
    xml: callXml()
  });
  writePackage(testRoot, {
    slug: 'registered-target',
    processId: 'REGISTERED-TARGET',
    processElementId: 'Process_RegisteredTarget',
    title: 'Проверка зарегистрированной цели',
    xml: simpleXml('Process_RegisteredTarget', 'Проверка зарегистрированной цели')
  });
  writeRegistry(testRoot, [ registryEntry({
    slug: 'registered-target',
    processId: 'REGISTERED-TARGET',
    title: 'Проверка зарегистрированной цели'
  }) ]);

  const core = createStudioCore({ projectRoot: testRoot });
  const opened = core.readProcess('source-process');
  assert.match(opened.meta_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(opened.transitions.length, 0);
  const targets = core.listTransitionTargets('source-process');
  assert.deepEqual(targets.supported_relations, [ 'call' ]);
  assert.deepEqual(targets.supported_target_kinds, [ 'registered', 'reserved', 'unknown' ]);
  assert.equal(targets.targets.registered[0].slug, 'registered-target');

  await assert.rejects(
    core.saveTransition('source-process', {
      xml: opened.xml.replace('Collaboration_Process_Source', 'Collaboration_Other'),
      expectedBpmnSha256: opened.sha256,
      expectedMetaSha256: opened.meta_sha256,
      sourceElementId: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Перейти к неизвестной проверке и вернуться',
      target: { kind: 'unknown' }
    }),
    (error) => error instanceof StudioError && error.code === 'BPMN_PROCESS_MISMATCH' && error.status === 422
  );
  assert.equal(core.readProcess('source-process').sha256, opened.sha256);
  assert.equal(core.readProcess('source-process').meta_sha256, opened.meta_sha256);

  const registered = await core.saveTransition('source-process', {
    xml: opened.xml,
    expectedBpmnSha256: opened.sha256,
    expectedMetaSha256: opened.meta_sha256,
    sourceElementId: 'CallActivity_CheckDocuments',
    relation: 'call',
    label: 'Перейти к зарегистрированной проверке и вернуться',
    target: { kind: 'registered', slug: 'registered-target' }
  });
  assert.equal(registered.transition.target_status, 'candidate', 'Studio не должен автоматически утверждать связь');
  assert.equal(registered.transition.target_resolution, 'registered_bpmn');
  assert.equal(registered.transition.open.kind, 'process');
  assert.equal(registered.transition.open.slug, 'registered-target');
  assert.match(registered.process.xml, /calledElement="REGISTERED-TARGET"/u);
  const linkId = registered.transition.link_id;

  await assert.rejects(
    core.saveTransition('source-process', {
      linkId,
      xml: withAdditionalCallActivity(registered.process.xml),
      expectedBpmnSha256: registered.process.sha256,
      expectedMetaSha256: registered.process.meta_sha256,
      sourceElementId: 'CallActivity_OtherCheck',
      relation: 'call',
      label: 'Перенести вызов к другой проверке',
      target: { kind: 'registered', slug: 'registered-target' }
    }),
    (error) => error instanceof StudioError && error.code === 'TRANSITION_SOURCE_CHANGE_FORBIDDEN' && error.status === 409
  );
  assert.equal(core.readProcess('source-process').sha256, registered.process.sha256);
  assert.equal(core.readProcess('source-process').meta_sha256, registered.process.meta_sha256);

  const metadataPath = join(source.bpmnRoot, 'process.meta.json');
  const beforeExternalMeta = registered.process.meta_sha256;
  const externallyChanged = JSON.parse(readFileSync(metadataPath, 'utf8'));
  externallyChanged.status = 'rework';
  writeFileSync(metadataPath, `${JSON.stringify(externallyChanged, null, 2)}\n`, 'utf8');
  await assert.rejects(
    core.saveTransition('source-process', {
      linkId,
      xml: registered.process.xml,
      expectedBpmnSha256: registered.process.sha256,
      expectedMetaSha256: beforeExternalMeta,
      sourceElementId: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Перейти к зарегистрированной проверке и вернуться',
      target: { kind: 'registered', slug: 'registered-target' }
    }),
    (error) => error instanceof StudioError && error.code === 'META_CONFLICT' && error.status === 409
  );

  const afterExternal = core.readProcess('source-process');
  const reserved = await core.saveTransition('source-process', {
    linkId,
    xml: afterExternal.xml,
    expectedBpmnSha256: afterExternal.sha256,
    expectedMetaSha256: afterExternal.meta_sha256,
    sourceElementId: 'CallActivity_CheckDocuments',
    relation: 'call',
    label: 'Вызвать будущую ручную проверку и вернуться',
    target: {
      kind: 'reserved',
      title: 'Ручная проверка особого случая',
      slug: 'manual-special-check'
    }
  });
  const reservedCard = join(testRoot, 'processes', 'source-process', 'related-processes', 'manual-special-check.md');
  assert.equal(existsSync(reservedCard), true);
  assert.match(readFileSync(reservedCard, 'utf8'), /MANUAL-SPECIAL-CHECK/u);
  assert.equal(reserved.transition.target_resolution, 'fallback_card');
  assert.equal(reserved.transition.open.kind, 'card');
  assert.match(reserved.transition.open.card_markdown, /будущий бизнес-процесс/iu);

  writePackage(testRoot, {
    slug: 'manual-special-check',
    processId: 'MANUAL-SPECIAL-CHECK',
    processElementId: 'Process_ManualSpecialCheck',
    title: 'Ручная проверка особого случая',
    xml: simpleXml('Process_ManualSpecialCheck', 'Ручная проверка особого случая')
  });
  writeRegistry(testRoot, [
    registryEntry({ slug: 'registered-target', processId: 'REGISTERED-TARGET', title: 'Проверка зарегистрированной цели' }),
    registryEntry({ slug: 'manual-special-check', processId: 'MANUAL-SPECIAL-CHECK', title: 'Ручная проверка особого случая' })
  ]);
  const autoResolved = core.readProcess('source-process');
  assert.equal(autoResolved.transitions[0].target_resolution, 'registered_bpmn');
  assert.equal(autoResolved.transitions[0].target_slug, 'manual-special-check');

  const unknown = await core.saveTransition('source-process', {
    linkId,
    xml: autoResolved.xml,
    expectedBpmnSha256: autoResolved.sha256,
    expectedMetaSha256: autoResolved.meta_sha256,
    sourceElementId: 'CallActivity_CheckDocuments',
    relation: 'call',
    label: 'Перейти к пока не определённому процессу',
    target: { kind: 'unknown' }
  });
  assert.equal(unknown.transition.target_status, 'unresolved');
  assert.equal(unknown.transition.target_process_id, null);
  assert.equal(unknown.transition.target_resolution, 'unresolved');
  assert.doesNotMatch(unknown.process.xml, /calledElement=/u);
  assert.equal(existsSync(reservedCard), true, 'Изменение связи не должно удалять карточку с заметками');

  await assert.rejects(
    core.deleteTransition('source-process', {
      linkId,
      xml: unknown.process.xml,
      expectedBpmnSha256: unknown.process.sha256,
      expectedMetaSha256: unknown.process.meta_sha256
    }),
    (error) => error instanceof StudioError && error.code === 'CALL_ACTIVITY_STILL_PRESENT' && error.status === 422
  );
  assert.equal(core.readProcess('source-process').sha256, unknown.process.sha256);
  assert.equal(core.readProcess('source-process').meta_sha256, unknown.process.meta_sha256);

  await assert.rejects(
    core.deleteTransition('source-process', {
      linkId,
      xml: callActivityToTask(unknown.process.xml).replace('Definitions_Process_Source', 'Definitions_Other'),
      expectedBpmnSha256: unknown.process.sha256,
      expectedMetaSha256: unknown.process.meta_sha256
    }),
    (error) => error instanceof StudioError && error.code === 'BPMN_PROCESS_MISMATCH' && error.status === 422
  );
  assert.equal(core.readProcess('source-process').sha256, unknown.process.sha256);
  assert.equal(core.readProcess('source-process').meta_sha256, unknown.process.meta_sha256);

  const removed = await core.deleteTransition('source-process', {
    linkId,
    xml: callActivityToTask(unknown.process.xml),
    expectedBpmnSha256: unknown.process.sha256,
    expectedMetaSha256: unknown.process.meta_sha256
  });
  assert.equal(removed.process.transitions.length, 0);
  assert.match(removed.process.xml, /<bpmn:task\b/u);
  assert.doesNotMatch(removed.process.xml, /<bpmn:callActivity\b/u);

  const approvedTransitionSource = writePackage(testRoot, {
    slug: 'approved-transition-source',
    processId: 'APPROVED-TRANSITION-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка сброса утверждения перехода',
    xml: callXml()
  });
  markPackageApproved(approvedTransitionSource.bpmnRoot);
  const approvedTransitionOpened = core.readProcess('approved-transition-source');
  const approvedTransitionSaved = await core.saveTransition('approved-transition-source', {
    xml: approvedTransitionOpened.xml,
    expectedBpmnSha256: approvedTransitionOpened.sha256,
    expectedMetaSha256: approvedTransitionOpened.meta_sha256,
    sourceElementId: 'CallActivity_CheckDocuments',
    relation: 'call',
    label: 'Перейти к неизвестной проверке и вернуться',
    target: { kind: 'unknown' }
  });
  assert.equal(approvedTransitionSaved.owner_decision_reopened, true);
  assert.equal(approvedTransitionSaved.process.meta.status, 'review-ready');
  assert.equal(approvedTransitionSaved.process.meta.canonicality.business_status, 'pending_human_decision');
  assert.equal(approvedTransitionSaved.process.meta.review.human_decision, 'not_recorded');

  markPackageApproved(approvedTransitionSource.bpmnRoot);
  const approvedDeleteOpened = core.readProcess('approved-transition-source');
  const approvedTransitionRemoved = await core.deleteTransition('approved-transition-source', {
    linkId: approvedTransitionSaved.transition.link_id,
    xml: callActivityToTask(approvedDeleteOpened.xml),
    expectedBpmnSha256: approvedDeleteOpened.sha256,
    expectedMetaSha256: approvedDeleteOpened.meta_sha256
  });
  assert.equal(approvedTransitionRemoved.owner_decision_reopened, true);
  assert.equal(approvedTransitionRemoved.process.meta.status, 'review-ready');
  assert.equal(approvedTransitionRemoved.process.meta.canonicality.business_status, 'pending_human_decision');
  assert.equal(approvedTransitionRemoved.process.meta.review.human_decision, 'not_recorded');

  const readerSource = writePackage(testRoot, {
    slug: 'reader-source',
    processId: 'READER-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка произвольного названия',
    xml: callXml()
  });
  const readerOpened = core.readProcess('reader-source');
  const englishFuture = await core.saveTransition('reader-source', {
    xml: readerOpened.xml,
    expectedBpmnSha256: readerOpened.sha256,
    expectedMetaSha256: readerOpened.meta_sha256,
    sourceElementId: 'CallActivity_CheckDocuments',
    relation: 'call',
    label: 'Вызвать будущую проверку и вернуться',
    target: { kind: 'reserved', title: 'Future process', slug: 'future-process' }
  });
  assert.equal(englishFuture.transition.target_title, 'Future process');
  assert.match(readFileSync(join(readerSource.processRoot, 'related-processes', 'future-process.md'), 'utf8'), /Future process/u);

  const codeSource = writePackage(testRoot, {
    slug: 'code-title-source',
    processId: 'CODE-TITLE-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка названия в виде кода',
    xml: callXml()
  });
  const codeOpened = core.readProcess('code-title-source');
  const codedFuture = await core.saveTransition('code-title-source', {
    xml: codeOpened.xml,
    expectedBpmnSha256: codeOpened.sha256,
    expectedMetaSha256: codeOpened.meta_sha256,
    sourceElementId: 'CallActivity_CheckDocuments',
    relation: 'call',
    label: 'Вызвать следующий процесс и вернуться',
    target: { kind: 'reserved', title: 'ОП-03', slug: 'opaque-process-code' }
  });
  assert.equal(codedFuture.transition.target_title, 'ОП-03');
  assert.match(readFileSync(join(codeSource.processRoot, 'related-processes', 'opaque-process-code.md'), 'utf8'), /ОП-03/u);

  const invalidTitleSource = writePackage(testRoot, {
    slug: 'invalid-title-source',
    processId: 'INVALID-TITLE-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка однострочного названия',
    xml: callXml()
  });
  const invalidTitleOpened = core.readProcess('invalid-title-source');
  await assert.rejects(
    core.saveTransition('invalid-title-source', {
      xml: invalidTitleOpened.xml,
      expectedBpmnSha256: invalidTitleOpened.sha256,
      expectedMetaSha256: invalidTitleOpened.meta_sha256,
      sourceElementId: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Вызвать следующий процесс и вернуться',
      target: { kind: 'reserved', title: 'Две\nстроки', slug: 'two-lines' }
    }),
    (error) => error instanceof StudioError && error.code === 'INVALID_TITLE' && error.status === 400
  );
  assert.equal(core.readProcess('invalid-title-source').sha256, invalidTitleOpened.sha256);
  assert.equal(existsSync(join(invalidTitleSource.processRoot, 'related-processes')), false);

  const conflictSource = writePackage(testRoot, {
    slug: 'conflict-source',
    processId: 'CONFLICT-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка конфликта карточки',
    xml: callXml()
  });
  const conflictDirectory = join(conflictSource.processRoot, 'related-processes');
  mkdirSync(conflictDirectory);
  const conflictCard = join(conflictDirectory, 'occupied-future.md');
  writeFileSync(conflictCard, '# Чужая старая карточка\n', 'utf8');
  const conflictOpened = core.readProcess('conflict-source');
  await assert.rejects(
    core.saveTransition('conflict-source', {
      xml: conflictOpened.xml,
      expectedBpmnSha256: conflictOpened.sha256,
      expectedMetaSha256: conflictOpened.meta_sha256,
      sourceElementId: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Вызвать занятую будущую проверку',
      target: { kind: 'reserved', title: 'Занятая будущая проверка', slug: 'occupied-future' }
    }),
    (error) => error instanceof StudioError && error.code === 'RESERVED_CARD_CONFLICT' && error.status === 409
  );
  assert.equal(core.readProcess('conflict-source').sha256, conflictOpened.sha256);
  assert.equal(core.readProcess('conflict-source').meta_sha256, conflictOpened.meta_sha256);
  assert.equal(readFileSync(conflictCard, 'utf8'), '# Чужая старая карточка\n');

  const raceSource = writePackage(testRoot, {
    slug: 'race-source',
    processId: 'RACE-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка конкурентного изменения',
    xml: callXml()
  });
  let injectRace = true;
  const raceCore = createStudioCore({
    projectRoot: testRoot,
    beforeTransitionCommit({ operation, paths }) {
      if (!injectRace || operation !== 'create') return;
      injectRace = false;
      const changedMeta = JSON.parse(readFileSync(paths.metaPath, 'utf8'));
      changedMeta.status = 'rework';
      atomicWriteUtf8(paths.metaPath, `${JSON.stringify(changedMeta, null, 2)}\n`);
    }
  });
  const raceOpened = raceCore.readProcess('race-source');
  await assert.rejects(
    raceCore.saveTransition('race-source', {
      xml: raceOpened.xml,
      expectedBpmnSha256: raceOpened.sha256,
      expectedMetaSha256: raceOpened.meta_sha256,
      sourceElementId: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Вызвать будущую проверку при гонке',
      target: { kind: 'reserved', title: 'Будущая проверка при гонке', slug: 'future-race-check' }
    }),
    (error) => error instanceof StudioError && error.code === 'META_CONFLICT' && error.status === 409
  );
  assert.equal(sha256(readFileSync(join(raceSource.bpmnRoot, 'process.bpmn'), 'utf8')), raceOpened.sha256);
  assert.equal(existsSync(join(raceSource.processRoot, 'related-processes')), false, 'Пустой каталог после TOCTOU-конфликта не удалён');

  const rollbackSource = writePackage(testRoot, {
    slug: 'rollback-source',
    processId: 'ROLLBACK-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка отката перехода',
    xml: callXml()
  });
  let failMetadataOnce = true;
  const rollbackCore = createStudioCore({
    projectRoot: testRoot,
    transitionWriter(path, text) {
      if (failMetadataOnce && path.endsWith('process.meta.json')) {
        failMetadataOnce = false;
        throw new Error('test metadata write failure');
      }
      atomicWriteUtf8(path, text);
    }
  });
  const rollbackOpened = rollbackCore.readProcess('rollback-source');
  await assert.rejects(
    rollbackCore.saveTransition('rollback-source', {
      xml: rollbackOpened.xml,
      expectedBpmnSha256: rollbackOpened.sha256,
      expectedMetaSha256: rollbackOpened.meta_sha256,
      sourceElementId: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Вызвать будущую проверку с откатом',
      target: { kind: 'reserved', title: 'Будущая проверка отката', slug: 'future-rollback-check' }
    }),
    /test metadata write failure/u
  );
  assert.equal(sha256(readFileSync(join(rollbackSource.bpmnRoot, 'process.bpmn'), 'utf8')), rollbackOpened.sha256);
  assert.equal(sha256(readFileSync(join(rollbackSource.bpmnRoot, 'process.meta.json'), 'utf8')), rollbackOpened.meta_sha256);
  assert.equal(existsSync(join(testRoot, 'processes', 'rollback-source', 'related-processes', 'future-rollback-check.md')), false);

  writePackage(testRoot, {
    slug: 'http-source',
    processId: 'HTTP-SOURCE',
    processElementId: 'Process_Source',
    title: 'Проверка HTTP переходов',
    xml: callXml()
  });

  const uiRoot = join(testRoot, 'studio-ui');
  mkdirSync(uiRoot);
  writeFileSync(join(uiRoot, 'index.html'), '<!doctype html><html lang="ru"><title>Studio</title></html>', 'utf8');
  const token = '0123456789abcdef0123456789abcdef';
  server = await startStudioServer({ core, token, uiRoot, port: 0 });
  const headers = { 'X-Studio-Token': token, Origin: server.origin };
  const response = await fetch(`${server.origin}/api/process/source-process/transition-targets`, { headers });
  assert.equal(response.status, 200);
  const httpTargets = await response.json();
  assert.equal(httpTargets.ok, true);
  assert.equal(httpTargets.schema, 'bpmn-studio-transition-targets/v1');
  assert.match(httpTargets.source.meta_sha256, /^[a-f0-9]{64}$/u);

  let httpResponse = await fetch(`${server.origin}/api/process/http-source`, { headers });
  const httpOpened = (await httpResponse.json()).process;
  httpResponse = await fetch(`${server.origin}/api/process/http-source/transitions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      xml: httpOpened.xml,
      expected_bpmn_sha256: httpOpened.sha256,
      expected_meta_sha256: httpOpened.meta_sha256,
      source_element_id: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Перейти к пока неизвестной HTTP-проверке',
      target: { kind: 'unknown' }
    })
  });
  assert.equal(httpResponse.status, 201);
  const httpCreated = await httpResponse.json();
  assert.equal(httpCreated.transition.target_status, 'unresolved');

  httpResponse = await fetch(`${server.origin}/api/process/http-source/transitions/${encodeURIComponent(httpCreated.transition.link_id)}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      xml: httpCreated.process.xml,
      expected_bpmn_sha256: httpCreated.process.sha256,
      expected_meta_sha256: httpCreated.process.meta_sha256,
      source_element_id: 'CallActivity_CheckDocuments',
      relation: 'call',
      label: 'Перейти к зарегистрированной HTTP-проверке',
      target: { kind: 'registered', slug: 'registered-target' }
    })
  });
  assert.equal(httpResponse.status, 200);
  const httpUpdated = await httpResponse.json();
  assert.equal(httpUpdated.transition.target_resolution, 'registered_bpmn');

  httpResponse = await fetch(`${server.origin}/api/process/http-source/transitions/${encodeURIComponent(httpCreated.transition.link_id)}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      xml: httpUpdated.process.xml,
      expected_bpmn_sha256: httpUpdated.process.sha256,
      expected_meta_sha256: httpUpdated.process.meta_sha256
    })
  });
  assert.equal(httpResponse.status, 422);
  const orphanRejected = await httpResponse.json();
  assert.equal(orphanRejected.error.code, 'CALL_ACTIVITY_STILL_PRESENT');

  httpResponse = await fetch(`${server.origin}/api/process/http-source/transitions/${encodeURIComponent(httpCreated.transition.link_id)}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      xml: callActivityToTask(httpUpdated.process.xml),
      expected_bpmn_sha256: httpUpdated.process.sha256,
      expected_meta_sha256: httpUpdated.process.meta_sha256
    })
  });
  assert.equal(httpResponse.status, 200);
  const httpDeleted = await httpResponse.json();
  assert.equal(httpDeleted.process.transitions.length, 0);

  console.log(JSON.stringify({
    status: 'passed',
    target_choices: [ 'registered', 'reserved', 'unknown' ],
    call_activity_called_element_synchronized: true,
    orphan_call_activity_rejected: true,
    transition_source_move_rejected: true,
    arbitrary_reserved_titles_accepted: [ 'Future process', 'ОП-03' ],
    reserved_title_single_line_required: true,
    registry_auto_resolution: true,
    optimistic_hashes: [ 'bpmn', 'meta' ],
    toctou_recheck_before_commit: true,
    reserved_card_identity_checked: true,
    rollback: [ 'bpmn', 'meta', 'reserved_card' ],
    http_transition_routes: [ 'list', 'create', 'update', 'delete' ],
    owner_approval_automatic: false
  }, null, 2));
} finally {
  await server?.close();
  rmSync(testRoot, { recursive: true, force: true });
}

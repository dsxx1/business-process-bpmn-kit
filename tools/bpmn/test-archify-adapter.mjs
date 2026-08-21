import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildArchifyMap } from './archify-adapter.mjs';

const projectSourceRoot = resolve(import.meta.dirname, '..', '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createFixtureProcess(projectRoot, slug, title, { processLink = false } = {}) {
  const bpmnDirectory = join(projectRoot, 'processes', slug, 'bpmn');
  mkdirSync(bpmnDirectory, { recursive: true });
  copyFileSync(
    join(projectSourceRoot, 'templates', 'process-package', 'bpmn', 'process.bpmn'),
    join(bpmnDirectory, 'process.bpmn'),
  );
  const meta = readJson(join(projectSourceRoot, 'templates', 'process-package', 'bpmn', 'process.meta.json'));
  meta.process_id = `TEST-${slug.toUpperCase()}`;
  meta.title = title;
  meta.process_links = processLink ? [
    {
      link_id: `LINK-${slug.toUpperCase()}-01`,
      source_element_id: 'Task_PerformWork',
      relation: 'call',
      label: 'Открыть связанный тестовый процесс',
      target_status: 'unresolved',
      target_process_id: null,
      target_ref: null,
      candidate_targets: [],
    },
  ] : [];
  writeFileSync(join(bpmnDirectory, 'process.meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return join(projectRoot, 'processes', slug);
}

function outputHashes(mapDirectory) {
  return Object.fromEntries([
    'process-map.workflow.json',
    'process-map.bindings.json',
    'process-map.html',
    'process-map.build-receipt.json',
  ].map((name) => [name, existsSync(join(mapDirectory, name)) ? sha(join(mapDirectory, name)) : null]));
}

function assertNoStaging(processDirectory) {
  const leftovers = readdirSync(processDirectory).filter((name) => (
    name.startsWith('.archify-map-build-') || name.startsWith('.archify-map-backup-')
  ));
  assert.deepEqual(leftovers, [], `Остались временные каталоги: ${leftovers.join(', ')}`);
  const mapDirectory = join(processDirectory, 'map');
  if (existsSync(mapDirectory)) {
    const mapLeftovers = readdirSync(mapDirectory).filter((name) => name.startsWith('.archify-map-backup-'));
    assert.deepEqual(mapLeftovers, [], `Остались backup-каталоги: ${mapLeftovers.join(', ')}`);
  }
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'bpmn-archify-adapter-'));

try {
  mkdirSync(join(fixtureRoot, 'processes'));

  const curatedDirectory = createFixtureProcess(
    fixtureRoot,
    'curated-process',
    'Курированный тестовый процесс',
  );
  const curatedMapDirectory = join(curatedDirectory, 'map');
  mkdirSync(curatedMapDirectory);
  const curatedWorkflow = join(curatedMapDirectory, 'process-map.workflow.json');
  copyFileSync(
    join(projectSourceRoot, 'processes', 'skupka-zolota', 'map', 'process-map.workflow.json'),
    curatedWorkflow,
  );
  const curatedWorkflowDocument = readJson(curatedWorkflow);
  curatedWorkflowDocument.meta.title = 'Курированный тестовый процесс';
  writeFileSync(curatedWorkflow, `${JSON.stringify(curatedWorkflowDocument, null, 2)}\n`, 'utf8');
  const curatedBindings = join(curatedMapDirectory, 'process-map.bindings.json');
  writeFileSync(curatedBindings, `${JSON.stringify({
    schema: 'human-map-bpmn-bindings/v1',
    process_id: 'TEST-CURATED-PROCESS',
    map_ref: 'processes/curated-process/map/process-map.workflow.json',
    bpmn_ref: 'processes/curated-process/bpmn/process.bpmn',
    meta_ref: 'processes/curated-process/bpmn/process.meta.json',
    bindings: curatedWorkflowDocument.nodes.map((node) => ({
      map_node_id: node.id,
      bpmn_element_ids: [ 'Task_PerformWork' ],
      process_link_ids: [],
    })),
  }, null, 2)}\n`, 'utf8');
  const curatedWorkflowBefore = sha(curatedWorkflow);
  const curatedBpmn = join(curatedDirectory, 'bpmn', 'process.bpmn');
  const curatedBpmnBefore = sha(curatedBpmn);

  const curatedFirst = await buildArchifyMap({
    slug: 'curated-process',
    projectRoot: fixtureRoot,
  });
  assert.equal(curatedFirst.receipt.source.mode, 'curated');
  assert.equal(curatedFirst.receipt.source.automatic_draft, false);
  assert.equal(curatedFirst.receipt.tool.version, '2.14.0+local-humanize');
  assert.equal(curatedFirst.receipt.tool.upstream_version, '2.14.0');
  assert.equal(curatedFirst.receipt.tool.build_profile, 'local-humanize');
  assert.equal(curatedFirst.receipt.validation.composition_status, 'pass');
  assert.equal(curatedFirst.receipt.validation.errors, 0);
  assert.equal(curatedFirst.receipt.validation.warnings, 0);
  assert.equal(curatedFirst.receipt.validation.map_to_bpmn.status, 'passed');
  assert.equal(curatedFirst.receipt.validation.map_to_bpmn.map_nodes, curatedWorkflowDocument.nodes.length);
  assert.equal(curatedFirst.receipt.presentation.locale, 'ru');
  assert.equal(curatedFirst.receipt.presentation.map_ui_validation, 'passed');
  assert.equal(curatedFirst.receipt.guarantees.guarded_inputs_rechecked_before_backup_cleanup, true);
  const curatedArtifact = readFileSync(curatedFirst.paths.artifact, 'utf8');
  const archifyLicense = readFileSync(
    join(projectSourceRoot, 'vendor', 'archify', 'LICENSE'),
    'utf8',
  ).trimEnd();
  assert.match(curatedArtifact, /archify 2\.14\.0\+local-humanize/u);
  assert.ok(
    curatedArtifact.includes(`Archify third-party license notice\n\n${archifyLicense}\n-->`),
    'Самодостаточная HTML-карта должна содержать полный текст лицензии Archify',
  );
  const repeatedLocalization = spawnSync(
    process.execPath,
    [ join(projectSourceRoot, 'tools', 'bpmn', 'localize-map-ru.mjs'), curatedFirst.paths.artifact ],
    { cwd: projectSourceRoot, encoding: 'utf8' },
  );
  assert.equal(repeatedLocalization.status, 0, repeatedLocalization.stderr || repeatedLocalization.stdout);
  assert.equal(
    sha(curatedFirst.paths.artifact),
    curatedFirst.receipt.artifact.sha256,
    'Повторная локализация готовой Archify-карты должна быть байтово идемпотентной',
  );
  assert.equal(sha(curatedWorkflow), curatedWorkflowBefore);
  assert.equal(sha(curatedBpmn), curatedBpmnBefore);
  assert.equal(sha(curatedFirst.paths.artifact), curatedFirst.receipt.artifact.sha256);
  assert.equal(readJson(curatedFirst.paths.receipt).artifact.sha256, curatedFirst.receipt.artifact.sha256);
  const curatedReceiptBefore = sha(curatedFirst.paths.receipt);
  const curatedArtifactBefore = sha(curatedFirst.paths.artifact);

  const curatedSecond = await buildArchifyMap({
    slug: 'curated-process',
    projectRoot: fixtureRoot,
  });
  assert.equal(curatedSecond.receipt.source.mode, 'curated');
  assert.equal(sha(curatedSecond.paths.receipt), curatedReceiptBefore);
  assert.equal(sha(curatedSecond.paths.artifact), curatedArtifactBefore);
  assertNoStaging(curatedDirectory);

  const validCuratedBindings = readFileSync(curatedBindings, 'utf8');
  const invalidCuratedBindings = JSON.parse(validCuratedBindings);
  invalidCuratedBindings.bindings[0].map_node_id = 'missing-node';
  writeFileSync(curatedBindings, `${JSON.stringify(invalidCuratedBindings, null, 2)}\n`, 'utf8');
  await assert.rejects(
    buildArchifyMap({ slug: 'curated-process', projectRoot: fixtureRoot }),
    /отсутствующий узел карты/u,
  );
  assert.equal(sha(curatedSecond.paths.receipt), curatedReceiptBefore);
  assert.equal(sha(curatedSecond.paths.artifact), curatedArtifactBefore);
  writeFileSync(curatedBindings, validCuratedBindings, 'utf8');
  assertNoStaging(curatedDirectory);

  const automaticDirectory = createFixtureProcess(
    fixtureRoot,
    'automatic-process',
    'Gold & buying <ОП-03>',
    { processLink: true },
  );
  const automaticBpmn = join(automaticDirectory, 'bpmn', 'process.bpmn');
  const automaticBpmnBefore = sha(automaticBpmn);
  const automaticFirst = await buildArchifyMap({
    slug: 'automatic-process',
    projectRoot: fixtureRoot,
  });
  assert.equal(automaticFirst.receipt.source.mode, 'automatic_draft');
  assert.equal(automaticFirst.receipt.source.automatic_draft, true);
  assert.equal(automaticFirst.receipt.guarantees.canonical_bpmn_unchanged, true);
  assert.equal(automaticFirst.receipt.presentation.map_ui_validation, 'passed');
  assert.equal(sha(automaticBpmn), automaticBpmnBefore);

  const generatedWorkflow = readJson(automaticFirst.paths.workflow);
  assert.equal(generatedWorkflow.diagram_type, 'workflow');
  assert.equal(generatedWorkflow.meta.title, 'Gold & buying <ОП-03> · Автоматический черновик карты');
  assert.ok(generatedWorkflow.nodes.length >= 2);
  for (const node of generatedWorkflow.nodes) assert.match(node.label, /[А-Яа-яЁё]/u);
  for (const edge of generatedWorkflow.edges) assert.match(edge.label, /[А-Яа-яЁё]/u);

  const generatedBindings = readJson(automaticFirst.paths.bindings);
  assert.equal(generatedBindings.schema, 'human-map-bpmn-bindings/v1');
  assert.equal(generatedBindings.bindings.length, generatedWorkflow.nodes.length);
  assert.equal(generatedWorkflow.nodes.length, 6, 'Автокарта должна сохранить каждый FlowNode шаблона');
  const mapNodeForBpmn = (bpmnElementId) => generatedBindings.bindings.find((binding) => (
    binding.bpmn_element_ids.includes(bpmnElementId)
  ))?.map_node_id;
  const gatewayMapNode = mapNodeForBpmn('Gateway_CanPerform');
  const performMapNode = mapNodeForBpmn('Task_PerformWork');
  const rejectedMapNode = mapNodeForBpmn('EndEvent_NotPerformed');
  assert.ok(gatewayMapNode && performMapNode && rejectedMapNode);
  const gatewayEdges = generatedWorkflow.edges.filter((edge) => edge.from === gatewayMapNode);
  assert.deepEqual(
    new Set(gatewayEdges.map((edge) => edge.to)),
    new Set([performMapNode, rejectedMapNode]),
    'Обе ветки exclusive gateway должны сохраниться в автокарте',
  );
  assert.ok(gatewayEdges.some((edge) => /^Да:/u.test(edge.label)), 'У положительной ветки нет русского условия');
  assert.ok(gatewayEdges.some((edge) => /^Нет:/u.test(edge.label)), 'У отрицательной ветки нет русского условия');
  assert.deepEqual(
    generatedBindings.bindings.flatMap((binding) => binding.process_link_ids),
    ['LINK-AUTOMATIC-PROCESS-01'],
  );

  const automaticHashesBeforeRepeat = outputHashes(join(automaticDirectory, 'map'));
  const automaticSecond = await buildArchifyMap({
    slug: 'automatic-process',
    projectRoot: fixtureRoot,
  });
  assert.equal(automaticSecond.receipt.source.mode, 'automatic_draft');
  assert.deepEqual(outputHashes(join(automaticDirectory, 'map')), automaticHashesBeforeRepeat);

  const automaticMetaPath = join(automaticDirectory, 'bpmn', 'process.meta.json');
  const changedMeta = readJson(automaticMetaPath);
  changedMeta.title = 'Название изменено для проверки отката';
  writeFileSync(automaticMetaPath, `${JSON.stringify(changedMeta, null, 2)}\n`, 'utf8');
  await assert.rejects(
    buildArchifyMap({
      slug: 'automatic-process',
      projectRoot: fixtureRoot,
      testHooks: { failCommitAfter: 1 },
    }),
    /Тестовая ошибка/u,
  );
  assert.deepEqual(outputHashes(join(automaticDirectory, 'map')), automaticHashesBeforeRepeat);
  assert.equal(sha(automaticBpmn), automaticBpmnBefore);
  assertNoStaging(automaticDirectory);

  const metaBeforeRace = readFileSync(automaticMetaPath, 'utf8');
  await assert.rejects(
    buildArchifyMap({
      slug: 'automatic-process',
      projectRoot: fixtureRoot,
      testHooks: {
        beforeFinalInputCheck() {
          const racedMeta = JSON.parse(metaBeforeRace);
          racedMeta.title = 'Параллельное изменение во время фиксации';
          writeFileSync(automaticMetaPath, `${JSON.stringify(racedMeta, null, 2)}\n`, 'utf8');
        },
      },
    }),
    /Исходник изменился во время сборки/u,
  );
  assert.deepEqual(
    outputHashes(join(automaticDirectory, 'map')),
    automaticHashesBeforeRepeat,
    'При гонке guarded input результаты должны откатиться из backup',
  );
  writeFileSync(automaticMetaPath, metaBeforeRace, 'utf8');
  assertNoStaging(automaticDirectory);

  const loopDirectory = createFixtureProcess(
    fixtureRoot,
    'loop-process',
    'Тестовый процесс с циклом',
  );
  const loopBpmnPath = join(loopDirectory, 'bpmn', 'process.bpmn');
  const loopBpmn = readFileSync(loopBpmnPath, 'utf8')
    .replace(
      '<bpmn:incoming>Flow_StartToClarify</bpmn:incoming>',
      '<bpmn:incoming>Flow_StartToClarify</bpmn:incoming>\n      <bpmn:incoming>Flow_LoopBack</bpmn:incoming>',
    )
    .replace(
      '<bpmn:outgoing>Flow_WorkToSuccess</bpmn:outgoing>',
      '<bpmn:outgoing>Flow_WorkToSuccess</bpmn:outgoing>\n      <bpmn:outgoing>Flow_LoopBack</bpmn:outgoing>',
    )
    .replace(
      '    <bpmn:sequenceFlow id="Flow_WorkToSuccess" sourceRef="Task_PerformWork" targetRef="EndEvent_ResultDelivered" />',
      '    <bpmn:sequenceFlow id="Flow_WorkToSuccess" sourceRef="Task_PerformWork" targetRef="EndEvent_ResultDelivered" />\n    <bpmn:sequenceFlow id="Flow_LoopBack" name="Повторить" sourceRef="Task_PerformWork" targetRef="Task_ClarifyInput" />',
    );
  writeFileSync(loopBpmnPath, loopBpmn, 'utf8');
  const loopResult = await buildArchifyMap({ slug: 'loop-process', projectRoot: fixtureRoot });
  const loopWorkflow = readJson(loopResult.paths.workflow);
  const loopBindings = readJson(loopResult.paths.bindings);
  const loopMapNodeForBpmn = (bpmnElementId) => loopBindings.bindings.find((binding) => (
    binding.bpmn_element_ids.includes(bpmnElementId)
  ))?.map_node_id;
  const loopReturn = loopWorkflow.edges.find((edge) => (
    edge.from === loopMapNodeForBpmn('Task_PerformWork')
      && edge.to === loopMapNodeForBpmn('Task_ClarifyInput')
  ));
  assert.equal(loopReturn?.role, 'return');
  assert.equal(loopReturn?.route, 'up-channel');
  assert.match(loopReturn?.label || '', /Повторить/u);
  assertNoStaging(loopDirectory);

  const missingProcessDirectory = createFixtureProcess(
    fixtureRoot,
    'missing-process-id',
    'Тест отсутствующего BPMN process',
  );
  const missingProcessMetaPath = join(missingProcessDirectory, 'bpmn', 'process.meta.json');
  const missingProcessMeta = readJson(missingProcessMetaPath);
  missingProcessMeta.bpmn.process_element_id = 'Process_DoesNotExist';
  writeFileSync(missingProcessMetaPath, `${JSON.stringify(missingProcessMeta, null, 2)}\n`, 'utf8');
  await assert.rejects(
    buildArchifyMap({ slug: 'missing-process-id', projectRoot: fixtureRoot }),
    /не найден process с ID «Process_DoesNotExist»/u,
  );

  const ambiguousDirectory = createFixtureProcess(
    fixtureRoot,
    'ambiguous-process',
    'Тест неоднозначного BPMN process',
  );
  const ambiguousMetaPath = join(ambiguousDirectory, 'bpmn', 'process.meta.json');
  const ambiguousMeta = readJson(ambiguousMetaPath);
  delete ambiguousMeta.bpmn.process_element_id;
  writeFileSync(ambiguousMetaPath, `${JSON.stringify(ambiguousMeta, null, 2)}\n`, 'utf8');
  const ambiguousBpmnPath = join(ambiguousDirectory, 'bpmn', 'process.bpmn');
  const ambiguousBpmn = readFileSync(ambiguousBpmnPath, 'utf8').replace(
    '  <bpmndi:BPMNDiagram id="BPMNDiagram_Template">',
    '  <bpmn:process id="Process_Second" name="Второй процесс" isExecutable="false">\n    <bpmn:startEvent id="StartEvent_Second" name="Начать второй процесс" />\n  </bpmn:process>\n  <bpmndi:BPMNDiagram id="BPMNDiagram_Template">',
  );
  writeFileSync(ambiguousBpmnPath, ambiguousBpmn, 'utf8');
  await assert.rejects(
    buildArchifyMap({ slug: 'ambiguous-process', projectRoot: fixtureRoot }),
    /найдено несколько process.*bpmn\.process_element_id/u,
  );

  const singleFallbackDirectory = createFixtureProcess(
    fixtureRoot,
    'single-process-fallback',
    'Тест единственного процесса BPMN',
  );
  const singleFallbackMetaPath = join(singleFallbackDirectory, 'bpmn', 'process.meta.json');
  const singleFallbackMeta = readJson(singleFallbackMetaPath);
  delete singleFallbackMeta.bpmn.process_element_id;
  writeFileSync(singleFallbackMetaPath, `${JSON.stringify(singleFallbackMeta, null, 2)}\n`, 'utf8');
  const singleFallback = await buildArchifyMap({
    slug: 'single-process-fallback',
    projectRoot: fixtureRoot,
  });
  assert.equal(singleFallback.receipt.source.mode, 'automatic_draft');
  assertNoStaging(singleFallbackDirectory);

  await assert.rejects(
    buildArchifyMap({ slug: '../escape', projectRoot: fixtureRoot }),
    /латинских букв, цифр и дефисов/u,
  );
  const linkedTarget = createFixtureProcess(
    fixtureRoot,
    'linked-target',
    'Целевой процесс для проверки ссылки',
  );
  symlinkSync(linkedTarget, join(fixtureRoot, 'processes', 'linked-alias'), 'junction');
  await assert.rejects(
    buildArchifyMap({ slug: 'linked-alias', projectRoot: fixtureRoot }),
    /символической ссылкой или точкой соединения/u,
  );
  await assert.rejects(
    buildArchifyMap({ slug: 'missing-process', projectRoot: fixtureRoot }),
    /Процесс не найден/u,
  );

  console.log(JSON.stringify({
    status: 'passed',
    scenarios: [
      'курированная карта',
      'автоматический черновик из BPMN',
      'повторяемые HTML и квитанция',
      'проверка привязок карты к BPMN',
      'привязка межпроцессной связи',
      'откат после частичной фиксации',
      'сохранение обеих веток BPMN gateway',
      'сохранение обратного перехода BPMN-цикла',
      'откат при гонке guarded input',
      'строгий выбор BPMN process',
      'защита от выхода за пределы каталога',
      'запрет ссылки или точки соединения вместо пакета',
    ],
  }, null, 2));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

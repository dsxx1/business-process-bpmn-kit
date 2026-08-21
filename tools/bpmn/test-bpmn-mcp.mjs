import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';

import { createBpmnMcpCore, resolveProjectRoot } from './bpmn-mcp-core.mjs';
import { createBpmnMcpServer } from './bpmn-mcp-protocol.mjs';
import { parseServerArguments } from './bpmn-mcp-server.mjs';
import { acquireBpmnOperationLock, releaseBpmnOperationLock } from './bpmn-operation-lock.mjs';
import { createStudioCore } from './studio-core.mjs';

const expectedToolNames = [
  'bpmn_build_human_map',
  'bpmn_create_draft',
  'bpmn_get_capabilities',
  'bpmn_get_process',
  'bpmn_list_processes',
  'bpmn_list_transition_targets',
  'bpmn_register_draft',
  'bpmn_remove_process_transition',
  'bpmn_save_xml',
  'bpmn_set_process_transition',
  'bpmn_update_package',
  'bpmn_validate'
];

function bpmnXml({ title = 'Демонстрационный процесс', executable = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Demo" targetNamespace="https://example.invalid/bpmn">
  <bpmn:process id="Process_Demo" name="${title}" isExecutable="${executable}">
    <bpmn:startEvent id="Event_Start" name="Начало" />
    <bpmn:callActivity id="CallActivity_CheckTarget" name="Выполнить связанную проверку" />
    <bpmn:endEvent id="Event_End" name="Конец" />
    <bpmn:sequenceFlow id="Flow_StartToCall" sourceRef="Event_Start" targetRef="CallActivity_CheckTarget" />
    <bpmn:sequenceFlow id="Flow_CallToEnd" sourceRef="CallActivity_CheckTarget" targetRef="Event_End" />
  </bpmn:process>
  <bpmn:collaboration id="Collaboration_Demo">
    <bpmn:participant id="Participant_Demo" name="Участник демонстрационного процесса" processRef="Process_Demo" />
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

function createFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'business-process-bpmn-mcp-test-'));
  const processRoot = join(projectRoot, 'processes', 'demo-process');
  const bpmnRoot = join(processRoot, 'bpmn');
  mkdirSync(bpmnRoot, { recursive: true });
  mkdirSync(join(projectRoot, 'registry'), { recursive: true });
  writeFileSync(join(bpmnRoot, 'process.bpmn'), bpmnXml(), 'utf8');
  writeFileSync(join(bpmnRoot, 'process.meta.json'), `${JSON.stringify({
    schema_version: '1.0.0',
    process_id: 'DEMO-PROCESS',
    title: 'Демонстрационный процесс',
    version: '0.1.0',
    variant: 'canonical',
    status: 'draft',
    canonicality: { business_status: 'pending_human_decision' },
    bpmn: {
      definitions_id: 'Definitions_Demo',
      process_element_id: 'Process_Demo',
      collaboration_id: 'Collaboration_Demo',
      is_executable: false
    },
    process_links: [ {
      target_process_id: 'MISSING-PROCESS',
      target_status: 'unresolved'
    } ],
    review: { owner_role: null, human_decision: 'not_recorded' }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(join(bpmnRoot, 'questions.json'), `${JSON.stringify({
    questions: [
      { id: 'Q_OWNER', title: 'Кто владелец?', status: 'open', blocking: true },
      { id: 'Q_SCOPE', title: 'Где граница?', status: 'closed', blocking: false }
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(join(projectRoot, 'registry', 'processes.json'), `${JSON.stringify({ processes: [] }, null, 2)}\n`, 'utf8');
  return { projectRoot, processRoot, bpmnRoot };
}

function removeFixture(projectRoot) {
  const safePrefix = join(tmpdir(), 'business-process-bpmn-mcp-test-').toLocaleLowerCase();
  if (!projectRoot.toLocaleLowerCase().startsWith(safePrefix)) {
    throw new Error(`Отказ от удаления неожиданного тестового пути: ${projectRoot}`);
  }
  rmSync(projectRoot, { recursive: true, force: true });
}

function markFixtureApproved(fixture) {
  const metaPath = join(fixture.bpmnRoot, 'process.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.status = 'approved';
  meta.canonicality.business_status = 'canonical';
  meta.review.human_decision = 'approved';
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

async function openSession(projectRoot) {
  const server = createBpmnMcpServer({ projectRoot });
  const client = new Client({ name: 'bpmn-mcp-contract-test', version: '1.0.0' });
  const [ clientTransport, serverTransport ] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    async close() {
      await client.close();
      if (server.isConnected()) await server.close();
    }
  };
}

test('официальный MCP Client и InMemoryTransport проходят initialize, tools и resources', async () => {
  const fixture = createFixture();
  let session;
  try {
    session = await openSession(fixture.projectRoot);
    assert.equal(session.client.getServerVersion()?.name, 'business-process-bpmn-kit');
    assert.match(session.client.getInstructions() || '', /только человек/iu);

    const listedTools = await session.client.listTools();
    assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), expectedToolNames);
    assert.equal(listedTools.tools.find((tool) => tool.name === 'bpmn_get_process').annotations?.readOnlyHint, true);
    assert.equal(listedTools.tools.find((tool) => tool.name === 'bpmn_save_xml').annotations?.destructiveHint, true);
    assert.equal(listedTools.tools.find((tool) => tool.name === 'bpmn_set_process_transition').annotations?.idempotentHint, false);
    assert.equal(listedTools.tools.find((tool) => tool.name === 'bpmn_remove_process_transition').annotations?.idempotentHint, false);
    assert.equal(listedTools.tools.some((tool) => tool.name === 'bpmn_approve'), false);
    assert.equal(listedTools.tools.some((tool) => tool.name === 'bpmn_record_owner_decision'), false);

    const capabilities = await session.client.callTool({ name: 'bpmn_get_capabilities', arguments: {} });
    assert.equal(capabilities.isError, undefined);
    assert.equal(capabilities.structuredContent.ok, true);
    assert.equal(capabilities.structuredContent.result.boundaries.ai_optional, true);
    assert.equal(capabilities.structuredContent.result.boundaries.approval_forbidden, true);

    const catalog = await session.client.callTool({ name: 'bpmn_list_processes', arguments: {} });
    assert.equal(catalog.structuredContent.result.processes.length, 1);
    assert.equal(catalog.structuredContent.result.processes[0].summary.questions.blocking_open, 1);
    assert.match(catalog.structuredContent.result.processes[0].sha256, /^[a-f0-9]{64}$/u);

    const processResult = await session.client.callTool({
      name: 'bpmn_get_process',
      arguments: { slug: 'demo-process' }
    });
    assert.equal('xml' in processResult.structuredContent.result, false);
    assert.equal(processResult.structuredContent.result.summary.links.unresolved, 1);

    const transitionTargets = await session.client.callTool({
      name: 'bpmn_list_transition_targets',
      arguments: { slug: 'demo-process' }
    });
    assert.deepEqual(transitionTargets.structuredContent.result.supported_relations, [ 'call' ]);
    assert.match(transitionTargets.structuredContent.result.source.meta_sha256, /^[a-f0-9]{64}$/u);

    const editable = await session.client.callTool({
      name: 'bpmn_get_process',
      arguments: { slug: 'demo-process', include_xml: true }
    });
    const editableProcess = editable.structuredContent.result;
    const linked = await session.client.callTool({
      name: 'bpmn_set_process_transition',
      arguments: {
        slug: 'demo-process',
        xml: editableProcess.xml,
        expected_bpmn_sha256: editableProcess.sha256,
        expected_meta_sha256: editableProcess.meta_sha256,
        source_element_id: 'CallActivity_CheckTarget',
        relation: 'call',
        label: 'Перейти к пока не определённой проверке',
        target: { kind: 'unknown' }
      }
    });
    assert.equal(linked.structuredContent.ok, true);
    assert.equal(linked.structuredContent.result.transition.target_status, 'unresolved');
    assert.equal(linked.structuredContent.result.process.meta.canonicality.business_status, 'pending_human_decision');
    const createdLinkId = linked.structuredContent.result.transition.link_id;

    const orphaned = await session.client.callTool({
      name: 'bpmn_remove_process_transition',
      arguments: {
        slug: 'demo-process',
        link_id: createdLinkId,
        xml: linked.structuredContent.result.process.xml,
        expected_bpmn_sha256: linked.structuredContent.result.process.sha256,
        expected_meta_sha256: linked.structuredContent.result.process.meta_sha256
      }
    });
    assert.equal(orphaned.isError, true);
    assert.equal(orphaned.structuredContent.error.code, 'CALL_ACTIVITY_STILL_PRESENT');

    const unlinked = await session.client.callTool({
      name: 'bpmn_remove_process_transition',
      arguments: {
        slug: 'demo-process',
        link_id: createdLinkId,
        xml: callActivityToTask(linked.structuredContent.result.process.xml),
        expected_bpmn_sha256: linked.structuredContent.result.process.sha256,
        expected_meta_sha256: linked.structuredContent.result.process.meta_sha256
      }
    });
    assert.equal(unlinked.structuredContent.ok, true);
    assert.equal(unlinked.structuredContent.result.process.meta.process_links.some((link) => link.link_id === createdLinkId), false);

    const resources = await session.client.listResources();
    assert.equal(resources.resources.some((resource) => resource.uri === 'bpmn://catalog'), true);
    assert.equal(resources.resources.some((resource) => resource.uri === 'bpmn://process/demo-process/xml'), true);
    const templates = await session.client.listResourceTemplates();
    assert.equal(templates.resourceTemplates.some((template) => template.uriTemplate === 'bpmn://process/{slug}/{section}'), true);

    const metaResource = await session.client.readResource({ uri: 'bpmn://process/demo-process/meta' });
    const meta = JSON.parse(metaResource.contents[0].text);
    assert.match(meta.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(meta.summary.title, 'Демонстрационный процесс');
    const xmlResource = await session.client.readResource({ uri: 'bpmn://process/demo-process/xml' });
    assert.match(xmlResource.contents[0].text, /isExecutable="false"/u);
    const questionsResource = await session.client.readResource({ uri: 'bpmn://process/demo-process/questions' });
    assert.equal(JSON.parse(questionsResource.contents[0].text).questions.length, 2);
    const linksResource = await session.client.readResource({ uri: 'bpmn://process/demo-process/links' });
    assert.equal(JSON.parse(linksResource.contents[0].text).links[0].target_status, 'unresolved');
  } finally {
    await session?.close();
    removeFixture(fixture.projectRoot);
  }
});

test('официальный stdio client запускает entrypoint без загрязнения stdout', async () => {
  const fixture = createFixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(import.meta.dirname, 'bpmn-mcp-server.mjs'),
      '--project-root',
      fixture.projectRoot
    ],
    cwd: import.meta.dirname,
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const client = new Client({ name: 'bpmn-mcp-stdio-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), expectedToolNames);
    const capabilities = await client.callTool({ name: 'bpmn_get_capabilities', arguments: {} });
    assert.equal(capabilities.structuredContent.result.server.local_stdio_entrypoint, 'tools/bpmn/bpmn-mcp-server.mjs');
    assert.equal(stderr, '');
  } finally {
    await client.close().catch(() => undefined);
    removeFixture(fixture.projectRoot);
  }
});

test('ошибки traversal и optimistic concurrency возвращаются структурированно на русском', async () => {
  const fixture = createFixture();
  let session;
  try {
    session = await openSession(fixture.projectRoot);
    const traversal = await session.client.callTool({
      name: 'bpmn_get_process',
      arguments: { slug: '../outside' }
    });
    assert.equal(traversal.isError, true);
    assert.equal(traversal.structuredContent.ok, false);
    assert.equal(traversal.structuredContent.error.code, 'INVALID_SLUG');
    assert.match(traversal.structuredContent.error.message, /короткое имя/iu);

    const current = await session.client.callTool({
      name: 'bpmn_get_process',
      arguments: { slug: 'demo-process' }
    });
    const expectedSha256 = current.structuredContent.result.sha256;
    const changedXml = bpmnXml({ title: 'Изменённый демонстрационный процесс' });
    const identityMismatch = await session.client.callTool({
      name: 'bpmn_save_xml',
      arguments: {
        slug: 'demo-process',
        xml: changedXml.replace('Definitions_Demo', 'Definitions_Other'),
        expected_sha256: expectedSha256
      }
    });
    assert.equal(identityMismatch.isError, true);
    assert.equal(identityMismatch.structuredContent.error.code, 'BPMN_PROCESS_MISMATCH');
    assert.equal(readFileSync(join(fixture.bpmnRoot, 'process.bpmn'), 'utf8'), bpmnXml());

    markFixtureApproved(fixture);
    const saved = await session.client.callTool({
      name: 'bpmn_save_xml',
      arguments: { slug: 'demo-process', xml: changedXml, expected_sha256: expectedSha256 }
    });
    assert.equal(saved.structuredContent.ok, true);
    assert.notEqual(saved.structuredContent.result.process.sha256, expectedSha256);
    assert.equal(readFileSync(join(fixture.bpmnRoot, 'process.bpmn'), 'utf8'), changedXml);
    assert.equal(saved.structuredContent.result.owner_decision_reopened, true);
    assert.equal(saved.structuredContent.result.process.meta.status, 'review-ready');
    assert.equal(saved.structuredContent.result.process.meta.canonicality.business_status, 'pending_human_decision');
    assert.equal(saved.structuredContent.result.process.meta.review.human_decision, 'not_recorded');

    const stale = await session.client.callTool({
      name: 'bpmn_save_xml',
      arguments: { slug: 'demo-process', xml: bpmnXml({ title: 'Конфликт' }), expected_sha256: expectedSha256 }
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.error.code, 'BPMN_CONFLICT');
    assert.equal(readFileSync(join(fixture.bpmnRoot, 'process.bpmn'), 'utf8'), changedXml);

    const executable = await session.client.callTool({
      name: 'bpmn_save_xml',
      arguments: {
        slug: 'demo-process',
        xml: bpmnXml({ title: 'Исполняемый процесс', executable: true }),
        expected_sha256: saved.structuredContent.result.process.sha256
      }
    });
    assert.equal(executable.isError, true);
    assert.equal(executable.structuredContent.error.code, 'EXECUTABLE_CANONICAL_MODEL');
    assert.equal(readFileSync(join(fixture.bpmnRoot, 'process.bpmn'), 'utf8'), changedXml);
    assert.equal(
      existsSync(join(fixture.projectRoot, 'processes', '.bpmn-operation-demo-process.lock')),
      false
    );
    assert.equal(readdirSync(fixture.bpmnRoot).some((name) => name.endsWith('.tmp')), false);
  } finally {
    await session?.close();
    removeFixture(fixture.projectRoot);
  }
});

test('Studio и MCP используют одну cross-process блокировку записи', async () => {
  const fixture = createFixture();
  try {
    const workerSource = `
      const kind = process.env.BPMN_LOCK_TEST_KIND;
      const projectRoot = process.env.BPMN_LOCK_TEST_ROOT;
      try {
        if (kind === 'studio') {
          const { createStudioCore } = await import(${JSON.stringify(new URL('./studio-core.mjs', import.meta.url).href)});
          const core = createStudioCore({ projectRoot });
          const current = core.readProcess('demo-process');
          await core.saveBpmn('demo-process', { xml: current.xml, expectedSha256: current.sha256 });
        } else {
          const { createBpmnMcpCore } = await import(${JSON.stringify(new URL('./bpmn-mcp-core.mjs', import.meta.url).href)});
          const core = createBpmnMcpCore({ projectRoot });
          const current = core.getProcess('demo-process', { includeXml: true });
          await core.saveXml({ slug: 'demo-process', xml: current.xml, expectedSha256: current.sha256 });
        }
        process.stdout.write(JSON.stringify({ ok: true }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, code: error.code, message: error.message }));
      }
    `;
    const heldLock = acquireBpmnOperationLock(join(fixture.projectRoot, 'processes'), 'demo-process');
    try {
      for (const kind of [ 'studio', 'mcp' ]) {
        const child = spawnSync(process.execPath, [ '--input-type=module', '--eval', workerSource ], {
          encoding: 'utf8',
          env: {
            ...process.env,
            BPMN_LOCK_TEST_KIND: kind,
            BPMN_LOCK_TEST_ROOT: fixture.projectRoot
          },
          timeout: 20_000,
          windowsHide: true
        });
        assert.equal(child.status, 0, child.stderr || child.error?.message);
        const outcome = JSON.parse(child.stdout);
        assert.equal(outcome.ok, false);
        assert.equal(outcome.code, 'BPMN_BUSY');
      }
    } finally {
      releaseBpmnOperationLock(heldLock);
    }

    const studio = createStudioCore({ projectRoot: fixture.projectRoot });
    const mcp = createBpmnMcpCore({ projectRoot: fixture.projectRoot });
    const current = mcp.getProcess('demo-process');
    const settled = await Promise.allSettled([
      studio.saveBpmn('demo-process', {
        xml: bpmnXml({ title: 'Запись из Studio' }),
        expectedSha256: current.sha256
      }),
      mcp.saveXml({
        slug: 'demo-process',
        xml: bpmnXml({ title: 'Запись из MCP' }),
        expectedSha256: current.sha256
      })
    ]);
    assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = settled.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'BPMN_BUSY');
    assert.equal(existsSync(join(fixture.projectRoot, 'processes', '.bpmn-operation-demo-process.lock')), false);
  } finally {
    removeFixture(fixture.projectRoot);
  }
});

test('project root и process symlink проверяются до доступа к данным', (t) => {
  const fixture = createFixture();
  try {
    assert.equal(resolveProjectRoot(fixture.projectRoot), realpathSync.native(fixture.projectRoot));
    assert.throws(() => resolveProjectRoot(join(fixture.projectRoot, 'missing')), { code: 'PROJECT_ROOT_NOT_FOUND' });
    assert.equal(parseServerArguments([], {}).projectRoot, undefined);
    assert.throws(() => createBpmnMcpCore({ projectRoot: parseServerArguments([], {}).projectRoot }), {
      code: 'PROJECT_ROOT_REQUIRED'
    });

    const linkedProcess = join(fixture.projectRoot, 'processes', 'linked-process');
    try {
      symlinkSync(fixture.processRoot, linkedProcess, 'junction');
    } catch (error) {
      if ([ 'EPERM', 'EACCES', 'ENOTSUP' ].includes(error?.code)) {
        t.skip(`Создание junction недоступно: ${error.code}`);
        return;
      }
      throw error;
    }
    const core = createBpmnMcpCore({ projectRoot: fixture.projectRoot });
    assert.throws(() => core.getProcess('linked-process'), { code: 'UNSAFE_PATH' });
  } finally {
    removeFixture(fixture.projectRoot);
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquireProjectMutationLock,
  canonicalProjectMutationLockPath,
  projectMutationLockOwnerPidEnvironment,
  projectMutationLockTokenEnvironment,
  releaseBpmnOperationLock
} from './bpmn-operation-lock.mjs';

import {
  loadRegisteredProcess,
  parseArguments,
  recordOwnerDecision,
  validateSlug
} from './record-owner-decision.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const tempRoot = resolve(projectRoot, 'temp', 'record-owner-decision-test');
const studioCoreUrl = pathToFileURL(resolve(projectRoot, 'tools', 'bpmn', 'studio-core.mjs')).href;
const operationLockUrl = pathToFileURL(resolve(projectRoot, 'tools', 'bpmn', 'bpmn-operation-lock.mjs')).href;

function fixtureBpmnXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Test" targetNamespace="https://example.invalid/bpmn/test">
  <bpmn:collaboration id="Collaboration_Test">
    <bpmn:participant id="Participant_Test" name="Участник тестового процесса" processRef="Process_Test" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Test" name="Тестовый бизнес-процесс" isExecutable="false">
    <bpmn:startEvent id="StartEvent_Test" name="Процесс начат" />
  </bpmn:process>
</bpmn:definitions>
`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createFixture(caseName, { registered = true, unsafeSourceRef = false } = {}) {
  const root = resolve(tempRoot, caseName);
  const slug = 'test-process';
  const packageRoot = resolve(root, 'processes', slug);
  const bpmnRoot = resolve(packageRoot, 'bpmn');
  const registryRoot = resolve(root, 'registry');
  mkdirSync(bpmnRoot, { recursive: true });
  mkdirSync(registryRoot, { recursive: true });
  writeFileSync(resolve(packageRoot, 'process-card.md'), '# Карточка тестового процесса\n', 'utf8');
  writeFileSync(resolve(packageRoot, 'evidence-one.md'), '# Первое основание\n', 'utf8');
  writeFileSync(resolve(packageRoot, 'evidence-two.md'), '# Второе основание\n', 'utf8');
  writeFileSync(resolve(root, 'outside.md'), '# Внешний файл\n', 'utf8');
  writeFileSync(resolve(bpmnRoot, 'process.bpmn'), fixtureBpmnXml(), 'utf8');

  const meta = {
    schema: 'business-process-bpmn-package/v1',
    process_id: 'TEST-PROCESS',
    title: 'Тестовый бизнес-процесс',
    variant: 'as-is',
    version: '1.0.0',
    status: 'review-ready',
    canonicality: {
      syntax_status: 'pending',
      profile_status: 'pending',
      business_status: 'pending_human_decision'
    },
    bpmn: {
      file: 'process.bpmn',
      definitions_id: 'Definitions_Test',
      process_element_id: 'Process_Test',
      collaboration_id: 'Collaboration_Test',
      standard: 'BPMN 2.0.2',
      is_executable: false
    },
    engine: null,
    source_card: {
      ref: unsafeSourceRef ? '../../outside.md' : 'processes/test-process/process-card.md',
      sha256: '0'.repeat(64)
    },
    evidence: [
      {
        evidence_id: 'EV-TEST-PROCESS-01',
        ref: 'processes/test-process/evidence-one.md',
        sha256: '1'.repeat(64),
        role: 'Первое основание'
      },
      {
        evidence_id: 'EV-TEST-PROCESS-02',
        ref: '../evidence-two.md',
        sha256: '2'.repeat(64),
        role: 'Второе основание'
      }
    ],
    process_links: [],
    review: {
      owner_role: null,
      human_decision: 'not_recorded',
      questions_file: 'questions.json',
      decisions_file: 'decisions.json'
    }
  };
  const questions = {
    schema: 'business-process-bpmn-questions/v1',
    process_id: 'TEST-PROCESS',
    model_version: '1.0.0',
    questions: [
      {
        question_id: 'Q-TEST-PROCESS-001',
        title: 'Кто подтверждает границы тестового процесса?',
        status: 'open',
        blocking: true,
        owner_role: null,
        source_element_ids: [ 'Process_Test' ]
      },
      {
        question_id: 'Q-TEST-PROCESS-002',
        title: 'Как подтверждается успешный результат?',
        status: 'open',
        blocking: true,
        owner_role: null,
        source_element_ids: [ 'EndEvent_Success' ]
      },
      {
        question_id: 'Q-TEST-PROCESS-003',
        title: 'Нужно ли добавить поясняющий пример?',
        status: 'open',
        blocking: false,
        owner_role: null,
        source_element_ids: [ 'Task_Example' ]
      }
    ]
  };
  const decisions = {
    schema: 'business-process-bpmn-decisions/v1',
    process_id: 'TEST-PROCESS',
    model_version: '1.0.0',
    decisions: []
  };
  writeJson(resolve(bpmnRoot, 'process.meta.json'), meta);
  writeJson(resolve(bpmnRoot, 'questions.json'), questions);
  writeJson(resolve(bpmnRoot, 'decisions.json'), decisions);
  writeJson(resolve(registryRoot, 'processes.json'), {
    schema: 'business-process-bpmn-registry/v1',
    processes: registered ? [ {
      process_id: 'TEST-PROCESS',
      title: 'Тестовый бизнес-процесс',
      status: 'review-ready',
      business_status: 'pending_human_decision',
      bpmn_ref: 'processes/test-process/bpmn/process.bpmn',
      meta_ref: 'processes/test-process/bpmn/process.meta.json',
      navigation_ref: 'processes/test-process/bpmn/derived/process-navigation.html'
    } ] : []
  });
  return {
    root,
    slug,
    bpmnRoot,
    packageRoot,
    metaPath: resolve(bpmnRoot, 'process.meta.json'),
    questionsPath: resolve(bpmnRoot, 'questions.json'),
    decisionsPath: resolve(bpmnRoot, 'decisions.json')
  };
}

function readPackage(fixture) {
  return {
    meta: JSON.parse(readFileSync(fixture.metaPath, 'utf8')),
    questions: JSON.parse(readFileSync(fixture.questionsPath, 'utf8')),
    decisions: JSON.parse(readFileSync(fixture.decisionsPath, 'utf8'))
  };
}

function assertNoTransactionFiles(fixture) {
  const leftovers = readdirSync(fixture.bpmnRoot).filter((name) => /^\..*\.(?:tmp|bak|backup-json)$/u.test(name));
  assert.deepEqual(leftovers, [], `Остались временные файлы транзакции: ${leftovers.join(', ')}`);
}

function runConcurrentStudioWriter(fixture) {
  const bpmnPath = resolve(fixture.bpmnRoot, 'process.bpmn');
  const script = `
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { createStudioCore } = await import(${JSON.stringify(studioCoreUrl)});
    const core = createStudioCore({ projectRoot: ${JSON.stringify(fixture.root)} });
    const xml = readFileSync(${JSON.stringify(bpmnPath)}, 'utf8');
    const expectedSha256 = createHash('sha256').update(xml, 'utf8').digest('hex');
    try {
      await core.saveBpmn(${JSON.stringify(fixture.slug)}, { xml, expectedSha256 });
      console.error('Studio writer unexpectedly entered the project mutation section.');
      process.exitCode = 2;
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, status: error.status }));
      if (error.code !== 'BPMN_BUSY' || error.status !== 409) {
        console.error(error.stack || error.message);
        process.exitCode = 3;
      }
    }
  `;
  const env = { ...process.env };
  delete env[projectMutationLockTokenEnvironment];
  delete env[projectMutationLockOwnerPidEnvironment];
  return spawnSync(process.execPath, [ '--input-type=module', '--eval', script ], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: 10_000
  });
}

function runBorrowedProjectWriter(fixture, {
  token,
  ownerPid,
  expected = 'borrow',
  throughRelay = false
}) {
  const processesRoot = resolve(fixture.root, 'processes');
  const borrowerScript = `
    const { existsSync } = await import('node:fs');
    const { withProjectMutationLock } = await import(${JSON.stringify(operationLockUrl)});
    const processesRoot = ${JSON.stringify(processesRoot)};
    const expected = ${JSON.stringify(expected)};
    try {
      await withProjectMutationLock({ processesRoot }, async () => undefined);
      if (expected === 'busy') {
        console.error('Writer unexpectedly borrowed the project lock.');
        process.exitCode = 2;
      } else {
        let secondCode = null;
        try {
          await withProjectMutationLock({ processesRoot }, async () => undefined);
        } catch (error) {
          secondCode = error.code;
        }
        const lockStillExists = existsSync(${JSON.stringify(canonicalProjectMutationLockPath(processesRoot))});
        console.log(JSON.stringify({ entered: true, second_code: secondCode, lock_still_exists: lockStillExists }));
        if (secondCode !== 'BPMN_BUSY' || !lockStillExists) process.exitCode = 3;
      }
    } catch (error) {
      console.log(JSON.stringify({ entered: false, code: error.code, status: error.status }));
      if (expected !== 'busy' || error.code !== 'BPMN_BUSY' || error.status !== 409) {
        console.error(error.stack || error.message);
        process.exitCode = 4;
      }
    }
  `;
  const env = {
    ...process.env,
    [projectMutationLockTokenEnvironment]: token,
    [projectMutationLockOwnerPidEnvironment]: String(ownerPid)
  };
  if (!throughRelay) {
    return spawnSync(process.execPath, [ '--input-type=module', '--eval', borrowerScript ], {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      timeout: 10_000
    });
  }
  const relayScript = `
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [ '--input-type=module', '--eval', ${JSON.stringify(borrowerScript)} ], {
      cwd: ${JSON.stringify(projectRoot)},
      env: process.env,
      encoding: 'utf8',
      timeout: 10000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exitCode = result.error ? 5 : (result.status ?? 6);
  `;
  return spawnSync(process.execPath, [ '--input-type=module', '--eval', relayScript ], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    timeout: 15_000
  });
}

function runForgedBorrowerRelease(fixture, { token, ownerPid }) {
  const processesRoot = resolve(fixture.root, 'processes');
  const script = `
    const { existsSync } = await import('node:fs');
    const {
      acquireProjectMutationLock,
      canonicalProjectMutationLockPath,
      releaseBpmnOperationLock
    } = await import(${JSON.stringify(operationLockUrl)});
    const processesRoot = ${JSON.stringify(processesRoot)};
    const borrowed = acquireProjectMutationLock(processesRoot);
    delete borrowed.borrowed;
    borrowed.borrowerPid = borrowed.pid;
    releaseBpmnOperationLock(borrowed);
    const lockStillExists = existsSync(canonicalProjectMutationLockPath(processesRoot));
    console.log(JSON.stringify({ lock_still_exists: lockStillExists }));
    if (!lockStillExists) process.exitCode = 2;
  `;
  return spawnSync(process.execPath, [ '--input-type=module', '--eval', script ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      [projectMutationLockTokenEnvironment]: token,
      [projectMutationLockOwnerPidEnvironment]: String(ownerPid)
    },
    encoding: 'utf8',
    timeout: 10_000
  });
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function waitUntil(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (predicate()) return true;
    Atomics.wait(sleeper, 0, 0, 25);
  }
  return predicate();
}

function runCrashedOwnerWithDetachedBorrower(fixture) {
  const processesRoot = resolve(fixture.root, 'processes');
  const readyPath = resolve(fixture.root, 'borrower-ready.json');
  const stopPath = resolve(fixture.root, 'stop-borrower');
  const borrowerScript = `
    const { existsSync, writeFileSync } = await import('node:fs');
    const { acquireProjectMutationLock } = await import(${JSON.stringify(operationLockUrl)});
    acquireProjectMutationLock(${JSON.stringify(processesRoot)});
    writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid }), 'utf8');
    while (!existsSync(${JSON.stringify(stopPath)})) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  `;
  const ownerScript = `
    const { spawn } = await import('node:child_process');
    const { existsSync, readFileSync } = await import('node:fs');
    const { acquireProjectMutationLock } = await import(${JSON.stringify(operationLockUrl)});
    const owner = acquireProjectMutationLock(${JSON.stringify(processesRoot)}, { borrowedClaim: null });
    const borrower = spawn(process.execPath, [ '--input-type=module', '--eval', ${JSON.stringify(borrowerScript)} ], {
      cwd: ${JSON.stringify(projectRoot)},
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ${JSON.stringify(projectMutationLockTokenEnvironment)}: owner.borrowToken,
        ${JSON.stringify(projectMutationLockOwnerPidEnvironment)}: String(owner.pid)
      }
    });
    borrower.unref();
    const deadline = Date.now() + 10000;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(${JSON.stringify(readyPath)}) && Date.now() < deadline) Atomics.wait(sleeper, 0, 0, 25);
    if (!existsSync(${JSON.stringify(readyPath)})) throw new Error('Detached borrower did not become ready.');
    const ready = JSON.parse(readFileSync(${JSON.stringify(readyPath)}, 'utf8'));
    console.log(JSON.stringify({ owner_pid: process.pid, borrower_pid: ready.pid }));
  `;
  const owner = spawnSync(process.execPath, [ '--input-type=module', '--eval', ownerScript ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15_000
  });
  return { owner, readyPath, stopPath, processesRoot };
}

function record(fixture, overrides = {}) {
  let updateCalls = 0;
  const result = recordOwnerDecision({
    projectRoot: fixture.root,
    slug: fixture.slug,
    outcome: 'approve',
    ownerRole: 'Владелец тестового процесса',
    comment: 'Текущая версия проверена и подтверждена.',
    answers: {
      'Q-TEST-PROCESS-001': 'Границы подтверждает владелец тестового процесса.',
      'Q-TEST-PROCESS-002': 'Результат подтверждается записью в учётной системе.'
    },
    now: new Date('2026-08-20T10:20:30.000Z'),
    updateRunner: ({ slug, prepared }) => {
      updateCalls += 1;
      assert.equal(slug, fixture.slug);
      assert.equal(prepared.meta.review.owner_role, 'Владелец тестового процесса');
    },
    ...overrides
  });
  return { result, updateCalls };
}

if (tempRoot !== resolve(projectRoot, 'temp', 'record-owner-decision-test') || !tempRoot.startsWith(`${resolve(projectRoot, 'temp')}${sep}`)) {
  throw new Error('Небезопасный путь временной проверки мастера решений.');
}

rmSync(tempRoot, { recursive: true, force: true });
try {
  assert.deepEqual(parseArguments([ '--slug', 'test-process' ]), { slug: 'test-process', help: false });
  assert.deepEqual(parseArguments([ '--help' ]), { slug: undefined, help: true });
  assert.throws(() => parseArguments([ '--unknown' ]), /Неизвестный параметр/u);
  assert.throws(() => validateSlug('../escape'), /Короткое имя/u);

  const approvedFixture = createFixture('approved');
  const approved = record(approvedFixture);
  assert.equal(approved.updateCalls, 1);
  const approvedFiles = readPackage(approvedFixture);
  assert.equal(approvedFiles.meta.status, 'approved');
  assert.equal(approvedFiles.meta.canonicality.syntax_status, 'validated');
  assert.equal(approvedFiles.meta.canonicality.profile_status, 'validated');
  assert.equal(approvedFiles.meta.canonicality.business_status, 'canonical');
  assert.equal(approvedFiles.meta.review.human_decision, 'approved');
  assert.equal(approvedFiles.meta.review.owner_role, 'Владелец тестового процесса');
  const answered = approvedFiles.questions.questions.filter((question) => question.blocking);
  assert(answered.every((question) => question.status === 'answered'));
  assert(answered.every((question) => question.answer && question.answered_by && question.answered_at));
  assert.equal(approvedFiles.questions.questions[2].status, 'open');
  assert.equal(approvedFiles.decisions.decisions.length, 1);
  const approval = approvedFiles.decisions.decisions[0];
  assert.equal(approval.question_id, null);
  assert.equal(approval.outcome, 'approve');
  assert.equal(approval.comment, 'Текущая версия проверена и подтверждена.');
  assert.equal(approval.bpmn_sha256, sha256(resolve(approvedFixture.bpmnRoot, 'process.bpmn')));
  assert.equal(approval.source_card_sha256, sha256(resolve(approvedFixture.packageRoot, 'process-card.md')));
  assert.deepEqual(approval.evidence_sha256, [
    sha256(resolve(approvedFixture.packageRoot, 'evidence-one.md')),
    sha256(resolve(approvedFixture.packageRoot, 'evidence-two.md'))
  ]);
  assert.equal(approval.source_card_sha256, approvedFiles.meta.source_card.sha256);
  assert.deepEqual(approval.evidence_sha256, approvedFiles.meta.evidence.map((item) => item.sha256));
  assertNoTransactionFiles(approvedFixture);

  const concurrentFixture = createFixture('concurrent-studio-writer');
  let concurrentUpdateCalls = 0;
  let issuedBorrowClaim;
  record(concurrentFixture, {
    updateRunner: ({ projectMutationLockToken, projectMutationLockOwnerPid }) => {
      concurrentUpdateCalls += 1;
      issuedBorrowClaim = { token: projectMutationLockToken, ownerPid: projectMutationLockOwnerPid };
      assert.match(projectMutationLockToken, /^[a-f0-9]{32}$/u);
      assert.equal(projectMutationLockOwnerPid, process.pid);
      const lockPath = canonicalProjectMutationLockPath(resolve(concurrentFixture.root, 'processes'));
      const ownerLock = readFileSync(lockPath, 'utf8');

      const writer = runConcurrentStudioWriter(concurrentFixture);
      assert.equal(writer.error, undefined, writer.error?.message);
      assert.equal(writer.status, 0, `stdout=${writer.stdout}\nstderr=${writer.stderr}`);
      assert.deepEqual(JSON.parse(writer.stdout.trim()), { code: 'BPMN_BUSY', status: 409 });

      const wrongToken = runBorrowedProjectWriter(concurrentFixture, {
        token: '0'.repeat(32),
        ownerPid: projectMutationLockOwnerPid,
        expected: 'busy'
      });
      assert.equal(wrongToken.error, undefined, wrongToken.error?.message);
      assert.equal(wrongToken.status, 0, `stdout=${wrongToken.stdout}\nstderr=${wrongToken.stderr}`);
      assert.deepEqual(JSON.parse(wrongToken.stdout.trim()), { entered: false, code: 'BPMN_BUSY', status: 409 });

      const wrongOwner = runBorrowedProjectWriter(concurrentFixture, {
        token: projectMutationLockToken,
        ownerPid: projectMutationLockOwnerPid + 1,
        expected: 'busy'
      });
      assert.equal(wrongOwner.error, undefined, wrongOwner.error?.message);
      assert.equal(wrongOwner.status, 0, `stdout=${wrongOwner.stdout}\nstderr=${wrongOwner.stderr}`);
      assert.deepEqual(JSON.parse(wrongOwner.stdout.trim()), { entered: false, code: 'BPMN_BUSY', status: 409 });

      const wrongParent = runBorrowedProjectWriter(concurrentFixture, {
        token: projectMutationLockToken,
        ownerPid: projectMutationLockOwnerPid,
        expected: 'busy',
        throughRelay: true
      });
      assert.equal(wrongParent.error, undefined, wrongParent.error?.message);
      assert.equal(wrongParent.status, 0, `stdout=${wrongParent.stdout}\nstderr=${wrongParent.stderr}`);
      assert.deepEqual(JSON.parse(wrongParent.stdout.trim()), { entered: false, code: 'BPMN_BUSY', status: 409 });

      assert.throws(
        () => acquireProjectMutationLock(resolve(concurrentFixture.root, 'processes'), {
          borrowedClaim: { token: projectMutationLockToken, ownerPid: projectMutationLockOwnerPid }
        }),
        (error) => error?.code === 'BPMN_BUSY',
        'Тот же PID не должен получать повторный вход даже с правильным token'
      );

      const forgedBorrower = runForgedBorrowerRelease(concurrentFixture, {
        token: projectMutationLockToken,
        ownerPid: projectMutationLockOwnerPid
      });
      assert.equal(forgedBorrower.error, undefined, forgedBorrower.error?.message);
      assert.equal(forgedBorrower.status, 0, `stdout=${forgedBorrower.stdout}\nstderr=${forgedBorrower.stderr}`);
      assert.deepEqual(JSON.parse(forgedBorrower.stdout.trim()), { lock_still_exists: true });
      assert.equal(existsSync(lockPath), true);
      assert.equal(readFileSync(lockPath, 'utf8'), ownerLock, 'Borrower не должен удалять или переписывать lock владельца');

      const siblingReuse = runBorrowedProjectWriter(concurrentFixture, {
        token: projectMutationLockToken,
        ownerPid: projectMutationLockOwnerPid,
        expected: 'busy'
      });
      assert.equal(siblingReuse.error, undefined, siblingReuse.error?.message);
      assert.equal(siblingReuse.status, 0, `stdout=${siblingReuse.stdout}\nstderr=${siblingReuse.stderr}`);
      assert.deepEqual(JSON.parse(siblingReuse.stdout.trim()), { entered: false, code: 'BPMN_BUSY', status: 409 });
    }
  });
  assert.equal(concurrentUpdateCalls, 1);
  assertNoTransactionFiles(concurrentFixture);

  const staleBorrow = runBorrowedProjectWriter(concurrentFixture, {
    ...issuedBorrowClaim,
    expected: 'busy'
  });
  assert.equal(staleBorrow.error, undefined, staleBorrow.error?.message);
  assert.equal(staleBorrow.status, 0, `stdout=${staleBorrow.stdout}\nstderr=${staleBorrow.stderr}`);
  assert.deepEqual(JSON.parse(staleBorrow.stdout.trim()), { entered: false, code: 'BPMN_BUSY', status: 409 });
  assert.deepEqual(
    readdirSync(resolve(concurrentFixture.root, 'processes')).filter((name) => name.startsWith('.bpmn-project-mutation.lock')),
    [],
    'После owner release не должны оставаться общий lock или одноразовый claim'
  );

  const ownerCrashFixture = createFixture('owner-crash-live-borrower');
  const crashed = runCrashedOwnerWithDetachedBorrower(ownerCrashFixture);
  assert.equal(crashed.owner.error, undefined, crashed.owner.error?.message);
  assert.equal(crashed.owner.status, 0, `stdout=${crashed.owner.stdout}\nstderr=${crashed.owner.stderr}`);
  const crashedPids = JSON.parse(crashed.owner.stdout.trim());
  assert.equal(isPidRunning(crashedPids.owner_pid), false, 'Owner должен завершиться до проверки stale recovery');
  assert.equal(isPidRunning(crashedPids.borrower_pid), true, 'Detached borrower должен оставаться живым');

  let liveBorrowerError = null;
  let unexpectedContenderLock = null;
  try {
    unexpectedContenderLock = acquireProjectMutationLock(crashed.processesRoot, { borrowedClaim: null });
  } catch (error) {
    liveBorrowerError = error;
  } finally {
    writeFileSync(crashed.stopPath, 'stop\n', 'utf8');
    assert.equal(waitUntil(() => !isPidRunning(crashedPids.borrower_pid)), true, 'Detached borrower не завершился по stop-сигналу');
  }
  if (unexpectedContenderLock) releaseBpmnOperationLock(unexpectedContenderLock);
  assert.equal(unexpectedContenderLock, null, 'Stale recovery не должен обходить живой borrowed update');
  assert.equal(liveBorrowerError?.code, 'BPMN_BUSY');

  const recoveredAfterBorrowerExit = acquireProjectMutationLock(crashed.processesRoot, { borrowedClaim: null });
  releaseBpmnOperationLock(recoveredAfterBorrowerExit);
  assert.deepEqual(
    readdirSync(crashed.processesRoot).filter((name) => name.startsWith('.bpmn-project-mutation.lock')),
    [],
    'После доказанной смерти borrower stale lock и claim должны быть безопасно очищены'
  );

  const reworkFixture = createFixture('rework');
  const reworked = record(reworkFixture, {
    outcome: 'rework',
    answers: {},
    comment: 'Нужно уточнить исключения и повторно показать владельцу.'
  });
  assert.equal(reworked.updateCalls, 1);
  const reworkedFiles = readPackage(reworkFixture);
  assert.equal(reworkedFiles.meta.status, 'rework');
  assert.equal(reworkedFiles.meta.canonicality.business_status, 'pending_human_decision');
  assert.equal(reworkedFiles.meta.review.human_decision, 'rework');
  assert.equal(reworkedFiles.meta.canonicality.syntax_status, 'pending');
  assert(reworkedFiles.questions.questions.every((question) => question.status === 'open'));
  assert.equal(reworkedFiles.decisions.decisions[0].outcome, 'rework');
  assertNoTransactionFiles(reworkFixture);

  const rejectedFixture = createFixture('rejected');
  const rejected = record(rejectedFixture, {
    outcome: 'reject',
    answers: {},
    comment: 'Текущая версия не соответствует установленному порядку.'
  });
  assert.equal(rejected.updateCalls, 1);
  const rejectedFiles = readPackage(rejectedFixture);
  assert.equal(rejectedFiles.meta.status, 'rejected');
  assert.equal(rejectedFiles.meta.canonicality.business_status, 'rejected');
  assert.equal(rejectedFiles.meta.review.human_decision, 'rejected');
  assert.equal(rejectedFiles.meta.canonicality.profile_status, 'pending');
  assert.equal(rejectedFiles.decisions.decisions[0].outcome, 'reject');
  assertNoTransactionFiles(rejectedFixture);

  const missingAnswerFixture = createFixture('missing-answer');
  const missingAnswerOriginal = [
    readFileSync(missingAnswerFixture.metaPath),
    readFileSync(missingAnswerFixture.questionsPath),
    readFileSync(missingAnswerFixture.decisionsPath)
  ];
  assert.throws(() => record(missingAnswerFixture, {
    answers: { 'Q-TEST-PROCESS-001': 'Ответ есть только на один вопрос.' }
  }), /Ответ на вопрос/u);
  assert(readFileSync(missingAnswerFixture.metaPath).equals(missingAnswerOriginal[0]));
  assert(readFileSync(missingAnswerFixture.questionsPath).equals(missingAnswerOriginal[1]));
  assert(readFileSync(missingAnswerFixture.decisionsPath).equals(missingAnswerOriginal[2]));
  assertNoTransactionFiles(missingAnswerFixture);

  const blankCommentFixture = createFixture('blank-comment');
  assert.throws(() => record(blankCommentFixture, { comment: ' ' }), /Комментарий/u);
  assertNoTransactionFiles(blankCommentFixture);

  const rollbackFixture = createFixture('rollback');
  const rollbackOriginal = [
    readFileSync(rollbackFixture.metaPath),
    readFileSync(rollbackFixture.questionsPath),
    readFileSync(rollbackFixture.decisionsPath)
  ];
  assert.throws(() => record(rollbackFixture, {
    updateRunner: () => { throw new Error('Искусственная ошибка технического обновления'); }
  }), /полностью отменены/u);
  assert(readFileSync(rollbackFixture.metaPath).equals(rollbackOriginal[0]));
  assert(readFileSync(rollbackFixture.questionsPath).equals(rollbackOriginal[1]));
  assert(readFileSync(rollbackFixture.decisionsPath).equals(rollbackOriginal[2]));
  assertNoTransactionFiles(rollbackFixture);

  const unregisteredFixture = createFixture('unregistered', { registered: false });
  assert.throws(() => loadRegisteredProcess(unregisteredFixture.root, unregisteredFixture.slug), /ещё не зарегистрирован/u);

  const traversalFixture = createFixture('traversal', { unsafeSourceRef: true });
  assert.throws(() => loadRegisteredProcess(traversalFixture.root, traversalFixture.slug), /выходит за пределы пакета/u);

  console.log(JSON.stringify({
    status: 'passed',
    outcomes: [ 'approve', 'rework', 'reject' ],
    approval_requires_all_blocking_answers: true,
    exact_source_hashes_recorded: true,
    unregistered_and_path_traversal_rejected: true,
    three_file_rollback_verified: true,
    full_transaction_project_lock_verified: true,
    one_time_child_borrow_contract_verified: true,
    stale_claim_cannot_create_new_lock: true,
    forged_borrower_handle_cannot_release_owner_lock: true
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

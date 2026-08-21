import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  acquireProjectMutationLock,
  canonicalProjectMutationLockPath,
  releaseBpmnOperationLock,
} from './bpmn-operation-lock.mjs';
import { registerProcess } from './register-process.mjs';
import { createStudioCore } from './studio-core.mjs';
import { updateProcess } from './update-process.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const processesRoot = resolve(projectRoot, 'processes');
const studio = createStudioCore({ projectRoot });
const current = studio.readProcess('skupka-zolota');
const lock = acquireProjectMutationLock(processesRoot);

try {
  assert.equal(
    lock.path,
    canonicalProjectMutationLockPath(processesRoot),
    'Общая блокировка должна иметь один постоянный путь для всех процессов',
  );
  assert.throws(
    () => acquireProjectMutationLock(processesRoot),
    (error) => error?.code === 'BPMN_BUSY',
    'Вторая общая транзакция не должна запускаться параллельно',
  );
  await assert.rejects(
    studio.saveBpmn('skupka-zolota', {
      xml: current.xml,
      expectedSha256: current.sha256,
    }),
    (error) => error?.code === 'BPMN_BUSY',
    'Studio должна учитывать общую блокировку проекта',
  );
  await assert.rejects(
    registerProcess('missing-process'),
    (error) => error?.code === 'BPMN_BUSY',
    'Прямой мастер регистрации должен сам брать общую блокировку',
  );
  await assert.rejects(
    updateProcess('missing-process'),
    (error) => error?.code === 'BPMN_BUSY',
    'Прямой мастер обновления должен сам брать общую блокировку',
  );
} finally {
  releaseBpmnOperationLock(lock);
}

console.log('Global project mutation lock: PASS');

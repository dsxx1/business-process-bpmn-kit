import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const lockTokenPattern = /^[a-f0-9]{32}$/u;
const projectMutationLockTokenEnvironment = 'BPMN_PROJECT_MUTATION_LOCK_TOKEN';
const projectMutationLockOwnerPidEnvironment = 'BPMN_PROJECT_MUTATION_LOCK_OWNER_PID';

class BpmnOperationLockError extends Error {
  constructor(code, message, status = 409, details = undefined) {
    super(message);
    this.name = 'BpmnOperationLockError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function lockError(code, message, status = 409, details = undefined) {
  return new BpmnOperationLockError(code, message, status, details);
}

function canonicalLockPath(processesRoot, slug) {
  if (!slugPattern.test(String(slug))) {
    throw lockError('INVALID_LOCK_SLUG', 'Небезопасное короткое имя для блокировки процесса.', 400);
  }
  const canonicalRoot = realpathSync.native(resolve(processesRoot));
  const rootEntry = lstatSync(canonicalRoot);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw lockError('UNSAFE_LOCK_ROOT', 'Каталог блокировок процессов имеет небезопасный тип.', 400);
  }
  const path = resolve(canonicalRoot, `.bpmn-operation-${slug}.lock`);
  const relation = relative(canonicalRoot, path);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw lockError('UNSAFE_LOCK_PATH', 'Файл блокировки выходит за пределы каталога процессов.', 400);
  }
  return path;
}

function canonicalProjectMutationLockPath(processesRoot) {
  const canonicalRoot = realpathSync.native(resolve(processesRoot));
  const rootEntry = lstatSync(canonicalRoot);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw lockError('UNSAFE_LOCK_ROOT', 'Каталог общей блокировки проекта имеет небезопасный тип.', 400);
  }
  const path = resolve(canonicalRoot, '.bpmn-project-mutation.lock');
  const relation = relative(canonicalRoot, path);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw lockError('UNSAFE_LOCK_PATH', 'Файл общей блокировки выходит за пределы каталога процессов.', 400);
  }
  return path;
}

function readLock(path) {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw lockError('UNSAFE_LOCK', 'Файл блокировки процесса имеет небезопасный тип.', 409);
    }
    const document = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !Number.isSafeInteger(document.pid)
      || document.pid <= 0
      || !lockTokenPattern.test(document.token || '')
      || (document.borrow_nonce !== undefined && !lockTokenPattern.test(document.borrow_nonce || ''))
    ) {
      throw lockError('INVALID_LOCK', 'Файл блокировки процесса повреждён; проверьте его вручную.', 409);
    }
    return document;
  } catch (error) {
    if (error instanceof BpmnOperationLockError) throw error;
    throw lockError('INVALID_LOCK', 'Файл блокировки процесса не удалось безопасно прочитать.', 409);
  }
}

function canonicalBorrowClaimPath(lockPath, borrowNonce) {
  if (!lockTokenPattern.test(String(borrowNonce || ''))) {
    throw lockError('INVALID_BORROW_CLAIM', 'Одноразовый ключ дочерней операции имеет небезопасный формат.', 409);
  }
  const root = dirname(lockPath);
  const path = resolve(root, `${basename(lockPath)}.borrow-${borrowNonce}.claim`);
  const relation = relative(root, path);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw lockError('UNSAFE_LOCK_PATH', 'Файл одноразового допуска выходит за пределы каталога процессов.', 400);
  }
  return path;
}

function readBorrowClaim(path) {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw lockError('UNSAFE_BORROW_CLAIM', 'Файл одноразового допуска имеет небезопасный тип.', 409);
    }
    const document = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !Number.isSafeInteger(document.owner_pid)
      || document.owner_pid <= 0
      || !Number.isSafeInteger(document.borrower_pid)
      || document.borrower_pid <= 0
      || !lockTokenPattern.test(document.owner_token || '')
      || !lockTokenPattern.test(document.borrow_nonce || '')
      || !lockTokenPattern.test(document.claim_token || '')
    ) {
      throw lockError('INVALID_BORROW_CLAIM', 'Файл одноразового допуска повреждён; проверьте его вручную.', 409);
    }
    return document;
  } catch (error) {
    if (error instanceof BpmnOperationLockError) throw error;
    throw lockError('INVALID_BORROW_CLAIM', 'Файл одноразового допуска не удалось безопасно прочитать.', 409);
  }
}

function borrowBusy(message, ownerPid = undefined) {
  return lockError('BPMN_BUSY', message, 409, ownerPid === undefined ? undefined : { owner_pid: ownerPid });
}

function createBorrowClaim(lockPath, current) {
  const path = canonicalBorrowClaimPath(lockPath, current.borrow_nonce);
  const claimToken = randomBytes(16).toString('hex');
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw borrowBusy('Одноразовый допуск дочерней операции уже использован.', current.pid);
    }
    throw lockError('BORROW_CLAIM_CREATE_FAILED', `Не удалось зафиксировать одноразовый допуск: ${error.message}`, 500);
  }

  try {
    writeFileSync(descriptor, JSON.stringify({
      schema: 'business-process-bpmn-borrow-claim/v1',
      owner_pid: current.pid,
      owner_token: current.token,
      borrow_nonce: current.borrow_nonce,
      borrower_pid: process.pid,
      claim_token: claimToken,
      created_at: new Date().toISOString()
    }), 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return { path, claimToken };
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Дескриптор уже закрыт. */ }
    }
    try { rmSync(path, { force: true }); } catch { /* Ошибка записи остаётся основной. */ }
    throw lockError('BORROW_CLAIM_CREATE_FAILED', `Не удалось записать одноразовый допуск: ${error.message}`, 500);
  }
}

function removeBorrowClaimOwnedByBorrower(claim) {
  if (!claim || !existsSync(claim.path)) return;
  try {
    const current = readBorrowClaim(claim.path);
    if (current.borrower_pid === process.pid && current.claim_token === claim.claimToken) rmSync(claim.path);
  } catch { /* Чужой или повреждённый claim не удаляем. */ }
}

function cleanupBorrowClaimAfterOwnerRelease(lockPath, owner) {
  if (!owner.borrow_nonce) return;
  const path = canonicalBorrowClaimPath(lockPath, owner.borrow_nonce);
  if (!existsSync(path)) return;
  const claim = readBorrowClaim(path);
  if (
    claim.owner_pid !== owner.pid
    || claim.owner_token !== owner.token
    || claim.borrow_nonce !== owner.borrow_nonce
  ) {
    throw lockError('BORROW_CLAIM_OWNERSHIP_LOST', 'Нельзя удалить одноразовый допуск другой операции.', 500);
  }
  rmSync(path);
}

function claimMatchesOwner(claim, owner) {
  return claim.owner_pid === owner.pid
    && claim.owner_token === owner.token
    && claim.borrow_nonce === owner.borrow_nonce;
}

function createStaleRecoveryClaimGuard(lockPath, owner) {
  const path = canonicalBorrowClaimPath(lockPath, owner.borrow_nonce);
  const claimToken = randomBytes(16).toString('hex');
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw lockError('BORROW_CLAIM_CREATE_FAILED', `Не удалось заблокировать stale recovery: ${error.message}`, 500);
  }
  try {
    writeFileSync(descriptor, JSON.stringify({
      schema: 'business-process-bpmn-borrow-claim/v1',
      owner_pid: owner.pid,
      owner_token: owner.token,
      borrow_nonce: owner.borrow_nonce,
      borrower_pid: process.pid,
      claim_token: claimToken,
      recovery_guard: true,
      created_at: new Date().toISOString()
    }), 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return { path, claimToken, owner };
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Дескриптор уже закрыт. */ }
    }
    try { rmSync(path, { force: true }); } catch { /* Ошибка записи остаётся основной. */ }
    throw lockError('BORROW_CLAIM_CREATE_FAILED', `Не удалось записать guard stale recovery: ${error.message}`, 500);
  }
}

function removeStaleRecoveryClaimGuard(guard) {
  if (!guard || !existsSync(guard.path)) return;
  const current = readBorrowClaim(guard.path);
  if (
    !claimMatchesOwner(current, guard.owner)
    || current.borrower_pid !== process.pid
    || current.claim_token !== guard.claimToken
    || current.recovery_guard !== true
  ) {
    throw lockError('BORROW_CLAIM_OWNERSHIP_LOST', 'Guard stale recovery изменён другой операцией.', 500);
  }
  rmSync(guard.path);
}

function removeProvenDeadBorrowClaim(path, claim) {
  const stalePath = `${path}.stale.${process.pid}.${randomBytes(8).toString('hex')}`;
  try {
    renameSync(path, stalePath);
    const moved = readBorrowClaim(stalePath);
    if (
      moved.owner_pid !== claim.owner_pid
      || moved.owner_token !== claim.owner_token
      || moved.borrow_nonce !== claim.borrow_nonce
      || moved.borrower_pid !== claim.borrower_pid
      || moved.claim_token !== claim.claim_token
    ) {
      throw lockError('BPMN_BUSY', 'Claim изменился во время безопасного восстановления.', 409);
    }
    if (isProcessRunning(moved.borrower_pid)) {
      throw borrowBusy('Дочернее обновление ещё выполняется; stale recovery остановлен.', moved.owner_pid);
    }
    rmSync(stalePath);
  } catch (error) {
    if (existsSync(stalePath)) {
      try {
        if (!existsSync(path)) renameSync(stalePath, path);
      } catch { /* Claim сохраняется, если восстановление невозможно. */ }
    }
    if (error instanceof BpmnOperationLockError) throw error;
    throw lockError('BPMN_BUSY', 'Claim мёртвого дочернего процесса не удалось безопасно очистить.', 409);
  }
}

function prepareStaleRecoveryClaimGuard(lockPath, owner) {
  if (!owner.borrow_nonce) return null;
  const path = canonicalBorrowClaimPath(lockPath, owner.borrow_nonce);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const guard = createStaleRecoveryClaimGuard(lockPath, owner);
    if (guard) return guard;

    const claim = readBorrowClaim(path);
    if (!claimMatchesOwner(claim, owner)) {
      throw lockError('BORROW_CLAIM_OWNERSHIP_LOST', 'Claim не принадлежит восстанавливаемой общей блокировке.', 409);
    }
    if (isProcessRunning(claim.borrower_pid)) {
      throw borrowBusy('Дочернее обновление ещё выполняется; stale recovery остановлен.', owner.pid);
    }
    removeProvenDeadBorrowClaim(path, claim);
  }
  throw lockError('BPMN_BUSY', 'Claim изменяется другой операцией; stale recovery остановлен.', 409);
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

function acquireOperationLock(path, busyMessage, { borrowable = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomBytes(16).toString('hex');
    const borrowToken = borrowable ? randomBytes(16).toString('hex') : null;
    let descriptor;
    try {
      descriptor = openSync(path, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw lockError('LOCK_CREATE_FAILED', `Не удалось заблокировать пакет процесса: ${error.message}`, 500);
      }
      const current = readLock(path);
      if (isProcessRunning(current.pid)) {
        throw lockError(
          'BPMN_BUSY',
          busyMessage,
          409,
          { owner_pid: current.pid }
        );
      }
      const stalePath = `${path}.stale.${process.pid}.${randomBytes(8).toString('hex')}`;
      let recoveryGuard;
      try {
        recoveryGuard = prepareStaleRecoveryClaimGuard(path, current);
        renameSync(path, stalePath);
        const moved = readLock(stalePath);
        if (
          moved.pid !== current.pid
          || moved.token !== current.token
          || moved.borrow_nonce !== current.borrow_nonce
        ) {
          throw lockError('BPMN_BUSY', 'Блокировка процесса изменилась во время безопасного восстановления.', 409);
        }
        rmSync(stalePath);
        removeStaleRecoveryClaimGuard(recoveryGuard);
        recoveryGuard = undefined;
      } catch (staleError) {
        if (existsSync(stalePath)) {
          try {
            if (!existsSync(path)) renameSync(stalePath, path);
          } catch { /* Сохраняем блокировку, если восстановление невозможно. */ }
        }
        if (recoveryGuard) {
          try { removeStaleRecoveryClaimGuard(recoveryGuard); } catch { /* Чужой или повреждённый guard не удаляем. */ }
        }
        if (staleError instanceof BpmnOperationLockError) throw staleError;
        throw lockError('BPMN_BUSY', 'Устаревшую блокировку процесса не удалось безопасно снять.', 409);
      }
      continue;
    }

    try {
      const document = {
        schema: 'business-process-bpmn-operation-lock/v1',
        pid: process.pid,
        token,
        created_at: new Date().toISOString()
      };
      if (borrowToken) document.borrow_nonce = borrowToken;
      writeFileSync(descriptor, JSON.stringify(document), 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      return {
        path,
        token,
        pid: process.pid,
        ...(borrowToken ? { borrowToken } : {})
      };
    } catch (error) {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch { /* Дескриптор уже закрыт. */ }
      }
      try { rmSync(path, { force: true }); } catch { /* Ошибка записи остаётся основной. */ }
      throw lockError('LOCK_CREATE_FAILED', `Не удалось записать блокировку пакета процесса: ${error.message}`, 500);
    }
  }
  throw lockError('BPMN_BUSY', 'Пакет процесса занят другой операцией.', 409);
}

function acquireBpmnOperationLock(processesRoot, slug) {
  return acquireOperationLock(
    canonicalLockPath(processesRoot, slug),
    'Пакет процесса уже изменяется в Studio или другом MCP-процессе. Повторите операцию после завершения текущей записи.',
  );
}

function consumeInheritedProjectMutationLockClaim() {
  const supplied = Object.prototype.hasOwnProperty.call(process.env, projectMutationLockTokenEnvironment)
    || Object.prototype.hasOwnProperty.call(process.env, projectMutationLockOwnerPidEnvironment);
  const token = process.env[projectMutationLockTokenEnvironment];
  const ownerPidText = process.env[projectMutationLockOwnerPidEnvironment];
  delete process.env[projectMutationLockTokenEnvironment];
  delete process.env[projectMutationLockOwnerPidEnvironment];
  return {
    supplied,
    claim: { token, ownerPid: Number(ownerPidText) }
  };
}

function borrowProjectMutationLock(path, busyMessage, borrowedClaim) {
  const claimToken = borrowedClaim?.token;
  const claimOwnerPid = borrowedClaim?.ownerPid;
  if (
    !lockTokenPattern.test(claimToken || '')
    || !Number.isSafeInteger(claimOwnerPid)
    || claimOwnerPid <= 0
  ) {
    throw borrowBusy(busyMessage);
  }

  let current;
  try {
    current = readLock(path);
  } catch (error) {
    if (!existsSync(path)) throw borrowBusy('Одноразовый допуск дочерней операции истёк.');
    throw error;
  }
  if (
    current.borrow_nonce !== claimToken
    || current.pid !== claimOwnerPid
    || current.pid === process.pid
    || process.ppid !== current.pid
    || !isProcessRunning(current.pid)
  ) {
    throw borrowBusy(busyMessage, current.pid);
  }

  const claim = createBorrowClaim(path, current);
  try {
    const verified = readLock(path);
    if (
      verified.pid !== current.pid
      || verified.token !== current.token
      || verified.borrow_nonce !== current.borrow_nonce
      || process.ppid !== verified.pid
      || !isProcessRunning(verified.pid)
    ) {
      throw borrowBusy('Общая блокировка изменилась во время выдачи одноразового допуска.', verified.pid);
    }
  } catch (error) {
    removeBorrowClaimOwnedByBorrower(claim);
    if (!existsSync(path)) throw borrowBusy('Одноразовый допуск дочерней операции истёк.');
    throw error;
  }

  return {
    path,
    token: current.token,
    pid: current.pid,
    borrowToken: current.borrow_nonce,
    borrowed: true,
    borrowerPid: process.pid,
    claimPath: claim.path,
    claimToken: claim.claimToken
  };
}

function acquireProjectMutationLock(processesRoot, options = {}) {
  const path = canonicalProjectMutationLockPath(processesRoot);
  const busyMessage = 'Другой процесс сейчас изменяет общий реестр, каталог или навигацию. Повторите операцию после завершения текущей записи.';
  const explicitClaim = Object.prototype.hasOwnProperty.call(options, 'borrowedClaim')
    && options.borrowedClaim !== undefined;
  const inherited = explicitClaim
    ? { supplied: options.borrowedClaim !== null, claim: options.borrowedClaim }
    : consumeInheritedProjectMutationLockClaim();
  if (inherited.supplied) return borrowProjectMutationLock(path, busyMessage, inherited.claim);
  return acquireOperationLock(path, busyMessage, { borrowable: true });
}

function releaseBpmnOperationLock(lock) {
  if (!existsSync(lock.path)) {
    throw lockError('LOCK_OWNERSHIP_LOST', 'Файл блокировки процесса исчез до завершения операции.', 500);
  }
  const current = readLock(lock.path);
  if (current.pid === process.pid) {
    if (lock.pid !== process.pid || current.token !== lock.token) {
      throw lockError('LOCK_OWNERSHIP_LOST', 'Не удалось безопасно снять чужую блокировку процесса.', 500);
    }
    rmSync(lock.path);
    cleanupBorrowClaimAfterOwnerRelease(lock.path, current);
    return;
  }

  const expectedClaimPath = current.borrow_nonce
    ? canonicalBorrowClaimPath(lock.path, current.borrow_nonce)
    : null;
  if (
    process.ppid !== current.pid
    || lock.pid !== current.pid
    || lock.token !== current.token
    || lock.borrowToken !== current.borrow_nonce
    || !expectedClaimPath
    || lock.claimPath !== expectedClaimPath
  ) {
    throw lockError('LOCK_OWNERSHIP_LOST', 'Дочерняя операция не владеет общей блокировкой проекта.', 500);
  }
  const claim = readBorrowClaim(expectedClaimPath);
  if (
    claim.owner_pid !== current.pid
    || claim.owner_token !== current.token
    || claim.borrow_nonce !== current.borrow_nonce
    || claim.borrower_pid !== process.pid
    || claim.claim_token !== lock.claimToken
  ) {
    throw lockError('LOCK_OWNERSHIP_LOST', 'Одноразовый допуск принадлежит другой дочерней операции.', 500);
  }
}

async function withBpmnOperationLock({ processesRoot, slug }, operation) {
  const lock = acquireBpmnOperationLock(processesRoot, slug);
  try {
    return await operation();
  } finally {
    releaseBpmnOperationLock(lock);
  }
}

async function withProjectMutationLock(options, operation) {
  const acquireOptions = {};
  if (Object.prototype.hasOwnProperty.call(options, 'borrowedClaim')) {
    acquireOptions.borrowedClaim = options.borrowedClaim;
  }
  const lock = acquireProjectMutationLock(options.processesRoot, acquireOptions);
  try {
    return await operation();
  } finally {
    releaseBpmnOperationLock(lock);
  }
}

export {
  BpmnOperationLockError,
  acquireBpmnOperationLock,
  acquireProjectMutationLock,
  canonicalLockPath,
  canonicalProjectMutationLockPath,
  projectMutationLockOwnerPidEnvironment,
  projectMutationLockTokenEnvironment,
  releaseBpmnOperationLock,
  withBpmnOperationLock,
  withProjectMutationLock
};

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function portableProjectRef(projectRoot, path, label) {
  const ref = relative(projectRoot, path);
  if (!ref || ref === '..' || ref.startsWith(`..${sep}`) || isAbsolute(ref)) {
    throw new Error(`${label} leaves the project root: ${path}`);
  }
  return ref.split(sep).join('/');
}

function assertEqual(field, actual, expected, processId) {
  if (actual !== expected) {
    throw new Error(`Registry ${field} mismatch for ${processId}: expected ${expected}, got ${actual}`);
  }
}

export function assertRegistryEntryMatchesPackage({ projectRoot, entry, metaPath, meta }) {
  const packageRoot = dirname(metaPath);
  const expectedMetaRef = portableProjectRef(projectRoot, metaPath, 'Registry meta_ref');
  const expectedBpmnRef = portableProjectRef(projectRoot, resolve(packageRoot, meta.bpmn.file), 'Registry bpmn_ref');
  const expectedNavigationRef = portableProjectRef(
    projectRoot,
    resolve(packageRoot, 'derived', 'process-navigation.html'),
    'Registry navigation_ref'
  );

  assertEqual('meta_ref', entry.meta_ref, expectedMetaRef, entry.process_id);
  assertEqual('process_id', entry.process_id, meta.process_id, entry.process_id);
  assertEqual('title', entry.title, meta.title, entry.process_id);
  assertEqual('status', entry.status, meta.status, entry.process_id);
  assertEqual('business_status', entry.business_status, meta.canonicality.business_status, entry.process_id);
  assertEqual('bpmn_ref', entry.bpmn_ref, expectedBpmnRef, entry.process_id);
  assertEqual('navigation_ref', entry.navigation_ref, expectedNavigationRef, entry.process_id);
}

export function assertUnregisteredPackageIsDraft({ metaPath, meta }) {
  if (meta.status !== 'draft') {
    throw new Error(
      `Незарегистрированный пакет ${meta.process_id} (${metaPath}) имеет статус ${meta.status}; ` +
      'перед переводом из черновика добавьте его в registry/processes.json'
    );
  }
}

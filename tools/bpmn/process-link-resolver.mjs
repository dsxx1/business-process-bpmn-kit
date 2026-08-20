export function buildRegistryIndex(registry) {
  return new Map(registry.processes.map((entry) => [ entry.process_id, entry ]));
}

export function resolveProcessTarget(target, registryIndex) {
  const registered = target.target_process_id ? registryIndex.get(target.target_process_id) : null;
  if (registered) {
    return {
      ...target,
      navigation_target_ref: registered.navigation_ref,
      target_resolution: 'registered_bpmn'
    };
  }
  if (target.target_ref) {
    return {
      ...target,
      navigation_target_ref: target.target_ref,
      target_resolution: 'fallback_card'
    };
  }
  return {
    ...target,
    navigation_target_ref: null,
    target_resolution: 'unresolved'
  };
}

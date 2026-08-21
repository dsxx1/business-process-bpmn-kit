import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';

const defaultProjectRoot = resolve(import.meta.dirname, '..', '..');

function fail(message) {
  throw new Error(message);
}

function containedPath(projectRoot, path, label) {
  const candidate = resolve(path);
  if (candidate !== projectRoot && !candidate.startsWith(`${projectRoot}${sep}`)) {
    fail(`${label} выходит за пределы проекта: ${path}`);
  }
  if (!existsSync(candidate)) fail(`${label} не найден: ${path}`);
  return candidate;
}

function projectPath(projectRoot, ref, label) {
  if (typeof ref !== 'string' || !ref.trim()) fail(`${label} не указан.`);
  return containedPath(projectRoot, resolve(projectRoot, ref), label);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} содержит некорректный JSON: ${error.message}`);
  }
}

function allBpmnIds(rootElement) {
  const ids = new Set();
  const seen = new Set();
  const queue = [ rootElement ];
  while (queue.length) {
    const element = queue.shift();
    if (!element || typeof element !== 'object' || seen.has(element)) continue;
    seen.add(element);
    if (element.id) ids.add(element.id);
    for (const [ key, value ] of Object.entries(element)) {
      if (key.startsWith('$') || [ 'incoming', 'outgoing', 'sourceRef', 'targetRef', 'bpmnElement', 'planeElement' ].includes(key)) continue;
      if (Array.isArray(value)) queue.push(...value);
      else if (value && typeof value === 'object') queue.push(value);
    }
  }
  return ids;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} содержит повтор: ${value}`);
    seen.add(value);
  }
}

async function validateBindings(bindingsPath, {
  projectRoot = defaultProjectRoot,
  mapPathOverride = null,
  quiet = false,
} = {}) {
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedBindingsPath = containedPath(
    resolvedProjectRoot,
    bindingsPath,
    'Файл привязок карты',
  );
  const bindings = readJson(resolvedBindingsPath, 'Файл привязок карты');
  if (bindings.schema !== 'human-map-bpmn-bindings/v1') fail(`Неизвестная схема привязок: ${bindings.schema}`);
  if (!Array.isArray(bindings.bindings) || !bindings.bindings.length) fail('Массив bindings отсутствует или пуст.');

  const mapPath = mapPathOverride
    ? containedPath(resolvedProjectRoot, mapPathOverride, 'Исходник карты')
    : projectPath(resolvedProjectRoot, bindings.map_ref, 'Исходник карты');
  const bpmnPath = projectPath(resolvedProjectRoot, bindings.bpmn_ref, 'BPMN');
  const metaPath = projectPath(resolvedProjectRoot, bindings.meta_ref, 'Метаданные процесса');
  const workflow = readJson(mapPath, 'Исходник карты');
  const meta = readJson(metaPath, 'Метаданные процесса');
  if (bindings.process_id !== meta.process_id) {
    fail(`process_id привязок ${bindings.process_id} не совпадает с метаданными ${meta.process_id}`);
  }

  const mapNodes = workflow.nodes || [];
  if (!Array.isArray(mapNodes) || !mapNodes.length) fail('В исходнике карты отсутствуют nodes.');
  const mapNodeIds = mapNodes.map((node) => node.id);
  assertUnique(mapNodeIds, 'Узлы карты');
  const mapNodeSet = new Set(mapNodeIds);

  const parsed = await new BpmnModdle().fromXML(readFileSync(bpmnPath, 'utf8'));
  if (parsed.warnings.length) fail(`BPMN разобран с предупреждениями: ${parsed.warnings.map((warning) => warning.message).join('; ')}`);
  const bpmnIds = allBpmnIds(parsed.rootElement);
  const processLinks = new Map(meta.process_links.map((link) => [ link.link_id, link ]));
  if (processLinks.size !== meta.process_links.length) fail('В process.meta.json повторяются link_id.');

  const boundMapNodes = [];
  const boundProcessLinks = [];
  for (const binding of bindings.bindings) {
    if (!binding || typeof binding !== 'object') fail('Элемент bindings должен быть объектом.');
    if (!mapNodeSet.has(binding.map_node_id)) fail(`Привязка ссылается на отсутствующий узел карты: ${binding.map_node_id}`);
    boundMapNodes.push(binding.map_node_id);
    if (!Array.isArray(binding.bpmn_element_ids) || !binding.bpmn_element_ids.length) {
      fail(`У узла карты ${binding.map_node_id} нет bpmn_element_ids.`);
    }
    assertUnique(binding.bpmn_element_ids, `BPMN-привязка узла ${binding.map_node_id}`);
    for (const elementId of binding.bpmn_element_ids) {
      if (!bpmnIds.has(elementId)) fail(`Узел карты ${binding.map_node_id} ссылается на отсутствующий BPMN-элемент: ${elementId}`);
    }
    if (!Array.isArray(binding.process_link_ids)) fail(`У узла карты ${binding.map_node_id} отсутствует массив process_link_ids.`);
    assertUnique(binding.process_link_ids, `Межпроцессные связи узла ${binding.map_node_id}`);
    for (const linkId of binding.process_link_ids) {
      const link = processLinks.get(linkId);
      if (!link) fail(`Узел карты ${binding.map_node_id} ссылается на отсутствующую межпроцессную связь: ${linkId}`);
      if (!binding.bpmn_element_ids.includes(link.source_element_id)) {
        fail(`Связь ${linkId} начинается в ${link.source_element_id}, но этот BPMN-элемент не привязан к узлу карты ${binding.map_node_id}`);
      }
      boundProcessLinks.push(linkId);
    }
  }

  assertUnique(boundMapNodes, 'Привязки узлов карты');
  assertUnique(boundProcessLinks, 'Привязки межпроцессных связей');
  const missingMapNodes = mapNodeIds.filter((id) => !boundMapNodes.includes(id));
  if (missingMapNodes.length) fail(`Узлы карты без BPMN-привязки: ${missingMapNodes.join(', ')}`);
  const missingProcessLinks = [ ...processLinks.keys() ].filter((id) => !boundProcessLinks.includes(id));
  if (missingProcessLinks.length) fail(`Межпроцессные связи не показаны на карте: ${missingProcessLinks.join(', ')}`);

  const result = {
    status: 'passed',
    process_id: bindings.process_id,
    map_nodes: mapNodeIds.length,
    bound_bpmn_elements: new Set(bindings.bindings.flatMap((binding) => binding.bpmn_element_ids)).size,
    process_links: boundProcessLinks.length,
    bindings: relative(resolvedProjectRoot, resolvedBindingsPath).split(sep).join('/'),
  };
  if (!quiet) console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runCli() {
  const args = process.argv.slice(2);
  const projectRootIndex = args.indexOf('--project-root');
  const cliProjectRoot = projectRootIndex >= 0
    ? resolve(args[projectRootIndex + 1] || '')
    : defaultProjectRoot;
  if (projectRootIndex >= 0 && !args[projectRootIndex + 1]) fail('После --project-root требуется путь.');
  const argument = args.find((item, index) => (
    !item.startsWith('--') && !(projectRootIndex >= 0 && index === projectRootIndex + 1)
  ));
  const bindingsPath = argument
    ? resolve(argument)
    : resolve(defaultProjectRoot, 'processes', 'skupka-zolota', 'map', 'process-map.bindings.json');
  await validateBindings(bindingsPath, { projectRoot: cliProjectRoot });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await runCli();

export { validateBindings };

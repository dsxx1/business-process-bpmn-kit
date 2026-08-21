import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';
import { validateBindings } from './validate-map-bindings.mjs';

const codeProjectRoot = resolve(import.meta.dirname, '..', '..');
const archifyRoot = resolve(codeProjectRoot, 'vendor', 'archify');
const archifyBin = resolve(archifyRoot, 'bin', 'archify.mjs');
const archifyPackagePath = resolve(archifyRoot, 'package.json');
const archifyManifestPath = resolve(archifyRoot, 'VENDORED-FILES.sha256');
const archifyLicensePath = resolve(archifyRoot, 'LICENSE');
const mapLocalizerPath = resolve(import.meta.dirname, 'localize-map-ru.mjs');
const mapValidatorPath = resolve(import.meta.dirname, 'validate-map-ui.mjs');
const mapBindingsValidatorPath = resolve(import.meta.dirname, 'validate-map-bindings.mjs');
const archifyRuntimeContract = Object.freeze({
  buildVersion: '2.14.0+local-humanize',
  upstreamVersion: '2.14.0',
  upstreamRevision: '7769cf5b2b9500ea7edfae6acbe3ea16c9bf93ef',
  profile: 'local-humanize',
  license: 'MIT',
});

const outputNames = Object.freeze({
  workflow: 'process-map.workflow.json',
  bindings: 'process-map.bindings.json',
  artifact: 'process-map.html',
  receipt: 'process-map.build-receipt.json',
});

const flowNodeFallbacks = Object.freeze({
  'bpmn:StartEvent': 'Начать процесс',
  'bpmn:EndEvent': 'Завершить процесс',
  'bpmn:IntermediateCatchEvent': 'Дождаться события',
  'bpmn:IntermediateThrowEvent': 'Передать событие',
  'bpmn:BoundaryEvent': 'Обработать исключение',
  'bpmn:UserTask': 'Выполнить действие',
  'bpmn:ManualTask': 'Выполнить вручную',
  'bpmn:ServiceTask': 'Запустить систему',
  'bpmn:ScriptTask': 'Выполнить сценарий',
  'bpmn:BusinessRuleTask': 'Проверить правило',
  'bpmn:SendTask': 'Отправить сообщение',
  'bpmn:ReceiveTask': 'Получить сообщение',
  'bpmn:CallActivity': 'Открыть связанный процесс',
  'bpmn:SubProcess': 'Выполнить подпроцесс',
  'bpmn:ExclusiveGateway': 'Выбрать маршрут',
  'bpmn:InclusiveGateway': 'Выбрать варианты',
  'bpmn:ParallelGateway': 'Запустить параллельно',
  'bpmn:EventBasedGateway': 'Дождаться события',
  'bpmn:ComplexGateway': 'Проверить условия',
  'bpmn:Task': 'Выполнить шаг',
});

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fileDigest(path) {
  const bytes = readFileSync(path);
  return {
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}

function posixRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function isPathInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function requireInside(parent, candidate, label) {
  if (!isPathInside(parent, candidate)) {
    fail(`${label} выходит за пределы разрешённого каталога.`, { parent, candidate });
  }
}

function requireRegularFile(path, allowedRoot, label) {
  if (!existsSync(path)) fail(`${label} не найден: ${path}`);
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) fail(`${label} не должен быть символической ссылкой: ${path}`);
  if (!entry.isFile()) fail(`${label} должен быть обычным файлом: ${path}`);
  const real = realpathSync(path);
  requireInside(allowedRoot, real, label);
  return real;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} содержит некорректный JSON: ${error.message}`, { path });
  }
}

function vendoredRelativeFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = resolve(directory, entry.name);
    requireInside(root, candidate, 'Файл встроенного Archify');
    if (entry.isSymbolicLink()) {
      fail(`Встроенный Archify не должен содержать символическую ссылку: ${candidate}`);
    }
    if (entry.isDirectory()) {
      files.push(...vendoredRelativeFiles(root, candidate));
    } else if (entry.isFile() && candidate !== archifyManifestPath) {
      files.push(posixRelative(root, candidate));
    } else if (!entry.isFile()) {
      fail(`Во встроенном Archify найден неподдерживаемый объект: ${candidate}`);
    }
  }
  return files.sort(stableCompare);
}

function verifyVendoredRuntime() {
  const root = realpathSync(archifyRoot);
  const manifestBytes = readFileSync(archifyManifestPath);
  const lines = manifestBytes.toString('utf8').split(/\r?\n/u).filter(Boolean);
  if (!lines.length) fail('Манифест встроенного Archify пуст.');
  const manifestFiles = [];
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/u);
    if (!match) fail(`Некорректная строка манифеста Archify: ${line}`);
    const [, expectedHash, relativePath] = match;
    manifestFiles.push(relativePath);
    const candidate = resolve(root, ...relativePath.split('/'));
    requireInside(root, candidate, 'Файл встроенного Archify');
    const real = requireRegularFile(candidate, root, 'Файл встроенного Archify');
    const actualHash = fileDigest(real).sha256;
    if (actualHash !== expectedHash) {
      fail(`Нарушена целостность встроенного Archify: ${relativePath}`);
    }
  }
  const actualFiles = vendoredRelativeFiles(root);
  const expectedFiles = [...manifestFiles].sort(stableCompare);
  if (new Set(expectedFiles).size !== expectedFiles.length) {
    fail('Манифест встроенного Archify содержит повторяющиеся пути.');
  }
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail('Состав встроенного Archify не совпадает с VENDORED-FILES.sha256.', {
      missing: expectedFiles.filter((path) => !actualFiles.includes(path)),
      unlisted: actualFiles.filter((path) => !expectedFiles.includes(path)),
    });
  }
  return {
    manifest_sha256: sha256(manifestBytes),
    files: lines.length,
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function embedArchifyLicenseNotice(artifactPath) {
  const html = readFileSync(artifactPath, 'utf8');
  const license = readFileSync(archifyLicensePath, 'utf8').trimEnd();
  if (license.includes('-->')) {
    fail('Текст лицензии Archify нельзя безопасно встроить в HTML-комментарий.');
  }
  const notice = `<!--\nArchify third-party license notice\n\n${license}\n-->\n`;
  const doctype = html.match(/^<!doctype html>\r?\n/iu)?.[0];
  const licensedHtml = doctype
    ? `${doctype}${notice}${html.slice(doctype.length)}`
    : `${notice}${html}`;
  writeFileSync(artifactPath, licensedHtml, 'utf8');
}

function captureTargetState(path) {
  if (!existsSync(path)) return { kind: 'missing' };
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) fail(`Нельзя заменять символическую ссылку: ${path}`);
  if (!entry.isFile()) fail(`Ожидался обычный файл результата: ${path}`);
  return { kind: 'file', ...fileDigest(path) };
}

function isManagedAutomaticDraft(workflowPath, receiptPath) {
  if (!existsSync(workflowPath) || !existsSync(receiptPath)) return false;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    return receipt?.schema === 'archify-map-build-receipt/v1'
      && receipt?.source?.automatic_draft === true
      && receipt?.source?.workflow?.sha256 === fileDigest(workflowPath).sha256;
  } catch {
    return false;
  }
}

function assertTargetState(path, expected) {
  const actual = captureTargetState(path);
  if (actual.kind !== expected.kind) {
    fail(`Результат изменился параллельно со сборкой: ${path}`);
  }
  if (actual.kind === 'file' && actual.sha256 !== expected.sha256) {
    fail(`Результат изменился параллельно со сборкой: ${path}`);
  }
}

function parseArchifyReceipt(result, command) {
  if (result.error) {
    fail(`Не удалось запустить Archify (${command}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    const diagnostic = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(`Archify завершил ${command} с кодом ${result.status}.`, { diagnostic });
  }
  try {
    const receipt = JSON.parse(result.stdout);
    if (receipt.ok !== true) fail(`Archify не подтвердил успешный ${command}.`, { receipt });
    return receipt;
  } catch (error) {
    if (error.details?.receipt) throw error;
    fail(`Archify вернул некорректную квитанцию ${command}: ${error.message}`, {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
}

function runArchify(command, args, projectRoot) {
  if (!existsSync(archifyBin)) fail(`Встроенный Archify не найден: ${archifyBin}`);
  const result = spawnSync(process.execPath, [archifyBin, command, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseArchifyReceipt(result, command);
}

function runMapPresentationStep(scriptPath, args, projectRoot, label) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    fail(`Не удалось запустить ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const diagnostic = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(`${label} завершилась с кодом ${result.status}.`, { diagnostic });
  }
}

function elementSortKey(element) {
  return `${element?.name || ''}\u0000${element?.id || ''}`;
}

function stableCompare(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function buildFlowGraph(processElement) {
  const elements = Array.isArray(processElement?.flowElements) ? processElement.flowElements : [];
  const nodes = elements
    .filter((element) => (
    element?.id
    && typeof element.$instanceOf === 'function'
    && element.$instanceOf('bpmn:FlowNode')
    ))
    .sort((left, right) => stableCompare(elementSortKey(left), elementSortKey(right)));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const flows = [];

  for (const flow of elements.filter((element) => element?.$type === 'bpmn:SequenceFlow')) {
    const source = flow.sourceRef?.id;
    const target = flow.targetRef?.id;
    if (!nodeById.has(source) || !nodeById.has(target)) continue;
    const edge = {
      flow,
      source: nodeById.get(source),
      target: nodeById.get(target),
    };
    flows.push(edge);
    outgoing.get(source).push(edge);
    incoming.get(target).push(edge);
  }

  const edgeKey = (edge) => (
    `${elementSortKey(edge.flow)}\u0000${edge.source.id}\u0000${edge.target.id}`
  );
  flows.sort((left, right) => stableCompare(edgeKey(left), edgeKey(right)));
  for (const edges of [...outgoing.values(), ...incoming.values()]) {
    edges.sort((left, right) => stableCompare(edgeKey(left), edgeKey(right)));
  }

  return { nodes, flows, outgoing, incoming };
}

function automaticLayout(graph) {
  if (graph.nodes.length > 12) {
    fail(
      `Автоматическая карта поддерживает не более 12 BPMN-узлов, а найдено ${graph.nodes.length}. Подготовьте курированную карту.`,
      { flow_nodes: graph.nodes.length },
    );
  }

  const starts = graph.nodes.filter((node) => node.$type === 'bpmn:StartEvent');
  const roots = graph.nodes.filter((node) => graph.incoming.get(node.id).length === 0);
  const seeds = [...new Set([...starts, ...roots, ...graph.nodes])];
  const depth = new Map();
  const ordered = [];
  const visited = new Set();

  for (const seed of seeds) {
    if (visited.has(seed.id)) continue;
    depth.set(seed.id, 0);
    const queue = [seed];
    while (queue.length) {
      const node = queue.shift();
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      ordered.push(node);
      const sourceDepth = depth.get(node.id) || 0;
      for (const edge of graph.outgoing.get(node.id)) {
        if (!depth.has(edge.target.id)) depth.set(edge.target.id, sourceDepth + 1);
        if (!visited.has(edge.target.id) && !queue.some((candidate) => candidate.id === edge.target.id)) {
          queue.push(edge.target);
        }
      }
    }
  }

  const maxDepth = Math.max(...depth.values(), 0);
  if (maxDepth > 5) {
    fail(
      `Автоматическая карта поддерживает не более 6 последовательных уровней, а в BPMN найдено ${maxDepth + 1}. Подготовьте курированную карту.`,
      { levels: maxDepth + 1 },
    );
  }
  const returnEdges = new Set(graph.flows
    .filter((edge) => (depth.get(edge.target.id) || 0) <= (depth.get(edge.source.id) || 0))
    .map((edge) => edge.flow.id));
  const selfLoops = graph.flows.filter((edge) => edge.source.id === edge.target.id);
  if (selfLoops.length) {
    fail(
      'Автоматическая карта не размещает петлю узла на самого себя: подготовьте курированную карту.',
      { sequence_flow_ids: selfLoops.map((edge) => edge.flow.id) },
    );
  }

  return { ordered, depth, returnEdges };
}

function hasCyrillic(value) {
  return /[А-Яа-яЁё]/u.test(value || '');
}

function shorten(value, maxLength = 20) {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength - 1);
  const breakAt = candidate.lastIndexOf(' ');
  const usefulBreak = breakAt >= Math.max(8, Math.floor(maxLength * 0.45));
  return `${candidate.slice(0, usefulBreak ? breakAt : maxLength - 1).trim()}…`;
}

function russianNodeLabel(element) {
  const name = String(element?.name || '').replace(/\s+/gu, ' ').trim();
  if (name && hasCyrillic(name)) return shorten(name);
  return flowNodeFallbacks[element?.$type] || 'Выполнить шаг процесса';
}

function nodeType(element) {
  if (['bpmn:StartEvent', 'bpmn:EndEvent'].includes(element?.$type)) return 'external';
  if (String(element?.$type || '').endsWith('Gateway')) return 'security';
  if (['bpmn:SendTask', 'bpmn:ReceiveTask', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent'].includes(element?.$type)) return 'messagebus';
  if (element?.$type === 'bpmn:CallActivity') return 'external';
  if (element?.$type === 'bpmn:SubProcess') return 'cloud';
  if (['bpmn:UserTask', 'bpmn:ManualTask'].includes(element?.$type)) return 'frontend';
  return 'backend';
}

function selectProcess(rootElement, meta) {
  const processes = (rootElement?.rootElements || []).filter((element) => element?.$type === 'bpmn:Process');
  if (!processes.length) fail('В BPMN не найден элемент bpmn:process.');
  const bpmnMeta = meta?.bpmn;
  const hasExpectedId = bpmnMeta
    && Object.prototype.hasOwnProperty.call(bpmnMeta, 'process_element_id');
  if (hasExpectedId) {
    const expectedId = bpmnMeta.process_element_id;
    if (typeof expectedId !== 'string' || !expectedId.trim()) {
      fail('В process.meta.json поле bpmn.process_element_id должно содержать непустой BPMN ID.');
    }
    const selected = processes.find((candidate) => candidate.id === expectedId);
    if (!selected) {
      fail(
        `В BPMN не найден process с ID «${expectedId}», указанным в bpmn.process_element_id.`,
        { available_process_ids: processes.map((candidate) => candidate.id).filter(Boolean) },
      );
    }
    return selected;
  }
  if (processes.length !== 1) {
    fail(
      'В BPMN найдено несколько process: укажите нужный ID в bpmn.process_element_id.',
      { available_process_ids: processes.map((candidate) => candidate.id).filter(Boolean) },
    );
  }
  return processes[0];
}

function automaticNodeIds(nodes) {
  const result = new Map();
  const occupied = new Set();
  for (const node of nodes) {
    const normalized = String(node.id).replace(/[^a-zA-Z0-9_-]/gu, '_');
    const base = /^[a-zA-Z]/u.test(normalized) ? `map_${normalized}` : `map_node_${normalized}`;
    let candidate = base;
    if (occupied.has(candidate)) candidate = `${base}_${sha256(Buffer.from(node.id)).slice(0, 8)}`;
    occupied.add(candidate);
    result.set(node.id, candidate);
  }
  return result;
}

function longestMainPath(graph, orderedNodes, depth) {
  const remainingLength = new Map();
  const depthOrder = [...orderedNodes].sort((left, right) => (
    (depth.get(right.id) - depth.get(left.id))
      || stableCompare(elementSortKey(left), elementSortKey(right))
  ));
  for (const node of depthOrder) {
    const next = graph.outgoing.get(node.id).filter((edge) => (
      depth.get(edge.target.id) > depth.get(node.id)
    ));
    const longestTail = next.length
      ? Math.max(...next.map((edge) => remainingLength.get(edge.target.id) || 1))
      : 0;
    remainingLength.set(node.id, 1 + longestTail);
  }
  const roots = orderedNodes.filter((node) => depth.get(node.id) === 0);
  const startCandidates = roots.filter((node) => node.$type === 'bpmn:StartEvent');
  const candidates = startCandidates.length ? startCandidates : roots;
  candidates.sort((left, right) => (
    (remainingLength.get(right.id) - remainingLength.get(left.id))
      || stableCompare(elementSortKey(left), elementSortKey(right))
  ));
  const path = [];
  let current = candidates[0];
  while (current) {
    path.push(current);
    const next = graph.outgoing.get(current.id).filter((edge) => (
      depth.get(edge.target.id) > depth.get(current.id)
    )).sort((left, right) => (
      ((remainingLength.get(right.target.id) || 0) - (remainingLength.get(left.target.id) || 0))
        || stableCompare(elementSortKey(left.flow), elementSortKey(right.flow))
    ));
    current = next[0]?.target;
  }
  return path;
}

function assignAutomaticLanes(graph, orderedNodes, depth, mainPath) {
  const mainIds = new Set(mainPath.map((node) => node.id));
  const laneByNode = new Map(mainPath.map((node) => [node.id, 'main_route']));
  const occupied = new Set(mainPath.map((node) => `main_route:${depth.get(node.id)}`));
  const branchLaneIds = [];

  const newBranchLane = () => {
    const laneId = `branch_route_${String(branchLaneIds.length + 1).padStart(2, '0')}`;
    branchLaneIds.push(laneId);
    return laneId;
  };

  for (const node of orderedNodes) {
    if (mainIds.has(node.id)) continue;
    const nodeDepth = depth.get(node.id);
    const inherited = graph.incoming.get(node.id)
      .map((edge) => laneByNode.get(edge.source.id))
      .find((laneId) => laneId && laneId !== 'main_route' && !occupied.has(`${laneId}:${nodeDepth}`));
    const laneId = inherited || newBranchLane();
    laneByNode.set(node.id, laneId);
    occupied.add(`${laneId}:${nodeDepth}`);
  }

  return {
    laneByNode,
    lanes: [
      { id: 'main_route', label: 'Основной маршрут процесса' },
      ...branchLaneIds.map((id, index) => ({
        id,
        label: `Дополнительный маршрут ${index + 1}`,
      })),
    ],
  };
}

function russianFlowLabel(edge) {
  const flowName = String(edge.flow?.name || '').replace(/\s+/gu, ' ').trim();
  const targetLabel = russianNodeLabel(edge.target);
  if (flowName && hasCyrillic(flowName)) {
    if (String(edge.source?.$type || '').endsWith('Gateway')) {
      return shorten(`${flowName}: ${targetLabel}`, 30);
    }
    return shorten(flowName, 30);
  }
  return shorten(`Перейти: ${targetLabel}`, 30);
}

async function generateDraft({ bpmnPath, meta, projectRoot, finalPaths }) {
  const parsed = await new BpmnModdle().fromXML(readFileSync(bpmnPath, 'utf8'));
  if (parsed.warnings?.length) {
    fail(`BPMN разобран с предупреждениями: ${parsed.warnings.map((warning) => warning.message).join('; ')}`);
  }
  const processElement = selectProcess(parsed.rootElement, meta);
  const graph = buildFlowGraph(processElement);
  if (!graph.nodes.length) fail('В BPMN нет шагов, из которых можно построить карту.');
  const { ordered, depth, returnEdges } = automaticLayout(graph);
  const mainPath = longestMainPath(graph, ordered, depth);
  const { laneByNode, lanes } = assignAutomaticLanes(graph, ordered, depth, mainPath);
  const mapNodeIds = automaticNodeIds(ordered);
  const mainEdgeKeys = new Set(mainPath.slice(0, -1).map((node, index) => (
    `${node.id}\u0000${mainPath[index + 1].id}`
  )));
  const processTitle = String(meta?.title ?? '').trim() || 'Бизнес-процесс';
  const nodes = ordered.map((node) => ({
    id: mapNodeIds.get(node.id),
    lane: laneByNode.get(node.id),
    col: depth.get(node.id),
    type: nodeType(node),
    label: russianNodeLabel(node),
    width: 160,
    height: 68,
  }));
  const edges = graph.flows.map((edge, index) => {
    const returns = returnEdges.has(edge.flow.id);
    const main = mainEdgeKeys.has(`${edge.source.id}\u0000${edge.target.id}`);
    return {
      id: `edge_${String(index + 1).padStart(2, '0')}`,
      from: mapNodeIds.get(edge.source.id),
      to: mapNodeIds.get(edge.target.id),
      label: russianFlowLabel(edge),
      role: returns ? 'return' : (main ? 'main' : 'branch'),
      variant: main && !returns ? 'emphasis' : 'dashed',
      ...(returns ? (
        laneByNode.get(edge.source.id) === laneByNode.get(edge.target.id)
          ? {
            fromSide: 'top',
            toSide: 'top',
            route: 'up-channel',
          }
          : {
            fromSide: 'right',
            toSide: 'right',
            route: 'outside-right',
          }
      ) : (main ? {
        fromSide: 'right',
        toSide: 'left',
        route: 'straight',
      } : {})),
    };
  });

  const workflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: `${processTitle} · Автоматический черновик карты`,
      subtitle: 'Карта автоматически построена из BPMN и ожидает проверки человеком',
      animation: 'none',
      quality_profile: 'showcase',
      viewBox: [1900, Math.max(380, 180 + lanes.length * 124)],
      legend: { mode: 'hidden' },
    },
    lanes,
    ...(mainPath.length >= 2 ? { mainPath: mainPath.map((node) => mapNodeIds.get(node.id)) } : {}),
    nodes,
    edges,
    cards: [
      {
        dot: 'amber',
        title: 'Статус карты',
        items: [
          'Это автоматический черновик по структуре BPMN, а не утверждённая бизнес-карта',
          'Каждый BPMN-узел верхнего уровня и каждый переход показаны отдельно; проверьте роли и формулировки',
          'После проверки отредактируйте исходник карты и повторите сборку',
        ],
      },
    ],
  };

  const links = Array.isArray(meta?.process_links) ? meta.process_links : [];
  const bindings = {
    schema: 'human-map-bpmn-bindings/v1',
    process_id: meta?.process_id || processElement.id,
    map_ref: posixRelative(projectRoot, finalPaths.workflow),
    bpmn_ref: posixRelative(projectRoot, bpmnPath),
    meta_ref: posixRelative(projectRoot, finalPaths.meta),
    bindings: ordered.map((node) => {
      const ids = [node.id];
      return {
        map_node_id: mapNodeIds.get(node.id),
        bpmn_element_ids: ids,
        process_link_ids: links
          .filter((link) => ids.includes(link?.source_element_id))
          .map((link) => link.link_id),
      };
    }),
  };

  return { workflow, bindings };
}

function ensureSameInputs(inputs) {
  for (const input of inputs) {
    const current = fileDigest(input.path);
    if (current.sha256 !== input.sha256 || current.bytes !== input.bytes) {
      fail(`Исходник изменился во время сборки: ${input.ref}`);
    }
  }
}

export function commitStagedFiles({
  entries,
  targetDirectory,
  expectedStates,
  guardedInputs = [],
  testHooks = {},
}) {
  const targetExisted = existsSync(targetDirectory);
  if (targetExisted) {
    const entry = lstatSync(targetDirectory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      fail(`Каталог карты должен быть обычным каталогом: ${targetDirectory}`);
    }
  } else {
    mkdirSync(targetDirectory);
  }

  const backupDirectory = mkdtempSync(join(targetDirectory, '.archify-map-backup-'));
  const backups = [];
  const installed = [];
  const rollbackErrors = [];

  try {
    ensureSameInputs(guardedInputs);
    for (const entry of entries) {
      if (!existsSync(entry.staged) || !statSync(entry.staged).isFile()) {
        fail(`В staging отсутствует результат: ${entry.staged}`);
      }
      assertTargetState(entry.target, expectedStates.get(entry.target));
    }

    for (const entry of entries) {
      const expected = expectedStates.get(entry.target);
      if (expected.kind !== 'file') continue;
      assertTargetState(entry.target, expected);
      const backup = join(backupDirectory, entry.name);
      renameSync(entry.target, backup);
      backups.push({ backup, target: entry.target });
    }

    for (const entry of entries) {
      if (testHooks.failCommitAfter === installed.length) {
        fail('Тестовая ошибка во время фиксации результатов.');
      }
      renameSync(entry.staged, entry.target);
      installed.push(entry.target);
    }
    if (testHooks.beforeFinalInputCheck !== undefined) {
      if (typeof testHooks.beforeFinalInputCheck !== 'function') {
        fail('Тестовый hook beforeFinalInputCheck должен быть функцией.');
      }
      testHooks.beforeFinalInputCheck();
    }
    // Эта проверка намеренно находится внутри транзакции: backup ещё существует,
    // поэтому параллельное изменение любого guarded input приводит к откату уже
    // установленных результатов, а не к смешанной версии карты.
    ensureSameInputs(guardedInputs);
    rmSync(backupDirectory, { recursive: true, force: true });
  } catch (error) {
    for (const target of [...installed].reverse()) {
      try {
        if (existsSync(target)) rmSync(target, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    for (const item of [...backups].reverse()) {
      try {
        if (existsSync(item.backup)) renameSync(item.backup, item.target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    try {
      rmSync(backupDirectory, { recursive: true, force: true });
      if (!targetExisted && existsSync(targetDirectory)) rmSync(targetDirectory);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError.message);
    }
    if (rollbackErrors.length) {
      fail(`${error.message} Откат завершился с ошибками: ${rollbackErrors.join('; ')}`);
    }
    throw error;
  }
}

function receiptValidation(validateReceipt, deliverReceipt) {
  return {
    quality_profile: 'showcase',
    checks_passed: deliverReceipt.validation.checksPassed,
    checks_total: deliverReceipt.validation.checkCount,
    composition_status: deliverReceipt.validation.compositionStatus,
    errors: deliverReceipt.validation.errors,
    warnings: deliverReceipt.validation.warnings,
    validate_checks_passed: validateReceipt.checks.filter((check) => check.ok).length,
    validate_checks_total: validateReceipt.checks.length,
  };
}

export async function buildArchifyMap({
  slug,
  projectRoot = codeProjectRoot,
  testHooks = {},
} = {}) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    fail('Короткое название процесса должно состоять из латинских букв, цифр и дефисов.');
  }

  const vendorIntegrity = verifyVendoredRuntime();

  const resolvedProjectRoot = realpathSync(resolve(projectRoot));
  const processesRoot = realpathSync(resolve(resolvedProjectRoot, 'processes'));
  requireInside(resolvedProjectRoot, processesRoot, 'Каталог процессов');
  const requestedProcessDirectory = resolve(processesRoot, slug);
  requireInside(processesRoot, requestedProcessDirectory, 'Каталог процесса');
  if (!existsSync(requestedProcessDirectory)) fail(`Процесс не найден: ${slug}`);
  const requestedProcessEntry = lstatSync(requestedProcessDirectory);
  if (requestedProcessEntry.isSymbolicLink()) {
    fail(`Каталог процесса не должен быть символической ссылкой или точкой соединения: ${slug}`);
  }
  if (!requestedProcessEntry.isDirectory()) fail(`Процесс не является каталогом: ${slug}`);
  const processDirectory = realpathSync(requestedProcessDirectory);
  requireInside(processesRoot, processDirectory, 'Каталог процесса');
  if (processDirectory !== requestedProcessDirectory) {
    fail(`Фактический каталог процесса не совпадает с запрошенным путём: ${slug}`);
  }

  const requestedBpmnDirectory = resolve(processDirectory, 'bpmn');
  const bpmnDirectoryEntry = lstatSync(requestedBpmnDirectory);
  if (bpmnDirectoryEntry.isSymbolicLink() || !bpmnDirectoryEntry.isDirectory()) {
    fail(`Каталог BPMN имеет небезопасный тип: ${requestedBpmnDirectory}`);
  }
  const bpmnDirectory = realpathSync(requestedBpmnDirectory);
  requireInside(processDirectory, bpmnDirectory, 'Каталог BPMN');
  if (bpmnDirectory !== requestedBpmnDirectory) {
    fail(`Фактический каталог BPMN не совпадает с ожидаемым путём: ${requestedBpmnDirectory}`);
  }
  const bpmnPath = requireRegularFile(resolve(bpmnDirectory, 'process.bpmn'), processDirectory, 'Канонический BPMN');
  const metaPath = requireRegularFile(resolve(bpmnDirectory, 'process.meta.json'), processDirectory, 'Метаданные процесса');
  const meta = readJson(metaPath, 'Метаданные процесса');

  const mapDirectory = resolve(processDirectory, 'map');
  if (existsSync(mapDirectory)) {
    const mapDirectoryEntry = lstatSync(mapDirectory);
    if (mapDirectoryEntry.isSymbolicLink() || !mapDirectoryEntry.isDirectory()) {
      fail(`Каталог карты имеет небезопасный тип: ${mapDirectory}`);
    }
    const realMapDirectory = realpathSync(mapDirectory);
    requireInside(processDirectory, realMapDirectory, 'Каталог карты');
    if (realMapDirectory !== mapDirectory) {
      fail(`Фактический каталог карты не совпадает с ожидаемым путём: ${mapDirectory}`);
    }
  }
  const finalPaths = {
    workflow: resolve(mapDirectory, outputNames.workflow),
    bindings: resolve(mapDirectory, outputNames.bindings),
    artifact: resolve(mapDirectory, outputNames.artifact),
    receipt: resolve(mapDirectory, outputNames.receipt),
    meta: metaPath,
  };
  Object.values(finalPaths).forEach((path) => requireInside(processDirectory, path, 'Файл карты'));

  if (existsSync(finalPaths.workflow)) {
    requireRegularFile(finalPaths.workflow, processDirectory, 'Исходник карты Archify');
  }
  if (existsSync(finalPaths.bindings)) {
    requireRegularFile(finalPaths.bindings, processDirectory, 'Привязки карты к BPMN');
  }
  const hasWorkflow = existsSync(finalPaths.workflow);
  const managedAutomaticDraft = isManagedAutomaticDraft(finalPaths.workflow, finalPaths.receipt);
  const curated = hasWorkflow && !managedAutomaticDraft;
  if (curated && !existsSync(finalPaths.bindings)) {
    fail('У курированной карты нет process-map.bindings.json: нельзя подтвердить её связь с BPMN.');
  }
  const targets = curated
    ? [finalPaths.artifact, finalPaths.receipt]
    : [finalPaths.workflow, finalPaths.bindings, finalPaths.artifact, finalPaths.receipt];
  const expectedStates = new Map(targets.map((path) => [path, captureTargetState(path)]));
  const initialBpmn = { path: bpmnPath, ref: posixRelative(resolvedProjectRoot, bpmnPath), ...fileDigest(bpmnPath) };
  const initialMeta = { path: metaPath, ref: posixRelative(resolvedProjectRoot, metaPath), ...fileDigest(metaPath) };
  const guardedInputs = [initialBpmn, initialMeta];

  if (curated) {
    guardedInputs.push({
      path: finalPaths.workflow,
      ref: posixRelative(resolvedProjectRoot, finalPaths.workflow),
      ...fileDigest(finalPaths.workflow),
    });
    if (existsSync(finalPaths.bindings)) {
      guardedInputs.push({
        path: finalPaths.bindings,
        ref: posixRelative(resolvedProjectRoot, finalPaths.bindings),
        ...fileDigest(finalPaths.bindings),
      });
    }
  }

  const stagingDirectory = mkdtempSync(join(processDirectory, '.archify-map-build-'));
  const stagedWorkflow = resolve(stagingDirectory, outputNames.workflow);
  const stagedBindings = resolve(stagingDirectory, outputNames.bindings);
  const stagedArtifact = resolve(stagingDirectory, outputNames.artifact);
  const stagedReceipt = resolve(stagingDirectory, outputNames.receipt);

  try {
    let sourceMode;
    if (curated) {
      sourceMode = 'curated';
      copyFileSync(finalPaths.workflow, stagedWorkflow);
      copyFileSync(finalPaths.bindings, stagedBindings);
    } else {
      sourceMode = 'automatic_draft';
      const generated = await generateDraft({
        bpmnPath,
        meta,
        projectRoot: resolvedProjectRoot,
        finalPaths,
      });
      writeJson(stagedWorkflow, generated.workflow);
      writeJson(stagedBindings, generated.bindings);
    }

    const bindingsValidation = await validateBindings(stagedBindings, {
      projectRoot: resolvedProjectRoot,
      mapPathOverride: stagedWorkflow,
      quiet: true,
    });

    const stagedWorkflowDigest = fileDigest(stagedWorkflow);
    const validateReceipt = runArchify('validate', [
      'workflow',
      stagedWorkflow,
      '--quality',
      'showcase',
      '--json',
    ], resolvedProjectRoot);
    const deliverReceipt = runArchify('deliver', [
      'workflow',
      stagedWorkflow,
      stagedArtifact,
      '--quality',
      'showcase',
      '--json',
    ], resolvedProjectRoot);
    const rawArtifactDigest = fileDigest(stagedArtifact);
    if (deliverReceipt.specification.sha256 !== stagedWorkflowDigest.sha256) {
      fail('Квитанция Archify не совпала с исходником карты.');
    }
    if (deliverReceipt.artifact.sha256 !== rawArtifactDigest.sha256) {
      fail('Квитанция Archify не совпала с HTML-картой.');
    }

    runMapPresentationStep(
      mapLocalizerPath,
      [stagedArtifact],
      resolvedProjectRoot,
      'русская подготовка карты',
    );
    runMapPresentationStep(
      mapValidatorPath,
      [stagedArtifact, '--title', meta.title],
      resolvedProjectRoot,
      'проверка русской карты',
    );
    embedArchifyLicenseNotice(stagedArtifact);
    const artifactDigest = fileDigest(stagedArtifact);

    const packageBytes = readFileSync(archifyPackagePath);
    const archifyPackage = JSON.parse(packageBytes.toString('utf8'));
    if (
      archifyPackage.version !== archifyRuntimeContract.buildVersion
      || archifyPackage.license !== archifyRuntimeContract.license
      || archifyPackage.archifyBuild?.upstreamVersion !== archifyRuntimeContract.upstreamVersion
      || archifyPackage.archifyBuild?.upstreamRevision !== archifyRuntimeContract.upstreamRevision
      || archifyPackage.archifyBuild?.profile !== archifyRuntimeContract.profile
    ) {
      fail('Идентичность или лицензия встроенного Archify не совпадает с зафиксированным контрактом.');
    }
    const bindingDigest = existsSync(stagedBindings)
      ? fileDigest(stagedBindings)
      : (existsSync(finalPaths.bindings) ? fileDigest(finalPaths.bindings) : null);
    const receipt = {
      schema: 'archify-map-build-receipt/v1',
      tool: {
        name: 'Archify',
        version: archifyPackage.version,
        upstream_version: archifyPackage.archifyBuild.upstreamVersion,
        upstream_revision: archifyPackage.archifyBuild.upstreamRevision,
        build_profile: archifyPackage.archifyBuild.profile,
        license: archifyPackage.license,
        runtime_ref: posixRelative(codeProjectRoot, archifyRoot),
        package_sha256: sha256(packageBytes),
        manifest_sha256: vendorIntegrity.manifest_sha256,
        vendored_files: vendorIntegrity.files,
      },
      process: {
        slug,
        process_id: meta?.process_id || null,
        title: meta?.title || null,
      },
      source: {
        mode: sourceMode,
        automatic_draft: sourceMode === 'automatic_draft',
        bpmn: {
          ref: posixRelative(resolvedProjectRoot, bpmnPath),
          sha256: initialBpmn.sha256,
          bytes: initialBpmn.bytes,
        },
        metadata: {
          ref: posixRelative(resolvedProjectRoot, metaPath),
          sha256: initialMeta.sha256,
          bytes: initialMeta.bytes,
        },
        workflow: {
          ref: posixRelative(resolvedProjectRoot, finalPaths.workflow),
          ...stagedWorkflowDigest,
        },
        bindings: bindingDigest ? {
          ref: posixRelative(resolvedProjectRoot, finalPaths.bindings),
          ...bindingDigest,
        } : null,
      },
      validation: {
        ...receiptValidation(validateReceipt, deliverReceipt),
        map_to_bpmn: {
          status: bindingsValidation.status,
          map_nodes: bindingsValidation.map_nodes,
          bound_bpmn_elements: bindingsValidation.bound_bpmn_elements,
          process_links: bindingsValidation.process_links,
          validator_ref: posixRelative(codeProjectRoot, mapBindingsValidatorPath),
          validator_sha256: fileDigest(mapBindingsValidatorPath).sha256,
        },
      },
      presentation: {
        locale: 'ru',
        localizer_ref: posixRelative(codeProjectRoot, mapLocalizerPath),
        localizer_sha256: fileDigest(mapLocalizerPath).sha256,
        validator_ref: posixRelative(codeProjectRoot, mapValidatorPath),
        validator_sha256: fileDigest(mapValidatorPath).sha256,
        raw_archify_artifact_sha256: rawArtifactDigest.sha256,
        map_ui_validation: 'passed',
      },
      artifact: {
        ref: posixRelative(resolvedProjectRoot, finalPaths.artifact),
        ...artifactDigest,
      },
      guarantees: {
        canonical_bpmn_unchanged: true,
        staged_before_commit: true,
        rollback_on_commit_error: true,
        guarded_inputs_rechecked_before_backup_cleanup: true,
        visual_review: 'not_run',
      },
    };
    writeJson(stagedReceipt, receipt);

    ensureSameInputs(guardedInputs);
    const entries = [
      ...(curated ? [] : [
        { name: outputNames.workflow, staged: stagedWorkflow, target: finalPaths.workflow },
        { name: outputNames.bindings, staged: stagedBindings, target: finalPaths.bindings },
      ]),
      { name: outputNames.artifact, staged: stagedArtifact, target: finalPaths.artifact },
      { name: outputNames.receipt, staged: stagedReceipt, target: finalPaths.receipt },
    ];
    commitStagedFiles({
      entries,
      targetDirectory: mapDirectory,
      expectedStates,
      guardedInputs,
      testHooks,
    });

    return {
      receipt,
      paths: {
        workflow: finalPaths.workflow,
        bindings: existsSync(finalPaths.bindings) ? finalPaths.bindings : null,
        artifact: finalPaths.artifact,
        receipt: finalPaths.receipt,
      },
    };
  } finally {
    if (existsSync(stagingDirectory)) rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  const slug = args.find((arg) => !arg.startsWith('--'));
  if (!slug || args.some((arg) => arg.startsWith('--') && arg !== '--json')) {
    console.error('Использование: node archify-adapter.mjs <короткое-название> [--json]');
    process.exitCode = 2;
    return;
  }
  try {
    const result = await buildArchifyMap({ slug });
    if (args.includes('--json')) {
      console.log(JSON.stringify(result.receipt, null, 2));
    } else {
      console.log(`Карта Archify готова: ${result.paths.artifact}`);
      console.log(`Источник: ${result.receipt.source.automatic_draft ? 'автоматический черновик' : 'проверенная курированная карта'}.`);
      console.log(`Проверки: ${result.receipt.validation.checks_passed}/${result.receipt.validation.checks_total}; SHA-256 ${result.receipt.artifact.sha256}.`);
    }
  } catch (error) {
    console.error(`Не удалось собрать карту Archify: ${error.message}`);
    if (error.details?.diagnostic) console.error(error.details.diagnostic);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await runCli();

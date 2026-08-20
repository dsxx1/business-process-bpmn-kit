import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import process from 'node:process';

import Ajv from 'ajv';
import { BpmnModdle } from 'bpmn-moddle';

const args = process.argv.slice(2);
const requireRegistry = args.includes('--require-registry');
const packageArg = args.find((arg) => !arg.startsWith('--')) || '../../templates/process-package/bpmn';
const toolRoot = resolve(import.meta.dirname, '..', '..');
const packageRoot = resolve(packageArg);
const schemaRoot = resolve(toolRoot, 'docs', 'schemas');
const registryPath = resolve(toolRoot, 'registry', 'processes.json');

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function containedPath(base, ref) {
  const path = resolve(base, ref);
  if (path !== toolRoot && !path.startsWith(`${toolRoot}${sep}`)) {
    fail(`Reference leaves the project root: ${ref}`);
  }
  return path;
}

function projectPath(ref) {
  return containedPath(toolRoot, ref);
}

function packageRefPath(ref) {
  const base = ref.startsWith('./') || ref.startsWith('../') ? packageRoot : toolRoot;
  return containedPath(base, ref);
}

function packageOwnedPath(ref) {
  const path = packageRefPath(ref);
  const processPackageRoot = resolve(packageRoot, '..');
  if (path !== processPackageRoot && !path.startsWith(`${processPackageRoot}${sep}`)) {
    fail(`Package evidence reference leaves its process package: ${ref}`);
  }
  return path;
}

function validateJson(ajv, schemaName, dataName, dataRoot = packageRoot) {
  const schema = readJson(resolve(schemaRoot, schemaName));
  const data = readJson(resolve(dataRoot, dataName));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    fail(`${dataName}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  }
  return data;
}

function allBpmnElements(rootElement) {
  const seen = new Set();
  const result = [];
  const queue = [ rootElement ];

  while (queue.length) {
    const element = queue.shift();
    if (!element || typeof element !== 'object' || seen.has(element)) continue;
    seen.add(element);
    if (element.$type) result.push(element);
    for (const [ key, value ] of Object.entries(element)) {
      if (key.startsWith('$') || [ 'incoming', 'outgoing', 'sourceRef', 'targetRef', 'bpmnElement', 'planeElement' ].includes(key)) continue;
      if (Array.isArray(value)) queue.push(...value);
      else if (value && typeof value === 'object') queue.push(value);
    }
  }
  return result;
}

function assertFileHash(ref) {
  const path = packageOwnedPath(ref.ref);
  if (!existsSync(path)) fail(`Missing referenced file: ${ref.ref}`);
  const actual = sha256(path);
  if (actual !== ref.sha256) fail(`SHA-256 mismatch for ${ref.ref}: expected ${ref.sha256}, got ${actual}`);
}

const ajv = new Ajv({ allErrors: true, strict: false, formats: { 'date-time': true } });
const meta = validateJson(ajv, 'process-package.schema.json', 'process.meta.json');
const questions = validateJson(ajv, 'questions.schema.json', 'questions.json');
const decisions = validateJson(ajv, 'decisions.schema.json', 'decisions.json');

if (meta.process_id !== questions.process_id || meta.process_id !== decisions.process_id) {
  fail('process_id differs between package files');
}
if (meta.version !== questions.model_version || meta.version !== decisions.model_version) {
  fail('model version differs between package files');
}

let registry = { processes: [] };
if (existsSync(registryPath)) {
  registry = validateJson(ajv, 'process-registry.schema.json', 'registry/processes.json', toolRoot);
  const registryIds = new Set();
  for (const entry of registry.processes) {
    if (registryIds.has(entry.process_id)) fail(`Duplicate process_id in registry: ${entry.process_id}`);
    registryIds.add(entry.process_id);
    for (const ref of [ entry.bpmn_ref, entry.meta_ref, entry.navigation_ref ]) {
      if (!existsSync(projectPath(ref))) fail(`Registry target does not exist: ${ref}`);
    }
  }
}

const registryEntry = registry.processes.find((entry) => entry.process_id === meta.process_id);
if (requireRegistry && !registryEntry) fail(`Registry is missing ${meta.process_id}`);
if (registryEntry && (registryEntry.status !== meta.status || registryEntry.business_status !== meta.canonicality.business_status)) {
  fail(`Registry status is stale for ${meta.process_id}`);
}

assertFileHash(meta.source_card);
meta.evidence.forEach(assertFileHash);

const bpmnPath = resolve(packageRoot, meta.bpmn.file);
if (!existsSync(bpmnPath)) fail(`Missing BPMN file: ${meta.bpmn.file}`);
const xml = readFileSync(bpmnPath, 'utf8');

const namespacePrefixes = [ ...xml.matchAll(/xmlns:([A-Za-z0-9_-]+)=/g) ].map((match) => match[1]);
const portablePrefixes = new Set([ 'xsi', 'bpmn', 'bpmndi', 'dc', 'di' ]);
const vendorPrefixes = namespacePrefixes.filter((prefix) => !portablePrefixes.has(prefix));
if (meta.variant !== 'execution' && vendorPrefixes.length) {
  fail(`Vendor namespaces are forbidden in a neutral model: ${vendorPrefixes.join(', ')}`);
}
if (meta.variant === 'execution' && !meta.engine) fail('Execution model requires engine metadata');

const moddle = new BpmnModdle();
const parsed = await moddle.fromXML(xml);
if (parsed.warnings.length) fail(`bpmn-moddle warnings: ${parsed.warnings.map((warning) => warning.message).join('; ')}`);

const definitions = parsed.rootElement;
if (definitions.id !== meta.bpmn.definitions_id) fail(`definitions id mismatch: ${definitions.id}`);

const collaboration = definitions.rootElements.find((element) => element.$type === 'bpmn:Collaboration');
const bpmnProcess = definitions.rootElements.find((element) => element.$type === 'bpmn:Process');
if (!collaboration || collaboration.id !== meta.bpmn.collaboration_id) fail('Collaboration is missing or has an unexpected id');
if (!bpmnProcess || bpmnProcess.id !== meta.bpmn.process_element_id) fail('Process is missing or has an unexpected id');
if (Boolean(bpmnProcess.isExecutable) !== meta.bpmn.is_executable) fail('isExecutable differs between BPMN and metadata');
if (!definitions.diagrams?.length || !definitions.diagrams[0].plane?.planeElement?.length) fail('BPMN DI is missing');

const elements = allBpmnElements(definitions);
const elementsById = new Map(elements.filter((element) => element.id).map((element) => [ element.id, element ]));
const activities = elements.filter((element) => element.$instanceOf?.('bpmn:Activity'));
for (const activity of activities) {
  if (!activity.name?.trim()) fail(`Activity ${activity.id} has no human-readable name`);
}

const sequenceFlows = elements.filter((element) => element.$type === 'bpmn:SequenceFlow');
for (const flow of sequenceFlows) {
  if (!/^Flow_[A-Za-z][A-Za-z0-9_]*$/.test(flow.id || '')) {
    fail(`Sequence flow ${flow.id || '(missing id)'} must have a stable semantic ASCII id`);
  }
}

const gateways = elements.filter((element) => element.$type === 'bpmn:ExclusiveGateway');
for (const gateway of gateways) {
  const incomingCount = (gateway.incoming || []).length;
  const outgoingCount = (gateway.outgoing || []).length;
  if (incomingCount > 1 && outgoingCount > 1) fail(`Gateway ${gateway.id} must not join and fork at the same time`);
  if (outgoingCount > 1) {
    if (!gateway.name?.trim()) fail(`Forking gateway ${gateway.id} has no question label`);
    for (const flow of gateway.outgoing || []) {
      if (!flow.name?.trim()) fail(`Outgoing flow ${flow.id} from ${gateway.id} has no answer label`);
    }
  } else if (incomingCount > 1 && outgoingCount !== 1) {
    fail(`Converging gateway ${gateway.id} must have one outgoing flow`);
  }
}

const startEvents = elements.filter((element) => element.$type === 'bpmn:StartEvent');
const endEvents = elements.filter((element) => element.$type === 'bpmn:EndEvent');
if (startEvents.length !== 1) fail(`Expected exactly one start event, got ${startEvents.length}`);
if (endEvents.length < 1) fail('At least one explicit end event is required');

const reachable = new Set();
const queue = [ startEvents[0] ];
while (queue.length) {
  const current = queue.shift();
  if (!current?.id || reachable.has(current.id)) continue;
  reachable.add(current.id);
  for (const outgoing of current.outgoing || []) queue.push(outgoing.targetRef);
}
const unreachableEnds = endEvents.filter((event) => !reachable.has(event.id));
if (unreachableEnds.length) fail(`Unreachable end events: ${unreachableEnds.map((event) => event.id).join(', ')}`);

const linkIds = new Set();
for (const link of meta.process_links) {
  if (linkIds.has(link.link_id)) fail(`Duplicate process link id: ${link.link_id}`);
  linkIds.add(link.link_id);
  const sourceElement = elementsById.get(link.source_element_id);
  if (!sourceElement) fail(`Process link references missing BPMN element: ${link.source_element_id}`);
  if (sourceElement?.$type === 'bpmn:CallActivity') {
    if (!sourceElement.calledElement?.trim()) fail(`Call activity ${sourceElement.id} has no calledElement`);
    if (!link.target_process_id) fail(`Call activity ${sourceElement.id} process link has no target_process_id`);
    if (sourceElement.calledElement !== link.target_process_id) {
      fail(`Call activity ${sourceElement.id} calls ${sourceElement.calledElement}, but process link targets ${link.target_process_id}`);
    }
  }
  if (link.relation === 'call' && sourceElement?.$type !== 'bpmn:CallActivity') {
    fail(`Process link ${link.link_id} has relation=call, but ${link.source_element_id} is not a Call Activity`);
  }
  const targets = [ ...(link.target_ref ? [ { target_ref: link.target_ref } ] : []), ...link.candidate_targets ];
  for (const target of targets) {
    if (target.target_ref && !existsSync(packageRefPath(target.target_ref))) fail(`Process link target does not exist: ${target.target_ref}`);
  }
  if (link.target_status !== 'unresolved' && !link.target_process_id) fail(`Resolved link ${link.link_id} has no target_process_id`);
}

const callActivities = activities.filter((activity) => activity.$type === 'bpmn:CallActivity');
for (const callActivity of callActivities) {
  if (!meta.process_links.some((link) => link.source_element_id === callActivity.id)) {
    fail(`Call activity ${callActivity.id} has no process link`);
  }
}

const questionIds = new Set();
for (const question of questions.questions) {
  if (questionIds.has(question.question_id)) fail(`Duplicate question id: ${question.question_id}`);
  questionIds.add(question.question_id);
  for (const elementId of question.source_element_ids) {
    if (!elementsById.has(elementId)) fail(`Question ${question.question_id} references missing BPMN element: ${elementId}`);
  }
}
for (const decision of decisions.decisions) {
  if (!questionIds.has(decision.question_id)) fail(`Decision references unknown question: ${decision.question_id}`);
}

if (meta.canonicality.business_status === 'canonical') {
  if (meta.review.human_decision !== 'approved' || !decisions.decisions.some((decision) => decision.outcome === 'approve')) {
    fail('Canonical business status requires an approved human decision');
  }
}
if (meta.canonicality.business_status === 'rejected') {
  if (meta.review.human_decision !== 'rejected' || !decisions.decisions.some((decision) => decision.outcome === 'reject')) {
    fail('Rejected business status requires a recorded rejection');
  }
}
if (meta.canonicality.business_status === 'pending_human_decision' && meta.review.human_decision === 'approved') {
  fail('Pending business status conflicts with an approved human decision');
}

const serialized = await moddle.toXML(definitions, { format: true });
const roundTrip = await moddle.fromXML(serialized.xml);
if (roundTrip.warnings.length) fail(`Round-trip warnings: ${roundTrip.warnings.map((warning) => warning.message).join('; ')}`);
const beforeIds = new Set(elements.filter((element) => element.id).map((element) => element.id));
const afterIds = new Set(allBpmnElements(roundTrip.rootElement).filter((element) => element.id).map((element) => element.id));
const lostIds = [ ...beforeIds ].filter((id) => !afterIds.has(id));
if (lostIds.length) fail(`Round-trip lost BPMN ids: ${lostIds.join(', ')}`);

console.log(JSON.stringify({
  status: 'passed',
  process_id: meta.process_id,
  title: meta.title,
  variant: meta.variant,
  version: meta.version,
  bpmn_sha256: sha256(bpmnPath),
  bpmn_elements: elementsById.size,
  activities: activities.length,
  gateways: gateways.length,
  outcomes: endEvents.length,
  open_blocking_questions: questions.questions.filter((question) => question.blocking && question.status === 'open').length,
  process_links: meta.process_links.length,
  registered: Boolean(registryEntry),
  execution_ready: meta.variant === 'execution' && meta.bpmn.is_executable,
  business_status: meta.canonicality.business_status
}, null, 2));

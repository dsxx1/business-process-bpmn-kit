import { BpmnModdle } from 'bpmn-moddle';

const supportedTransitionRelations = Object.freeze([ 'call' ]);
const supportedTargetKinds = Object.freeze([ 'registered', 'reserved', 'unknown' ]);
const targetStatuses = Object.freeze([ 'canonical', 'candidate', 'unresolved' ]);
const cyrillicTextPattern = /\p{Script=Cyrillic}/u;
const opaqueReaderCodePattern = /(?:^|[^\p{L}\p{N}])(?:ОП|БП|СКС)[-\s]?\d+(?=$|[^\p{L}\p{N}])|\b(?:Activity|Event|Flow|Gateway|PROC|Task)_[A-Za-z0-9_-]+\b/iu;
const processIdPattern = /^[A-Z][A-Z0-9-]{2,63}$/u;
const linkIdPattern = /^LINK-[A-Z0-9-]+-[0-9]{2,3}$/u;

class ProcessTransitionContractError extends Error {
  constructor(code, message, status = 422, details = undefined) {
    super(message);
    this.name = 'ProcessTransitionContractError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function transitionError(code, message, status = 422, details = undefined) {
  return new ProcessTransitionContractError(code, message, status, details);
}

function validateReaderLabel(value) {
  const label = String(value ?? '').trim();
  if (!label) throw transitionError('TRANSITION_LABEL_REQUIRED', 'Укажите понятное русское название перехода.', 400);
  if (label.length > 240 || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw transitionError('TRANSITION_LABEL_INVALID', 'Название перехода должно быть одной строкой длиной не более 240 символов.', 400);
  }
  if (!cyrillicTextPattern.test(label) || opaqueReaderCodePattern.test(label)) {
    throw transitionError('TRANSITION_LABEL_INVALID', 'Название перехода должно быть понятной русской фразой без внутренних кодов.', 400);
  }
  return label;
}

function validateSourceElementId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 255 || /[\s<>"']/u.test(id)) {
    throw transitionError('SOURCE_ELEMENT_ID_INVALID', 'Не удалось определить выбранный элемент BPMN.', 400);
  }
  return id;
}

function validateProcessId(value, label = 'Идентификатор целевого процесса') {
  const id = String(value ?? '').trim();
  if (!processIdPattern.test(id)) {
    throw transitionError('TARGET_PROCESS_ID_INVALID', `${label} имеет неверный формат.`, 400);
  }
  return id;
}

function validateLinkId(value) {
  const id = String(value ?? '').trim();
  if (!linkIdPattern.test(id)) {
    throw transitionError('TRANSITION_ID_INVALID', 'Идентификатор перехода имеет неверный формат.', 400);
  }
  return id;
}

function processIdFromSlug(slug) {
  return validateProcessId(String(slug ?? '').trim().toUpperCase(), 'Зарезервированный идентификатор процесса');
}

function linkStem(processId) {
  const safe = String(processId ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 52)
    .replace(/-+$/gu, '');
  return safe || 'PROCESS';
}

function nextLinkId(processId, links = []) {
  const stem = linkStem(processId);
  const used = new Set(links.map((link) => link?.link_id).filter(Boolean));
  for (let number = 1; number <= 999; number += 1) {
    const width = number < 100 ? 2 : 3;
    const candidate = `LINK-${stem}-${String(number).padStart(width, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  throw transitionError('TRANSITION_ID_EXHAUSTED', 'Для процесса исчерпаны доступные идентификаторы переходов.', 409);
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

function callActivityTargetContractError(callActivity, link) {
  const calledElement = String(callActivity?.calledElement ?? '').trim();
  const targetProcessId = link?.target_process_id === null || link?.target_process_id === undefined
    ? null
    : String(link.target_process_id).trim();
  const status = link?.target_status;

  if (!targetStatuses.includes(status)) return `Process link ${link?.link_id || '(без ID)'} has unsupported target_status`;
  if (status === 'unresolved') {
    if (targetProcessId) return `Unresolved call activity ${callActivity.id} must not declare target_process_id`;
    if (calledElement) return `Unresolved call activity ${callActivity.id} must not declare calledElement`;
    return null;
  }
  if (!targetProcessId) return `Call activity ${callActivity.id} process link has no target_process_id`;
  if (!calledElement) return `Call activity ${callActivity.id} has no calledElement`;
  if (calledElement !== targetProcessId) {
    return `Call activity ${callActivity.id} calls ${calledElement}, but process link targets ${targetProcessId}`;
  }
  return null;
}

async function parseDefinitions(xml) {
  let parsed;
  try {
    parsed = await new BpmnModdle().fromXML(String(xml ?? ''));
  } catch (error) {
    throw transitionError('INVALID_BPMN_XML', `BPMN XML не разобран: ${error.message}`, 422);
  }
  if (parsed.rootElement?.$type !== 'bpmn:Definitions') {
    throw transitionError('INVALID_BPMN_ROOT', 'Корневой элемент файла должен быть BPMN Definitions.', 422);
  }
  if ((parsed.warnings || []).length) {
    throw transitionError('BPMN_REFERENCE_ERRORS', 'В BPMN найдены повреждённые или неразрешённые ссылки.', 422, {
      warnings: parsed.warnings.map((warning) => warning.message || String(warning))
    });
  }
  return parsed.rootElement;
}

function findElement(elements, id, { allowMissing = false } = {}) {
  const element = elements.find((candidate) => candidate?.id === id);
  if (!element && !allowMissing) {
    throw transitionError('SOURCE_ELEMENT_NOT_FOUND', `В BPMN не найден выбранный элемент ${id}.`, 422, {
      source_element_id: id
    });
  }
  return element || null;
}

function requireCallActivity(element, id) {
  if (element?.$type !== 'bpmn:CallActivity') {
    throw transitionError(
      'SOURCE_ELEMENT_NOT_CALL_ACTIVITY',
      'Для перехода «вызвать и вернуться» выберите элемент «Вызов процесса» (Call Activity).',
      422,
      { source_element_id: id, actual_type: element?.$type || null }
    );
  }
  return element;
}

function normalizeResolvedTarget(target) {
  const kind = String(target?.kind ?? '').trim();
  if (!supportedTargetKinds.includes(kind)) {
    throw transitionError('TARGET_KIND_INVALID', 'Выберите существующий процесс, будущий процесс или вариант «пока неизвестно».', 400);
  }
  if (kind === 'unknown') {
    return {
      kind,
      title: null,
      target_status: 'unresolved',
      target_process_id: null,
      target_ref: null
    };
  }
  const title = String(target?.title ?? '').trim();
  if (!title) throw transitionError('TARGET_TITLE_REQUIRED', 'Укажите название следующего процесса.', 400);
  if (title.length > 200) {
    throw transitionError('TARGET_TITLE_INVALID', 'Название следующего процесса не должно быть длиннее 200 символов.', 400);
  }
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(title)) {
    throw transitionError('TARGET_TITLE_INVALID', 'Название следующего процесса должно быть записано в одну строку.', 400);
  }
  return {
    kind,
    title,
    target_status: 'candidate',
    target_process_id: validateProcessId(target?.process_id),
    target_ref: target?.target_ref === null || target?.target_ref === undefined
      ? null
      : String(target.target_ref)
  };
}

async function serializeDefinitions(definitions) {
  try {
    const result = await new BpmnModdle().toXML(definitions, { format: true, preamble: true });
    return result.xml.endsWith('\n') ? result.xml : `${result.xml}\n`;
  } catch (error) {
    throw transitionError('BPMN_SERIALIZE_FAILED', `Не удалось сохранить изменение Call Activity: ${error.message}`, 422);
  }
}

async function upsertCallTransition({ xml, meta, linkId = null, sourceElementId, label, target }) {
  const sourceId = validateSourceElementId(sourceElementId);
  const readerLabel = validateReaderLabel(label);
  const normalizedTarget = normalizeResolvedTarget(target);
  const definitions = await parseDefinitions(xml);
  const elements = allBpmnElements(definitions);
  const sourceElement = requireCallActivity(findElement(elements, sourceId), sourceId);
  const nextMeta = structuredClone(meta || {});
  if (!Array.isArray(nextMeta.process_links)) nextMeta.process_links = [];

  let index = -1;
  let id;
  if (linkId === null || linkId === undefined || String(linkId).trim() === '') {
    const existing = nextMeta.process_links.find((link) => link?.source_element_id === sourceId);
    if (existing) {
      throw transitionError(
        'TRANSITION_EXISTS',
        'У выбранного вызова уже есть переход. Откройте существующую связь для изменения.',
        409,
        { link_id: existing.link_id, source_element_id: sourceId }
      );
    }
    id = nextLinkId(nextMeta.process_id, nextMeta.process_links);
  } else {
    id = validateLinkId(linkId);
    index = nextMeta.process_links.findIndex((link) => link?.link_id === id);
    if (index < 0) throw transitionError('TRANSITION_NOT_FOUND', `Переход ${id} не найден.`, 404);
    const previous = nextMeta.process_links[index];
    if (previous?.relation !== 'call') {
      throw transitionError('TRANSITION_RELATION_UNSUPPORTED', 'Studio пока безопасно изменяет только вызов другого процесса с возвратом.', 422);
    }
    const collision = nextMeta.process_links.find((link, candidateIndex) =>
      candidateIndex !== index && link?.source_element_id === sourceId
    );
    if (collision) {
      throw transitionError('TRANSITION_EXISTS', 'У выбранного вызова уже есть другой переход.', 409, {
        link_id: collision.link_id,
        source_element_id: sourceId
      });
    }
    if (previous.source_element_id !== sourceId) {
      throw transitionError(
        'TRANSITION_SOURCE_CHANGE_FORBIDDEN',
        'Нельзя перенести существующий переход на другой блок схемы. Сначала удалите прежнюю связь, затем создайте новую у нужного Call Activity.',
        409,
        {
          link_id: id,
          current_source_element_id: previous.source_element_id,
          requested_source_element_id: sourceId
        }
      );
    }
  }

  sourceElement.calledElement = normalizedTarget.target_process_id || undefined;
  const link = {
    link_id: id,
    source_element_id: sourceId,
    relation: 'call',
    label: readerLabel,
    target_status: normalizedTarget.target_status,
    target_process_id: normalizedTarget.target_process_id,
    target_ref: normalizedTarget.target_ref,
    candidate_targets: []
  };
  const contractError = callActivityTargetContractError(sourceElement, link);
  if (contractError) throw transitionError('CALL_ACTIVITY_TARGET_INVALID', contractError, 422);
  if (index < 0) nextMeta.process_links.push(link);
  else nextMeta.process_links[index] = link;

  return {
    xml: await serializeDefinitions(definitions),
    meta: nextMeta,
    transition: link,
    target: normalizedTarget
  };
}

async function removeCallTransition({ xml, meta, linkId }) {
  const id = validateLinkId(linkId);
  const nextMeta = structuredClone(meta || {});
  if (!Array.isArray(nextMeta.process_links)) nextMeta.process_links = [];
  const index = nextMeta.process_links.findIndex((link) => link?.link_id === id);
  if (index < 0) throw transitionError('TRANSITION_NOT_FOUND', `Переход ${id} не найден.`, 404);
  const link = nextMeta.process_links[index];
  if (link?.relation !== 'call') {
    throw transitionError('TRANSITION_RELATION_UNSUPPORTED', 'Studio пока безопасно удаляет только вызов другого процесса с возвратом.', 422);
  }

  const definitions = await parseDefinitions(xml);
  const elements = allBpmnElements(definitions);
  const sourceElement = findElement(elements, link.source_element_id, { allowMissing: true });
  if (sourceElement?.$type === 'bpmn:CallActivity') {
    throw transitionError(
      'CALL_ACTIVITY_STILL_PRESENT',
      'Перед удалением перехода преобразуйте Call Activity в обычную задачу или удалите этот блок со схемы.',
      422,
      { link_id: id, source_element_id: link.source_element_id }
    );
  }
  if (sourceElement && sourceElement.$type !== 'bpmn:Task') {
    throw transitionError(
      'TRANSITION_REPLACEMENT_INVALID',
      'Бывший Call Activity можно заменить только обычной задачей или полностью удалить со схемы.',
      422,
      { link_id: id, source_element_id: link.source_element_id, actual_type: sourceElement.$type }
    );
  }
  nextMeta.process_links.splice(index, 1);
  return {
    xml: await serializeDefinitions(definitions),
    meta: nextMeta,
    transition: link
  };
}

function renderReservedProcessCard({ sourceTitle, sourceSlug, targetTitle, targetSlug, targetProcessId, label }) {
  return `<!-- bpmn-studio-reserved-process/v1 slug="${targetSlug}" process_id="${targetProcessId}" -->\n` +
    `# ${targetTitle}\n\n` +
    `**Будущий бизнес-процесс зарезервирован из Studio.** Короткое имя: \`${targetSlug}\`; постоянный идентификатор: \`${targetProcessId}\`.\n\n` +
    `## Откуда ведёт переход\n\n` +
    `Из процесса «${sourceTitle}» (\`${sourceSlug}\`) по переходу «${label}». После завершения вызываемого процесса основной процесс продолжает работу.\n\n` +
    `## Как превратить карточку в готовый BPMN-процесс\n\n` +
    `Создайте в Studio новый процесс с коротким именем \`${targetSlug}\`, оформите и зарегистрируйте его. Переход начнёт открывать зарегистрированную BPMN-модель по идентификатору \`${targetProcessId}\`; менять исходную схему не потребуется.\n\n` +
    `## Что нужно уточнить\n\n` +
    `- владелец и участники процесса;\n` +
    `- событие начала и результат завершения;\n` +
    `- какие данные передаются при вызове и что возвращается;\n` +
    `- сроки, исключения и правила возврата в основной процесс.\n`;
}

export {
  ProcessTransitionContractError,
  allBpmnElements,
  callActivityTargetContractError,
  nextLinkId,
  processIdFromSlug,
  removeCallTransition,
  renderReservedProcessCard,
  supportedTargetKinds,
  supportedTransitionRelations,
  targetStatuses,
  transitionError,
  upsertCallTransition,
  validateLinkId,
  validateReaderLabel,
  validateSourceElementId
};

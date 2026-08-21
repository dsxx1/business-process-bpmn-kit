import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

import {
  StudioError,
  createStudioCore,
  studioError,
  validateSlug
} from './studio-core.mjs';

const serverVersion = '1.0.0';
const resourceSections = Object.freeze([ 'meta', 'xml', 'questions', 'links' ]);

function resolveProjectRoot(value, { cwd = process.cwd() } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw studioError(
      'PROJECT_ROOT_REQUIRED',
      'Укажите корень BPMN-проекта через --project-root или переменную BPMN_PROJECT_ROOT.',
      400
    );
  }

  const lexicalPath = resolve(cwd, raw);
  if (!existsSync(lexicalPath)) {
    throw studioError('PROJECT_ROOT_NOT_FOUND', 'Указанный корень BPMN-проекта не найден.', 404);
  }

  let canonicalPath;
  try {
    canonicalPath = realpathSync.native(lexicalPath);
  } catch (error) {
    throw studioError('PROJECT_ROOT_UNAVAILABLE', `Корень BPMN-проекта недоступен: ${error.message}`, 400);
  }
  const entry = lstatSync(canonicalPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw studioError('PROJECT_ROOT_INVALID', 'Корень BPMN-проекта должен быть обычным каталогом.', 400);
  }
  return canonicalPath;
}

function assertContained(root, target, label, { allowRoot = false } = {}) {
  const relation = relative(root, target);
  if ((!allowRoot && !relation) || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw studioError('UNSAFE_PATH', `${label} выходит за пределы пакета процесса.`, 400);
  }
  return target;
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw studioError('RESOURCE_NOT_FOUND', `${label} не найден.`, 404);
    throw studioError('INVALID_JSON', `${label} не прочитан: ${error.message}`, 422);
  }
}

function questionSummary(document) {
  if (!document || !Array.isArray(document.questions)) {
    return { total: null, open: null, blocking_open: null };
  }
  const open = document.questions.filter((question) => question?.status === 'open');
  return {
    total: document.questions.length,
    open: open.length,
    blocking_open: open.filter((question) => question?.blocking === true).length
  };
}

function processSummary(processData, questionsDocument = null) {
  const links = Array.isArray(processData.meta?.process_links) ? processData.meta.process_links : [];
  return {
    title: processData.title,
    process_id: processData.process_id,
    version: processData.meta?.version ?? null,
    variant: processData.meta?.variant ?? null,
    technical_status: processData.status?.technical ?? null,
    business_status: processData.status?.business ?? null,
    registered: processData.status?.registered === true,
    is_executable: processData.meta?.bpmn?.is_executable ?? null,
    questions: questionSummary(questionsDocument),
    links: {
      total: links.length,
      unresolved: links.filter((link) => link?.target_status === 'unresolved').length
    },
    generated_id_issues: processData.generated_id_issues?.length ?? 0
  };
}

function createBpmnMcpCore(options = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const studio = options.studioCore || createStudioCore({
    projectRoot,
    commandRunner: options.commandRunner,
    archifyAdapterPath: options.archifyAdapterPath
  });
  const canonicalProcessesRoot = realpathSync.native(studio.processesRoot);

  function processPath(slug, ...parts) {
    const safeSlug = validateSlug(slug);
    // readProcess проверяет сам пакет, bpmn-каталог, XML, метаданные и все symlink-границы.
    studio.readProcess(safeSlug, { includeXml: false });
    const packageRoot = assertContained(canonicalProcessesRoot, resolve(canonicalProcessesRoot, safeSlug), 'Пакет процесса');
    const target = assertContained(packageRoot, resolve(packageRoot, ...parts), 'Ресурс процесса');
    return { slug: safeSlug, packageRoot, target };
  }

  function readQuestions(slug, { optional = false } = {}) {
    const { packageRoot, target } = processPath(slug, 'bpmn', 'questions.json');
    if (!existsSync(target)) {
      if (optional) return null;
      throw studioError('RESOURCE_NOT_FOUND', 'Файл вопросов владельцу процесса не найден.', 404);
    }
    const entry = lstatSync(target);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw studioError('UNSAFE_PATH', 'Файл вопросов должен быть обычным файлом внутри пакета процесса.', 400);
    }
    const canonicalTarget = realpathSync.native(target);
    assertContained(realpathSync.native(packageRoot), canonicalTarget, 'Файл вопросов');
    return readJsonFile(canonicalTarget, 'Файл вопросов владельцу процесса');
  }

  function decorateProcess(processData, { includeXml = false } = {}) {
    const questions = readQuestions(processData.slug, { optional: true });
    const decorated = {
      ...processData,
      summary: processSummary(processData, questions)
    };
    if (!includeXml) delete decorated.xml;
    return decorated;
  }

  function listProcesses() {
    const listed = studio.listProcesses();
    return {
      schema: 'business-process-bpmn-mcp-catalog/v1',
      processes: listed.items.map((item) => decorateProcess(item, { includeXml: false })),
      skipped: listed.skipped
    };
  }

  function getProcess(slug, { includeXml = false } = {}) {
    return decorateProcess(studio.readProcess(slug, { includeXml }), { includeXml });
  }

  async function createDraft({ title, slug }) {
    return studio.createProcess({ title, slug });
  }

  async function saveXml({ slug, xml, expectedSha256 }) {
    return studio.saveBpmn(slug, { xml, expectedSha256 });
  }

  function listTransitionTargets({ slug }) {
    return studio.listTransitionTargets(slug);
  }

  async function setProcessTransition({
    slug,
    linkId = null,
    xml,
    expectedBpmnSha256,
    expectedMetaSha256,
    sourceElementId,
    relation = 'call',
    label,
    target
  }) {
    return studio.saveTransition(slug, {
      linkId,
      xml,
      expectedBpmnSha256,
      expectedMetaSha256,
      sourceElementId,
      relation,
      label,
      target
    });
  }

  async function removeProcessTransition({ slug, linkId, xml, expectedBpmnSha256, expectedMetaSha256 }) {
    return studio.deleteTransition(slug, {
      linkId,
      xml,
      expectedBpmnSha256,
      expectedMetaSha256
    });
  }

  async function validate({ slug }) {
    return studio.performAction(slug, 'check');
  }

  async function buildHumanMap({ slug }) {
    return studio.performAction(slug, 'open-archify');
  }

  async function updatePackage({ slug }) {
    return studio.performAction(slug, 'update');
  }

  async function registerDraft({ slug }) {
    return studio.performAction(slug, 'register');
  }

  function getCapabilities() {
    return {
      schema: 'business-process-bpmn-mcp-capabilities/v1',
      server: {
        name: 'business-process-bpmn-kit',
        version: serverVersion,
        transport_independent_core: true,
        local_stdio_entrypoint: 'tools/bpmn/bpmn-mcp-server.mjs'
      },
      boundaries: {
        ai_optional: true,
        ai_note: 'Сервер не вызывает модель и не требует AI. Агент может предложить XML, но проверяемый источник хранится в пакете процесса.',
        canonical_source: 'processes/<slug>/bpmn/process.bpmn и processes/<slug>/bpmn/process.meta.json',
        approval_forbidden: true,
        approval_note: 'MCP не утверждает бизнес-процесс и не фиксирует решение владельца. Эти действия выполняет только человек вне MCP.',
        forbidden_tools: [ 'bpmn_approve', 'bpmn_record_owner_decision' ],
        filesystem_scope: 'Только пакеты processes/<slug> и существующие репозиторные операции create/update/register/validate/Archify.'
      },
      resource_uris: {
        catalog: 'bpmn://catalog',
        process_template: 'bpmn://process/{slug}/{meta|xml|questions|links}',
        sections: resourceSections
      },
      concurrency: {
        save_requires_expected_sha256: true,
        transition_requires_expected_bpmn_sha256: true,
        transition_requires_expected_meta_sha256: true,
        atomic_write: true,
        cross_process_mutation_lock: true
      },
      transitions: {
        supported_relations: [ 'call' ],
        supported_target_kinds: [ 'registered', 'reserved', 'unknown' ],
        shared_with_studio: true,
        owner_approval_unchanged: true
      }
    };
  }

  function processLinks(slug) {
    const processData = getProcess(slug, { includeXml: false });
    return {
      schema: 'business-process-bpmn-links/v1',
      process_id: processData.process_id,
      slug: processData.slug,
      links: Array.isArray(processData.meta?.process_links) ? processData.meta.process_links : []
    };
  }

  function readResource(value) {
    let uri;
    try {
      uri = value instanceof URL ? value : new URL(String(value));
    } catch {
      throw studioError('INVALID_RESOURCE_URI', 'URI BPMN-ресурса имеет неверный формат.', 400);
    }
    if (uri.href === 'bpmn://catalog') {
      return {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(listProcesses(), null, 2)
      };
    }
    if (uri.protocol !== 'bpmn:' || uri.hostname !== 'process') {
      throw studioError('INVALID_RESOURCE_URI', 'Поддерживаются только bpmn://catalog и ресурсы bpmn://process/<slug>/<раздел>.', 404);
    }
    let segments;
    try {
      segments = uri.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    } catch {
      throw studioError('INVALID_RESOURCE_URI', 'URI BPMN-ресурса содержит неверное кодирование.', 400);
    }
    if (segments.length !== 2) {
      throw studioError('INVALID_RESOURCE_URI', 'URI процесса должен содержать короткое имя и один раздел ресурса.', 400);
    }
    const [ slug, section ] = segments;
    validateSlug(slug);
    if (!resourceSections.includes(section)) {
      throw studioError('INVALID_RESOURCE_SECTION', 'Раздел ресурса должен быть meta, xml, questions или links.', 404);
    }

    if (section === 'xml') {
      const processData = getProcess(slug, { includeXml: true });
      return { uri: uri.href, mimeType: 'application/xml', text: processData.xml };
    }
    if (section === 'questions') {
      return { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(readQuestions(slug), null, 2) };
    }
    if (section === 'links') {
      return { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(processLinks(slug), null, 2) };
    }
    const processData = getProcess(slug, { includeXml: false });
    return {
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({
        slug: processData.slug,
        sha256: processData.sha256,
        summary: processData.summary,
        status: processData.status,
        views: processData.views,
        meta: processData.meta
      }, null, 2)
    };
  }

  function listProcessResources() {
    const catalog = listProcesses();
    return catalog.processes.flatMap((item) => resourceSections.map((section) => ({
      name: `${item.title}: ${section}`,
      title: `${item.title}: ${section}`,
      uri: `bpmn://process/${encodeURIComponent(item.slug)}/${section}`,
      description: `Раздел ${section} пакета процесса «${item.title}».`,
      mimeType: section === 'xml' ? 'application/xml' : 'application/json'
    })));
  }

  function completeResourceVariable(variable, value) {
    const needle = String(value ?? '').toLocaleLowerCase('ru-RU');
    if (variable === 'section') return resourceSections.filter((section) => section.startsWith(needle));
    if (variable === 'slug') {
      return listProcesses().processes
        .map((item) => item.slug)
        .filter((slug) => slug.startsWith(needle));
    }
    return [];
  }

  return Object.freeze({
    projectRoot,
    getCapabilities,
    listProcesses,
    getProcess,
    createDraft,
    saveXml,
    listTransitionTargets,
    setProcessTransition,
    removeProcessTransition,
    validate,
    buildHumanMap,
    updatePackage,
    registerDraft,
    readResource,
    listProcessResources,
    completeResourceVariable
  });
}

export {
  StudioError,
  createBpmnMcpCore,
  resolveProjectRoot,
  resourceSections,
  serverVersion
};

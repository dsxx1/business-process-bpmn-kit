import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
  StudioError,
  createBpmnMcpCore,
  serverVersion
} from './bpmn-mcp-core.mjs';

const slugSchema = z.string().describe('Короткое имя процесса из processes/<slug>.');
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u).describe('SHA-256 версии, ранее полученной через bpmn_get_process.');
const transitionTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('registered'),
    slug: slugSchema.describe('Короткое имя цели из bpmn_list_transition_targets.')
  }),
  z.object({
    kind: z.literal('reserved'),
    title: z.string().describe('Любое непустое однострочное название будущего процесса.'),
    slug: slugSchema.optional().describe('Необязательное зарезервированное короткое имя; без него строится из названия.')
  }),
  z.object({ kind: z.literal('unknown') })
]);
const toolOutputSchema = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    details: z.unknown().optional()
  }).optional()
});

const readOnlyAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

const createAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
});

const mutationAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
});

function toolSuccess(result, message) {
  return {
    content: [ { type: 'text', text: message } ],
    structuredContent: { ok: true, result }
  };
}

function errorDocument(error) {
  if (error instanceof StudioError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Внутренняя ошибка BPMN MCP. Подробности записаны только в stderr сервера.',
    status: 500
  };
}

function toolFailure(error, onError) {
  if (!(error instanceof StudioError)) onError?.(error);
  const failure = errorDocument(error);
  return {
    isError: true,
    content: [ {
      type: 'text',
      text: `Ошибка ${failure.code}: ${failure.message}`
    } ],
    structuredContent: { ok: false, error: failure }
  };
}

function registerTool(server, name, config, handler, successMessage, onError) {
  server.registerTool(name, {
    ...config,
    outputSchema: toolOutputSchema
  }, async (input) => {
    try {
      return toolSuccess(await handler(input), successMessage);
    } catch (error) {
      return toolFailure(error, onError);
    }
  });
}

function createBpmnMcpServer(options = {}) {
  const core = options.core || createBpmnMcpCore(options);
  const onError = options.onError;
  const server = new McpServer({
    name: 'business-process-bpmn-kit',
    version: serverVersion
  }, {
    instructions: [
      'Локальный сервер управляет только BPMN-пакетами этого проекта.',
      'Сначала вызовите bpmn_get_capabilities.',
      'AI необязателен: канонический источник — файлы пакета процесса.',
      'Техническая проверка или регистрация не являются бизнес-утверждением.',
      'Сервер не предоставляет bpmn_approve и bpmn_record_owner_decision: решение принимает только человек.'
    ].join(' ')
  });

  registerTool(server, 'bpmn_get_capabilities', {
    title: 'Возможности и границы BPMN MCP',
    description: 'Показывает поддерживаемые операции, URI ресурсов и жёсткую границу: AI необязателен, файлы — канонический источник, бизнес-утверждение через MCP запрещено.',
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations
  }, () => core.getCapabilities(), 'Границы и возможности BPMN MCP получены.', onError);

  registerTool(server, 'bpmn_list_processes', {
    title: 'Список BPMN-процессов',
    description: 'Читает каталог безопасных пакетов processes/<slug> с метаданными, статусами, краткой сводкой и SHA-256.',
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations
  }, () => core.listProcesses(), 'Каталог BPMN-процессов получен.', onError);

  registerTool(server, 'bpmn_get_process', {
    title: 'Прочитать BPMN-процесс',
    description: 'Возвращает метаданные, сводку, статусы, SHA-256 и при явном запросе исходный BPMN XML. XML также доступен как ресурс bpmn://process/<slug>/xml.',
    inputSchema: z.object({
      slug: slugSchema,
      include_xml: z.boolean().optional().default(false).describe('Включить исходный BPMN XML в структурированный результат.')
    }),
    annotations: readOnlyAnnotations
  }, ({ slug, include_xml: includeXml }) => core.getProcess(slug, { includeXml }), 'Данные BPMN-процесса получены.', onError);

  registerTool(server, 'bpmn_create_draft', {
    title: 'Создать черновик BPMN-процесса',
    description: 'Атомарно создаёт новый пакет из существующего репозиторного шаблона. Не утверждает и не регистрирует процесс.',
    inputSchema: z.object({
      title: z.string().describe('Любое непустое однострочное название процесса.'),
      slug: slugSchema.optional().describe('Необязательное короткое имя; без него имя строится из названия.')
    }),
    annotations: createAnnotations
  }, (input) => core.createDraft(input), 'Черновик BPMN-процесса создан.', onError);

  registerTool(server, 'bpmn_save_xml', {
    title: 'Безопасно сохранить BPMN XML',
    description: 'Разбирает BPMN XML, запрещает isExecutable=true и сохраняет атомарно только при совпадении expected_sha256 с открытой версией. Повторите чтение после конфликта.',
    inputSchema: z.object({
      slug: slugSchema,
      xml: z.string().describe('Полный BPMN 2.0 XML.'),
      expected_sha256: z.string().describe('SHA-256 версии, ранее полученной через bpmn_get_process.')
    }),
    annotations: mutationAnnotations
  }, ({ slug, xml, expected_sha256: expectedSha256 }) => core.saveXml({ slug, xml, expectedSha256 }), 'BPMN XML безопасно сохранён.', onError);

  registerTool(server, 'bpmn_list_transition_targets', {
    title: 'Получить цели перехода в другой процесс',
    description: 'Возвращает зарегистрированные и уже зарезервированные цели, текущие связи и оба SHA-256. Ничего не изменяет.',
    inputSchema: z.object({ slug: slugSchema }),
    annotations: readOnlyAnnotations
  }, ({ slug }) => core.listTransitionTargets({ slug }), 'Цели перехода и текущие связи получены.', onError);

  registerTool(server, 'bpmn_set_process_transition', {
    title: 'Создать или изменить вызов другого процесса',
    description: 'Одной общей со Studio операцией синхронизирует calledElement и process.meta.json. Поддерживает существующую, будущую или пока неизвестную цель; не утверждает бизнес-содержание.',
    inputSchema: z.object({
      slug: slugSchema,
      link_id: z.string().optional().describe('Передайте существующий LINK-... для изменения; без поля создаётся новый переход.'),
      xml: z.string().describe('Полный BPMN XML из открытой модели; выбранный элемент уже должен быть Call Activity.'),
      expected_bpmn_sha256: sha256Schema,
      expected_meta_sha256: sha256Schema,
      source_element_id: z.string().describe('Смысловой BPMN ID выбранного Call Activity.'),
      relation: z.literal('call').optional().default('call'),
      label: z.string().describe('Понятная русская подпись перехода.'),
      target: transitionTargetSchema
    }),
    annotations: { ...mutationAnnotations, idempotentHint: false }
  }, (input) => core.setProcessTransition({
    slug: input.slug,
    linkId: input.link_id,
    xml: input.xml,
    expectedBpmnSha256: input.expected_bpmn_sha256,
    expectedMetaSha256: input.expected_meta_sha256,
    sourceElementId: input.source_element_id,
    relation: input.relation,
    label: input.label,
    target: input.target
  }), 'Переход в другой процесс сохранён атомарно.', onError);

  registerTool(server, 'bpmn_remove_process_transition', {
    title: 'Удалить вызов другого процесса',
    description: 'Одной общей со Studio операцией удаляет process link после того, как бывший Call Activity уже превращён в обычную Task или удалён из переданного XML. Карточку будущего процесса не удаляет, чтобы не потерять заметки.',
    inputSchema: z.object({
      slug: slugSchema,
      link_id: z.string().describe('Идентификатор LINK-... удаляемого перехода.'),
      xml: z.string().describe('Полный BPMN XML из открытой модели.'),
      expected_bpmn_sha256: sha256Schema,
      expected_meta_sha256: sha256Schema
    }),
    annotations: { ...mutationAnnotations, idempotentHint: false }
  }, (input) => core.removeProcessTransition({
    slug: input.slug,
    linkId: input.link_id,
    xml: input.xml,
    expectedBpmnSha256: input.expected_bpmn_sha256,
    expectedMetaSha256: input.expected_meta_sha256
  }), 'Переход в другой процесс удалён атомарно.', onError);

  registerTool(server, 'bpmn_validate', {
    title: 'Технически проверить BPMN-пакет',
    description: 'Запускает существующие package validation и bpmnlint. Успешная проверка не является бизнес-утверждением.',
    inputSchema: z.object({ slug: slugSchema }),
    annotations: readOnlyAnnotations
  }, ({ slug }) => core.validate({ slug }), 'Техническая проверка BPMN-пакета завершена.', onError);

  registerTool(server, 'bpmn_build_human_map', {
    title: 'Собрать человекочитаемую карту',
    description: 'Вызывает существующий локальный адаптер Archify и обновляет производную карту. BPMN XML остаётся каноническим источником.',
    inputSchema: z.object({ slug: slugSchema }),
    annotations: mutationAnnotations
  }, ({ slug }) => core.buildHumanMap({ slug }), 'Человекочитаемая карта собрана.', onError);

  registerTool(server, 'bpmn_update_package', {
    title: 'Обновить зарегистрированный BPMN-пакет',
    description: 'Вызывает существующий репозиторный мастер обновления, проверки и синхронизации производных файлов. Может изменить несколько файлов проекта.',
    inputSchema: z.object({ slug: slugSchema }),
    annotations: mutationAnnotations
  }, ({ slug }) => core.updatePackage({ slug }), 'BPMN-пакет обновлён.', onError);

  registerTool(server, 'bpmn_register_draft', {
    title: 'Зарегистрировать технически готовый черновик',
    description: 'Вызывает существующий репозиторный мастер регистрации. Регистрация не утверждает бизнес-содержание и не фиксирует решение владельца.',
    inputSchema: z.object({ slug: slugSchema }),
    annotations: { ...mutationAnnotations, idempotentHint: false }
  }, ({ slug }) => core.registerDraft({ slug }), 'Черновик зарегистрирован; бизнес-утверждение не выполнялось.', onError);

  server.registerResource('bpmn-process-catalog', 'bpmn://catalog', {
    title: 'Каталог BPMN-процессов',
    description: 'Сводный каталог безопасно прочитанных пакетов с SHA-256 и статусами.',
    mimeType: 'application/json'
  }, async (uri) => ({ contents: [ core.readResource(uri) ] }));

  const processResourceTemplate = new ResourceTemplate('bpmn://process/{slug}/{section}', {
    list: async () => ({ resources: core.listProcessResources() }),
    complete: {
      slug: (value) => core.completeResourceVariable('slug', value),
      section: (value) => core.completeResourceVariable('section', value)
    }
  });
  server.registerResource('bpmn-process-resource', processResourceTemplate, {
    title: 'Ресурс BPMN-процесса',
    description: 'Раздел meta, xml, questions или links пакета processes/<slug>.',
    mimeType: 'application/json'
  }, async (uri) => ({ contents: [ core.readResource(uri) ] }));

  return server;
}

export {
  createBpmnMcpServer,
  errorDocument,
  toolOutputSchema
};

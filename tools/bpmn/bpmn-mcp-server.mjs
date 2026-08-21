#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createBpmnMcpCore } from './bpmn-mcp-core.mjs';
import { createBpmnMcpServer, errorDocument } from './bpmn-mcp-protocol.mjs';
import { studioError } from './studio-core.mjs';

const usageText = [
  'Локальный BPMN MCP stdio server.',
  '',
  'Запуск:',
  '  node tools/bpmn/bpmn-mcp-server.mjs --project-root <путь-к-проекту>',
  '',
  'Вместо аргумента можно задать BPMN_PROJECT_ROOT.'
].join('\n');

function parseServerArguments(argv = process.argv.slice(2), env = process.env) {
  let projectRoot;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--project-root') {
      if (projectRoot !== undefined) {
        throw studioError('DUPLICATE_PROJECT_ROOT', 'Аргумент --project-root указан больше одного раза.', 400);
      }
      const value = argv[index + 1];
      if (value === undefined || String(value).startsWith('--')) {
        throw studioError('PROJECT_ROOT_REQUIRED', 'После --project-root укажите путь к BPMN-проекту.', 400);
      }
      projectRoot = String(value);
      index += 1;
      continue;
    }
    if (argument.startsWith('--project-root=')) {
      if (projectRoot !== undefined) {
        throw studioError('DUPLICATE_PROJECT_ROOT', 'Аргумент --project-root указан больше одного раза.', 400);
      }
      projectRoot = argument.slice('--project-root='.length);
      continue;
    }
    throw studioError('UNKNOWN_ARGUMENT', `Неизвестный аргумент BPMN MCP: ${argument}`, 400);
  }
  return {
    help,
    projectRoot: projectRoot ?? env.BPMN_PROJECT_ROOT
  };
}

function writeDiagnostic(error, stream = process.stderr) {
  stream.write(`${JSON.stringify({ ok: false, error: errorDocument(error) })}\n`);
}

function startBpmnMcpServer(options = {}) {
  const settings = parseServerArguments(options.argv, options.env);
  if (settings.help) return { help: true, usage: usageText, handle: null };

  const core = createBpmnMcpCore({
    projectRoot: settings.projectRoot,
    commandRunner: options.commandRunner,
    archifyAdapterPath: options.archifyAdapterPath
  });
  const reportError = (error) => writeDiagnostic(error, options.stderr || process.stderr);
  const handle = serveStdio(() => createBpmnMcpServer({ core, onError: reportError }), {
    legacy: 'serve',
    onerror: reportError,
    ...(options.transport ? { transport: options.transport } : {})
  });
  return { help: false, handle, core };
}

async function main() {
  let started;
  try {
    started = startBpmnMcpServer();
    if (started.help) {
      process.stderr.write(`${started.usage}\n`);
      return;
    }
  } catch (error) {
    writeDiagnostic(error);
    process.exitCode = 1;
    return;
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await started.handle?.close();
    } catch (error) {
      writeDiagnostic(error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

export {
  main,
  parseServerArguments,
  startBpmnMcpServer,
  usageText,
  writeDiagnostic
};

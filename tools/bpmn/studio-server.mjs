import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { createStudioCore, StudioError, studioError } from './studio-core.mjs';
import { defaultVendoredBpmnJsRoot, verifyVendoredBpmnJs } from './verify-bpmn-js-vendor.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_JSON_BYTES = 7 * 1024 * 1024;
const defaultUiRoot = resolve(import.meta.dirname, 'studio-ui');
const defaultBpmnJsRoot = defaultVendoredBpmnJsRoot;

const mimeTypes = new Map([
  [ '.css', 'text/css; charset=utf-8' ],
  [ '.eot', 'application/vnd.ms-fontobject' ],
  [ '.html', 'text/html; charset=utf-8' ],
  [ '.js', 'text/javascript; charset=utf-8' ],
  [ '.json', 'application/json; charset=utf-8' ],
  [ '.png', 'image/png' ],
  [ '.svg', 'image/svg+xml' ],
  [ '.ttf', 'font/ttf' ],
  [ '.woff', 'font/woff' ],
  [ '.woff2', 'font/woff2' ]
]);

function applySecurityHeaders(response, { html = false } = {}) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');
  if (html) {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'"
    );
  }
}

function sendJson(response, status, payload) {
  applySecurityHeaders(response);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendError(response, error) {
  const known = error instanceof StudioError;
  sendJson(response, known ? error.status : 500, {
    ok: false,
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'Внутренняя ошибка локальной BPMN-студии.',
      ...(known && error.details !== undefined ? { details: error.details } : {})
    }
  });
}

function constantTimeTokenEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function tokenFromRequest(request, url) {
  const authorization = String(request.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7);
  const header = request.headers['x-studio-token'];
  if (Array.isArray(header)) return header[0] || '';
  if (header) return String(header);
  return url.searchParams.get('token') || '';
}

function authorizeRequest(request, url, expectedToken, expectedOrigin) {
  const host = String(request.headers.host || '');
  if (host !== expectedOrigin.slice('http://'.length)) {
    throw studioError('INVALID_HOST', 'Запрос направлен не на локальный адрес BPMN-студии.', 403);
  }
  const origin = request.headers.origin;
  if (origin && origin !== expectedOrigin) {
    throw studioError('INVALID_ORIGIN', 'BPMN-студия принимает запросы только со своей локальной страницы.', 403);
  }
  if (!constantTimeTokenEqual(tokenFromRequest(request, url), expectedToken)) {
    throw studioError('UNAUTHORIZED', 'Не найден действующий ключ этой локальной сессии BPMN-студии.', 401);
  }
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw studioError('UNSUPPORTED_CONTENT_TYPE', 'Тело запроса должно быть JSON.', 415);
  }
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw studioError('REQUEST_TOO_LARGE', 'Запрос больше допустимых 7 МБ.', 413);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_JSON_BYTES) throw studioError('REQUEST_TOO_LARGE', 'Запрос больше допустимых 7 МБ.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw studioError('INVALID_JSON_BODY', `JSON не разобран: ${error.message}`, 400);
  }
}

function decodeRoutePart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw studioError('INVALID_URL', `${label} содержит неверное кодирование.`, 400);
  }
}

function safeStaticPath(root, relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw studioError('UNSAFE_STATIC_PATH', 'Недопустимый путь статического файла.', 400);
  }
  const target = resolve(root, ...normalized.split('/'));
  const relation = relative(root, target);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw studioError('UNSAFE_STATIC_PATH', 'Недопустимый путь статического файла.', 400);
  }
  if (!existsSync(target)) throw studioError('STATIC_NOT_FOUND', 'Файл интерфейса не найден.', 404);
  const entry = lstatSync(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw studioError('UNSAFE_STATIC_PATH', 'Разрешены только обычные файлы интерфейса.', 400);
  }
  return target;
}

function sendFile(response, path) {
  const body = readFileSync(path);
  const contentType = mimeTypes.get(extname(path).toLowerCase()) || 'application/octet-stream';
  applySecurityHeaders(response, { html: contentType.startsWith('text/html') });
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length
  });
  response.end(body);
}

function withAuthorizedViewUrls(processData, token) {
  const clone = structuredClone(processData);
  for (const view of Object.values(clone.views || {})) {
    if (view.url) view.url = `${view.url}?token=${encodeURIComponent(token)}`;
  }
  return clone;
}

function processListWithAuthorizedUrls(result, token) {
  return {
    ...result,
    items: result.items.map((item) => withAuthorizedViewUrls(item, token))
  };
}

function vendorAsset(pathname) {
  const aliases = new Map([
    [ '/vendor/bpmn-modeler.js', 'bpmn-modeler.production.min.js' ],
    [ '/vendor/diagram-js.css', 'assets/diagram-js.css' ],
    [ '/vendor/bpmn-js.css', 'assets/bpmn-js.css' ],
    [ '/vendor/bpmn-font/css/bpmn.css', 'assets/bpmn-font/css/bpmn.css' ]
  ]);
  if (aliases.has(pathname)) return aliases.get(pathname);
  const fontPrefix = '/vendor/bpmn-font/';
  if (pathname.startsWith(fontPrefix)) return `assets/bpmn-font/${pathname.slice(fontPrefix.length)}`;
  const prefix = '/vendor/bpmn-js/';
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  return null;
}

function createRequestHandler({ core, token, origin, uiRoot, bpmnJsRoot }) {
  return async (request, response) => {
    try {
      if (!request.url || request.url.length > 8192) throw studioError('INVALID_URL', 'Адрес запроса слишком длинный.', 414);
      const url = new URL(request.url, origin);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/') || pathname.startsWith('/view/')) {
        authorizeRequest(request, url, token, origin);
      }

      if (request.method === 'GET' && pathname === '/api/bootstrap') {
        const processes = processListWithAuthorizedUrls(core.listProcesses(), token);
        sendJson(response, 200, {
          ok: true,
          api_version: 'bpmn-studio/v1',
          local_only: true,
          ai_required: false,
          max_bpmn_bytes: 6 * 1024 * 1024,
          supported_actions: [ 'check', 'register', 'update', 'open-archify' ],
          transition_contract: {
            schema: 'bpmn-studio-transition-targets/v1',
            supported_relations: [ 'call' ],
            supported_target_kinds: [ 'registered', 'reserved', 'unknown' ]
          },
          processes: processes.items,
          skipped: processes.skipped
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/processes') {
        const processes = processListWithAuthorizedUrls(core.listProcesses(), token);
        sendJson(response, 200, { ok: true, processes: processes.items, skipped: processes.skipped });
        return;
      }

      const processMatch = pathname.match(/^\/api\/process\/([^/]+)$/u);
      if (request.method === 'GET' && processMatch) {
        const slug = decodeRoutePart(processMatch[1], 'Короткое имя процесса');
        sendJson(response, 200, { ok: true, process: withAuthorizedViewUrls(core.readProcess(slug), token) });
        return;
      }

      const saveMatch = pathname.match(/^\/api\/process\/([^/]+)\/bpmn$/u);
      if (request.method === 'PUT' && saveMatch) {
        const slug = decodeRoutePart(saveMatch[1], 'Короткое имя процесса');
        const body = await readJsonBody(request);
        const result = await core.saveBpmn(slug, {
          xml: body.xml,
          expectedSha256: body.expectedSha256 ?? body.expected_sha256
        });
        result.process = withAuthorizedViewUrls(result.process, token);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      const transitionTargetsMatch = pathname.match(/^\/api\/process\/([^/]+)\/transition-targets$/u);
      if (request.method === 'GET' && transitionTargetsMatch) {
        const slug = decodeRoutePart(transitionTargetsMatch[1], 'Короткое имя процесса');
        sendJson(response, 200, { ok: true, ...core.listTransitionTargets(slug) });
        return;
      }

      const transitionsMatch = pathname.match(/^\/api\/process\/([^/]+)\/transitions$/u);
      if (request.method === 'POST' && transitionsMatch) {
        const slug = decodeRoutePart(transitionsMatch[1], 'Короткое имя процесса');
        const body = await readJsonBody(request);
        const result = await core.saveTransition(slug, {
          xml: body.xml,
          expectedBpmnSha256: body.expectedBpmnSha256 ?? body.expected_bpmn_sha256,
          expectedMetaSha256: body.expectedMetaSha256 ?? body.expected_meta_sha256,
          sourceElementId: body.sourceElementId ?? body.source_element_id,
          relation: body.relation,
          label: body.label,
          target: body.target
        });
        result.process = withAuthorizedViewUrls(result.process, token);
        sendJson(response, 201, { ok: true, ...result });
        return;
      }

      const transitionMatch = pathname.match(/^\/api\/process\/([^/]+)\/transitions\/([^/]+)$/u);
      if ((request.method === 'PUT' || request.method === 'DELETE') && transitionMatch) {
        const slug = decodeRoutePart(transitionMatch[1], 'Короткое имя процесса');
        const linkId = decodeRoutePart(transitionMatch[2], 'Идентификатор перехода');
        const body = await readJsonBody(request);
        const common = {
          linkId,
          xml: body.xml,
          expectedBpmnSha256: body.expectedBpmnSha256 ?? body.expected_bpmn_sha256,
          expectedMetaSha256: body.expectedMetaSha256 ?? body.expected_meta_sha256
        };
        const result = request.method === 'PUT'
          ? await core.saveTransition(slug, {
            ...common,
            sourceElementId: body.sourceElementId ?? body.source_element_id,
            relation: body.relation,
            label: body.label,
            target: body.target
          })
          : await core.deleteTransition(slug, common);
        result.process = withAuthorizedViewUrls(result.process, token);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/processes') {
        const body = await readJsonBody(request);
        const result = await core.createProcess({ title: body.title, slug: body.slug });
        result.process = withAuthorizedViewUrls(result.process, token);
        sendJson(response, 201, { ok: true, ...result });
        return;
      }

      const actionBodyMatch = pathname.match(/^\/api\/process\/([^/]+)\/action$/u);
      if (request.method === 'POST' && actionBodyMatch) {
        const slug = decodeRoutePart(actionBodyMatch[1], 'Короткое имя процесса');
        const body = await readJsonBody(request);
        const result = await core.performAction(slug, body.action);
        if (result.process) result.process = withAuthorizedViewUrls(result.process, token);
        if (result.view?.url) result.view.url = `${result.view.url}?token=${encodeURIComponent(token)}`;
        sendJson(response, 200, { ok: true, result });
        return;
      }

      const actionPathMatch = pathname.match(/^\/api\/process\/([^/]+)\/actions\/([^/]+)$/u);
      if (request.method === 'POST' && actionPathMatch) {
        const slug = decodeRoutePart(actionPathMatch[1], 'Короткое имя процесса');
        const action = decodeRoutePart(actionPathMatch[2], 'Действие');
        const result = await core.performAction(slug, action);
        if (result.process) result.process = withAuthorizedViewUrls(result.process, token);
        if (result.view?.url) result.view.url = `${result.view.url}?token=${encodeURIComponent(token)}`;
        sendJson(response, 200, { ok: true, result });
        return;
      }

      const viewMatch = pathname.match(/^\/view\/([^/]+)\/(archify|navigation)$/u);
      if (request.method === 'GET' && viewMatch) {
        const slug = decodeRoutePart(viewMatch[1], 'Короткое имя процесса');
        sendFile(response, core.resolveView(slug, viewMatch[2]));
        return;
      }

      if (request.method === 'GET') {
        const vendor = vendorAsset(pathname);
        if (vendor) {
          sendFile(response, safeStaticPath(bpmnJsRoot, vendor));
          return;
        }
        const uiRelative = pathname === '/' ? 'index.html' : pathname.slice(1);
        sendFile(response, safeStaticPath(uiRoot, uiRelative));
        return;
      }

      throw studioError('ROUTE_NOT_FOUND', 'Такого действия в локальной BPMN-студии нет.', 404);
    } catch (error) {
      sendError(response, error);
    }
  };
}

function listen(server, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectPromise(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolvePromise();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

function closeServer(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
    server.closeIdleConnections?.();
  });
}

async function startStudioServer(options = {}) {
  const core = options.core || createStudioCore({ projectRoot: options.projectRoot });
  const token = String(options.token || randomBytes(32).toString('base64url'));
  if (Buffer.byteLength(token, 'utf8') < 32) throw new Error('Ключ локальной сессии должен содержать не менее 32 байт.');
  const uiRoot = resolve(options.uiRoot || defaultUiRoot);
  const bpmnJsRoot = resolve(options.bpmnJsRoot || defaultBpmnJsRoot);
  verifyVendoredBpmnJs(bpmnJsRoot);
  const server = createServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;

  await listen(server, options.port ?? 0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Не удалось определить локальный порт BPMN-студии.');
  }
  const origin = `http://${LOOPBACK_HOST}:${address.port}`;
  server.on('request', createRequestHandler({ core, token, origin, uiRoot, bpmnJsRoot }));
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return {
    server,
    core,
    token,
    host: LOOPBACK_HOST,
    port: address.port,
    origin,
    url: `${origin}/?token=${encodeURIComponent(token)}`,
    close: () => closeServer(server)
  };
}

function parseCliArguments(argv) {
  const options = { port: 0, open: true, sessionFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-open') {
      options.open = false;
      continue;
    }
    if (argument === '--open') {
      options.open = true;
      continue;
    }
    if (argument === '--port') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Для --port нужен номер от 0 до 65535.');
      options.port = value;
      index += 1;
      continue;
    }
    if (argument === '--session-file') {
      const value = argv[index + 1];
      if (!value) throw new Error('Для --session-file нужен путь к файлу локальной сессии.');
      options.sessionFile = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Неизвестный параметр: ${argument}`);
  }
  return options;
}

function openInDefaultBrowser(url) {
  const executable = process.platform === 'win32'
    ? 'rundll32.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? [ 'url.dll,FileProtocolHandler', url ] : [ url ];
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
  child.unref();
  child.on('error', () => undefined);
}

function publishSessionFile(sessionFile, studio, projectRoot) {
  if (!sessionFile) return;
  mkdirSync(dirname(sessionFile), { recursive: true });
  const descriptor = {
    schema: 'bpmn-studio-local-session/v1',
    pid: process.pid,
    project_root: resolve(projectRoot),
    origin: studio.origin,
    url: studio.url,
    token: studio.token,
    started_at: new Date().toISOString()
  };
  let descriptorHandle;
  try {
    descriptorHandle = openSync(sessionFile, 'wx', 0o600);
    writeFileSync(descriptorHandle, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
    fsyncSync(descriptorHandle);
  } finally {
    if (descriptorHandle !== undefined) closeSync(descriptorHandle);
  }
}

function removeOwnedSessionFile(sessionFile, studio) {
  if (!sessionFile || !existsSync(sessionFile)) return;
  try {
    const stat = lstatSync(sessionFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const current = JSON.parse(readFileSync(sessionFile, 'utf8'));
    if (current.pid === process.pid && current.token === studio.token) {
      rmSync(sessionFile, { force: true });
    }
  } catch {
    // A broken descriptor is left for the next launcher to diagnose safely.
  }
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Локальная BPMN-студия\n\n  node studio-server.mjs [--port 0] [--open|--no-open] [--session-file PATH]');
    return;
  }
  const projectRoot = resolve(import.meta.dirname, '..', '..');
  const studio = await startStudioServer({ port: options.port, projectRoot });
  try {
    publishSessionFile(options.sessionFile, studio, projectRoot);
  } catch (error) {
    await studio.close();
    throw error;
  }
  console.log(JSON.stringify({ status: 'ready', url: studio.url, host: studio.host, port: studio.port }));
  console.log(`BPMN-студия работает только на этом компьютере: ${studio.url}`);
  if (options.open) openInDefaultBrowser(studio.url);

  const stop = async () => {
    try {
      await studio.close();
    } finally {
      removeOwnedSessionFile(options.sessionFile, studio);
      process.exit(0);
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Ошибка запуска BPMN-студии: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  LOOPBACK_HOST,
  createRequestHandler,
  openInDefaultBrowser,
  parseCliArguments,
  publishSessionFile,
  removeOwnedSessionFile,
  startStudioServer
};

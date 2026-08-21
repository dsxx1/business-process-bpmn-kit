import { existsSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  const options = {
    check: false,
    registry: resolve(projectRoot, 'registry', 'processes.json'),
    output: resolve(projectRoot, 'catalog.html')
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--registry') options.registry = resolve(args[++index] || fail('После --registry нужен путь.'));
    else if (argument === '--output') options.output = resolve(args[++index] || fail('После --output нужен путь.'));
    else if (argument === '--help') options.help = true;
    else fail(`Неизвестный аргумент: ${argument}`);
  }
  return options;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function ensureContained(path, base, label) {
  const resolvedPath = resolve(path);
  const resolvedBase = resolve(base);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(`${resolvedBase}${sep}`)) {
    fail(`${label} должен находиться внутри проекта: ${resolvedPath}`);
  }
  return resolvedPath;
}

function portableLink(fromFile, projectRef) {
  const target = ensureContained(resolve(projectRoot, projectRef), projectRoot, 'Ссылка реестра');
  return relative(dirname(fromFile), target).split(sep).join('/');
}

function statusLabel(entry) {
  if (entry.business_status === 'canonical' && entry.status === 'approved') return 'Решение владельца зафиксировано';
  if (entry.business_status === 'rejected' || entry.status === 'rejected') return 'Отклонён владельцем';
  if (entry.status === 'rework') return 'На доработке';
  if (entry.status === 'review-ready') return 'Готов к содержательной проверке';
  return 'Черновик';
}

function buildCatalog(registry, outputPath) {
  const processes = [ ...registry.processes ].sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  const cards = processes.map((entry) => {
    const navigationHref = portableLink(outputPath, entry.navigation_ref);
    const bpmnHref = portableLink(outputPath, entry.bpmn_ref);
    const metaHref = portableLink(outputPath, entry.meta_ref);
    return `      <article class="process-card">
        <span class="status">${escapeHtml(statusLabel(entry))}</span>
        <h2>${escapeHtml(entry.title)}</h2>
        <p>Откройте подробную BPMN-схему и переходы в связанные процессы.</p>
        <div class="actions">
          <a class="primary" href="${escapeHtml(navigationHref)}">Открыть процесс</a>
          <a href="${escapeHtml(bpmnHref)}">Исходный BPMN</a>
          <a href="${escapeHtml(metaHref)}">Технические сведения</a>
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Каталог бизнес-процессов</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", Arial, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f6fa; color: #172033; }
    header { background: #12233f; color: white; padding: 34px max(24px, calc((100vw - 1060px) / 2)); }
    header h1 { margin: 0 0 10px; font-size: clamp(28px, 4vw, 42px); }
    header p { margin: 0; max-width: 780px; color: #cbd8ea; font-size: 18px; line-height: 1.5; }
    main { max-width: 1060px; margin: 0 auto; padding: 24px; }
    .back { display: inline-block; margin-bottom: 18px; color: #1558d6; font-weight: 700; }
    .notice { padding: 15px 18px; border: 1px solid #d7e0ec; border-radius: 12px; background: white; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; margin-top: 18px; }
    .process-card { padding: 22px; background: white; border: 1px solid #d7e0ec; border-radius: 12px; box-shadow: 0 8px 24px rgba(20,45,80,.06); }
    .process-card h2 { margin: 10px 0; font-size: 21px; }
    .process-card p { color: #536176; line-height: 1.5; }
    .status { display: inline-block; padding: 5px 9px; border-radius: 999px; background: #e9f1ff; color: #164b9f; font-size: 13px; font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
    .actions a { color: #1558d6; font-weight: 700; }
    .actions .primary { padding: 9px 12px; border-radius: 8px; background: #1558d6; color: white; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <h1>Каталог бизнес-процессов</h1>
    <p>Все зарегистрированные схемы в одном месте. Статус показывает готовность бизнес-содержания, а не факт запуска в BPMN-движке.</p>
  </header>
  <main>
    <a class="back" href="index.html">← На стартовую страницу</a>
    <div class="notice">Процесс может быть доступен как черновик для обсуждения. Для производственной автоматизации используйте только пакет с зафиксированным решением владельца, подтверждённый обязательным согласованием Merge Request в GitLab.</div>
    <section class="grid" aria-label="Зарегистрированные бизнес-процессы">
${cards || '      <p>Зарегистрированных процессов пока нет.</p>'}
    </section>
  </main>
</body>
</html>
`;
}

function writeAtomically(outputPath, content) {
  const mode = existsSync(outputPath) ? undefined : 0o644;
  let descriptor;
  let tempPath;
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      tempPath = resolve(dirname(outputPath), `.${relative(dirname(outputPath), outputPath)}.${process.pid}.${attempt}.tmp`);
      try {
        descriptor = openSync(tempPath, 'wx', mode);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (descriptor === undefined) fail('Не удалось создать временный файл каталога.');
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(tempPath, outputPath);
    tempPath = undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (tempPath && existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Использование: node build-catalog.mjs [--check] [--registry путь] [--output путь]');
    return;
  }
  const registryPath = ensureContained(options.registry, projectRoot, 'Реестр');
  const outputPath = ensureContained(options.output, projectRoot, 'Каталог');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  if (!Array.isArray(registry.processes)) fail('В реестре отсутствует массив processes.');
  const content = buildCatalog(registry, outputPath).replace(/\r\n?/gu, '\n');

  if (options.check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== content) {
      fail(`Каталог устарел: ${relative(projectRoot, outputPath).split(sep).join('/')}`);
    }
    console.log(JSON.stringify({ status: 'passed', mode: 'check', processes: registry.processes.length }, null, 2));
    return;
  }

  writeAtomically(outputPath, content);
  console.log(JSON.stringify({
    status: 'built',
    output: relative(projectRoot, outputPath).split(sep).join('/'),
    processes: registry.processes.length
  }, null, 2));
}

main();

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';

import { buildRegistryIndex, resolveProcessTarget } from './process-link-resolver.mjs';

const toolRoot = resolve(import.meta.dirname, '..', '..');
const packageRoot = resolve(process.argv[2] || '../../processes/skupka-zolota/bpmn');
const derivedRoot = resolve(packageRoot, 'derived');
const outputPath = resolve(derivedRoot, 'process-navigation.html');
const meta = JSON.parse(readFileSync(resolve(packageRoot, 'process.meta.json'), 'utf8'));
const registry = JSON.parse(readFileSync(resolve(toolRoot, 'registry', 'processes.json'), 'utf8'));
const registryIndex = buildRegistryIndex(registry);
let svg = readFileSync(resolve(derivedRoot, 'process.svg'), 'utf8')
  .replace(/\r\n?/gu, '\n')
  .replace(/^<\?xml[^>]*>\s*/u, '');

function hrefFor(targetRef) {
  if (!targetRef) return null;
  return relative(dirname(outputPath), resolve(toolRoot, targetRef)).replaceAll('\\', '/');
}

function withNavigation(target) {
  const resolved = resolveProcessTarget(target, registryIndex);
  return { ...resolved, target_href: hrefFor(resolved.navigation_target_ref) };
}

const links = meta.process_links.map((link) => ({
  ...withNavigation(link),
  candidate_targets: link.candidate_targets.map(withNavigation)
}));
const embeddedLinks = JSON.stringify(links).replaceAll('<', '\\u003c');
const title = meta.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · подробная BPMN-схема</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", Arial, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #172033; }
    header { padding: 18px 24px; background: #172033; color: white; }
    header h1 { margin: 0 0 6px; font-size: 22px; }
    header p { margin: 0; color: #ced7e6; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; padding: 16px; }
    #diagram { min-height: 720px; overflow: auto; background: white; border: 1px solid #d9e0ea; border-radius: 10px; padding: 12px; }
    #diagram svg { min-width: 1400px; height: auto; }
    aside { align-self: start; position: sticky; top: 16px; background: white; border: 1px solid #d9e0ea; border-radius: 10px; padding: 18px; }
    aside h2 { margin-top: 0; font-size: 18px; }
    .status { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #fff4cc; color: #6d4c00; font-size: 12px; }
    .hint { color: #596579; line-height: 1.45; }
    .link-card { margin-top: 12px; padding: 12px; border: 1px solid #cbd7e7; border-radius: 8px; }
    .link-card > * + * { margin-top: 7px; }
    .link-card a { color: #1558d6; font-weight: 700; }
    .unresolved { color: #a12a2a; }
    .process-link { cursor: pointer; }
    .process-link .djs-visual > :first-child { stroke: #1558d6 !important; stroke-width: 3px !important; }
    .selected-link .djs-visual > :first-child { fill: #e7f0ff !important; }
    details { margin-top: 18px; color: #5c6878; }
    code { word-break: break-all; }
    @media (max-width: 980px) { main { grid-template-columns: 1fr; } aside { position: static; } }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p>Подробная BPMN 2.0. Выберите выделенный шаг, чтобы открыть связанный процесс.</p>
  </header>
  <main>
    <section id="diagram">${svg}</section>
    <aside>
      <span class="status">Рабочая модель · ожидает бизнес-утверждения</span>
      <h2 id="panel-title">Связи с другими процессами</h2>
      <div id="panel" class="hint">Синим контуром отмечены шаги, которые вызывают другой процесс, передают ему работу или отправляют уведомление.</div>
      <details>
        <summary>Технические данные</summary>
        <p>Смысловой ID: <code>${meta.process_id}</code></p>
        <p>Версия модели: <code>${meta.version}</code></p>
        <p>Исполняемая: <code>${meta.bpmn.is_executable ? 'Да' : 'Нет'}</code></p>
      </details>
    </aside>
  </main>
  <script>
    const links = ${embeddedLinks};
    const grouped = new Map();
    for (const link of links) {
      const current = grouped.get(link.source_element_id) || [];
      current.push(link);
      grouped.set(link.source_element_id, current);
    }

    const panel = document.getElementById('panel');
    const panelTitle = document.getElementById('panel-title');
    const escapeHtml = (value) => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

    function statusText(status) {
      if (status === 'canonical') return 'утверждён';
      if (status === 'candidate') return 'найден кандидат, требуется подтверждение';
      return 'цель пока не определена';
    }

    function renderTarget(label, status, processId, href, resolution) {
      const safeLabel = escapeHtml(label || 'Связанный процесс');
      const actionLabel = resolution === 'registered_bpmn' ? 'Открыть подробную схему процесса' : 'Открыть рабочую карточку процесса';
      const action = href
        ? '<a href="' + encodeURI(href) + '">' + actionLabel + '</a>'
        : '<span class="unresolved">Связанный процесс пока не определён</span>';
      const id = processId ? '<details><summary>Технический ID</summary><code>' + escapeHtml(processId) + '</code></details>' : '';
      return '<div class="link-card"><strong>' + safeLabel + '</strong><div>Состояние: ' + escapeHtml(statusText(status)) + '</div><div>' + action + '</div>' + id + '</div>';
    }

    function select(elementId) {
      document.querySelectorAll('.selected-link').forEach((node) => node.classList.remove('selected-link'));
      const element = document.querySelector('[data-element-id="' + CSS.escape(elementId) + '"]');
      element?.classList.add('selected-link');
      const selected = grouped.get(elementId) || [];
      panelTitle.textContent = 'Куда ведёт выбранный шаг';
      panel.innerHTML = selected.map((link) => {
        const direct = renderTarget(link.label, link.target_status, link.target_process_id, link.target_href, link.target_resolution);
        const candidates = link.candidate_targets.map((target) => renderTarget(target.title, target.target_status, target.target_process_id, target.target_href, target.target_resolution)).join('');
        return direct + candidates;
      }).join('');
    }

    for (const [ elementId ] of grouped) {
      const element = document.querySelector('[data-element-id="' + CSS.escape(elementId) + '"]');
      if (!element) continue;
      element.classList.add('process-link');
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.addEventListener('click', () => select(elementId));
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') select(elementId);
      });
    }

    function runNavigationSelfTest() {
      let passed = true;
      for (const [ elementId, elementLinks ] of grouped) {
        select(elementId);
        const expectedCards = elementLinks.reduce((sum, link) => sum + 1 + link.candidate_targets.length, 0);
        if (panel.querySelectorAll('.link-card').length !== expectedCards) passed = false;
      }
      const expectedLinkedElements = grouped.size;
      const actualLinkedElements = document.querySelectorAll('.process-link').length;
      document.documentElement.dataset.navigationTest = passed && actualLinkedElements === expectedLinkedElements ? 'passed' : 'failed';
      document.documentElement.dataset.linkedElements = String(actualLinkedElements);
    }

    runNavigationSelfTest();
  </script>
</body>
</html>`;

mkdirSync(derivedRoot, { recursive: true });
writeFileSync(outputPath, html.replace(/\r\n?/gu, '\n'), 'utf8');
console.log(JSON.stringify({
  status: 'built',
  title: meta.title,
  output: relative(toolRoot, outputPath).replaceAll('\\', '/'),
  process_links: links.length,
  linked_elements: new Set(links.map((link) => link.source_element_id)).size
}, null, 2));

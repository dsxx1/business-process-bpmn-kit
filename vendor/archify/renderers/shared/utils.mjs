const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

export function renderDefinitions() {
  return `        <!-- Definitions -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-default" />
          </marker>
          <marker id="arrowhead-emphasis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-emphasis" />
          </marker>
          <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-security" />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-dashed" />
          </marker>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>
        </defs>`;
}

const SIGIL_TONE = {
  frontend: 'frontend',
  start: 'frontend',
  backend: 'backend',
  active: 'backend',
  database: 'database',
  success: 'database',
  cloud: 'cloud',
  waiting: 'cloud',
  security: 'security',
  failure: 'security',
  messagebus: 'messagebus',
  external: 'external',
  neutral: 'external',
};

const SIGIL_SHAPE = {
  frontend: `<rect x="2" y="3" width="12" height="10" rx="2"/>
            <path d="M2 6.5h12"/>
            <circle cx="4.1" cy="4.8" r=".7" class="sigil-fill"/>
            <circle cx="6.3" cy="4.8" r=".7" class="sigil-fill"/>`,
  backend: `<path d="M6 3 3 8l3 5M10 3l3 5-3 5"/>`,
  database: `<ellipse cx="8" cy="4" rx="5" ry="2"/>
            <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>`,
  cloud: `<path d="M4.3 12.5h7.3a2.4 2.4 0 0 0 .2-4.8 4 4 0 0 0-7.5-1.3A3.1 3.1 0 0 0 4.3 12.5Z"/>`,
  security: `<path d="M8 2.2 13 4v3.5c0 3.1-1.8 5.4-5 6.5-3.2-1.1-5-3.4-5-6.5V4Z"/>
            <path d="m5.8 8 1.5 1.5 3-3"/>`,
  messagebus: `<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>
            <circle cx="5" cy="4.5" r="1" class="sigil-fill"/>
            <circle cx="10.5" cy="8" r="1" class="sigil-fill"/>
            <circle cx="7" cy="11.5" r="1" class="sigil-fill"/>`,
  external: `<rect x="2.5" y="5" width="8.5" height="8" rx="1.5"/>
            <path d="M8 2.5h5.5V8M13.5 2.5 7.5 8.5"/>`,
  start: `<circle cx="8" cy="8" r="5"/>
            <path d="m7 5.4 3.6 2.6L7 10.6Z" class="sigil-fill"/>`,
  active: `<path d="M2 8h3l1.5-3.5L9 12l1.6-4H14"/>`,
  waiting: `<path d="M4 2.5h8M4 13.5h8M5 3c0 2.8 2 3.2 3 5-1 1.8-3 2.2-3 5M11 3c0 2.8-2 3.2-3 5 1 1.8 3 2.2 3 5"/>`,
  success: `<circle cx="8" cy="8" r="5.3"/>
            <path d="m5.2 8 1.8 1.8 3.8-4"/>`,
  failure: `<circle cx="8" cy="8" r="5.3"/>
            <path d="m5.7 5.7 4.6 4.6m0-4.6-4.6 4.6"/>`,
  neutral: `<rect x="3" y="3" width="10" height="10" rx="2"/>
            <circle cx="8" cy="8" r="1.2" class="sigil-fill"/>`,
};

// A quiet, renderer-owned role stamp. It is authored SVG content rather than a
// viewer overlay, so it survives canonical export while adding no focus target,
// accessible name, layout box, or interaction state of its own.
export function renderSemanticSigil(kind, { x, y, size = 11 } = {}) {
  const normalized = Object.hasOwn(SIGIL_SHAPE, kind) ? kind : 'neutral';
  const tone = SIGIL_TONE[normalized] || 'external';
  const scale = size / 16;
  return `<g aria-hidden="true" data-semantic-sigil="${esc(normalized)}" class="semantic-sigil s-${tone}" transform="translate(${x} ${y}) scale(${scale})">
            ${SIGIL_SHAPE[normalized]}
          </g>`;
}

export function renderCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return `    <!-- Info Cards -->
    <div class="cards">
${list.map((card) => `      <div class="card">
        <div class="card-header">
          <div class="card-dot ${esc(card.dot)}"></div>
          <h3>${esc(card.title)}</h3>
        </div>
        <ul>
${card.items.map((item) => `          <li>&bull; ${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`;
}

const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/;
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/;
const SUBTITLE_SLOT_RE = /^([ \t]*)<p class="subtitle">\[Subtitle description\]<\/p>[ \t]*(\r?\n)?/m;
const GUIDED_VIEWS_PLACEHOLDER = '<!-- ARCHIFY:GUIDED_VIEWS_DATA -->';
const SOURCE_EVIDENCE_PLACEHOLDER = '    <!-- ARCHIFY:SOURCE_EVIDENCE_DATA -->';

const TEMPLATE_PLACEHOLDERS = [
  '<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">',
  '<title>[PROJECT NAME] Architecture Diagram</title>',
  '<h1>[PROJECT NAME] Architecture</h1>',
  GUIDED_VIEWS_PLACEHOLDER,
];

// Archify's authored diagrams can be fully Russian while the standalone
// viewer used to keep its first-screen controls in English. For a Cyrillic
// title, localize the reader-facing shell without changing semantic IDs,
// export formats, shortcuts, or the source JSON contract.
const RUSSIAN_TEMPLATE_REPLACEMENTS = [
  ['aria-label="Diagram actions"', 'aria-label="Действия со схемой"'],
  ['title="Toggle theme (T)"', 'title="Сменить тему (T)"'],
  ['aria-label="Toggle color theme"', 'aria-label="Сменить цветовую тему"'],
  ['<span id="theme-label">Dark</span>', '<span id="theme-label">Тёмная тема</span>'],
  ['title="Choose visual style (S cycles)"', 'title="Выбрать стиль (S — следующий)"'],
  ['aria-label="Choose visual style"', 'aria-label="Выбрать стиль"'],
  ['<span id="preset-label">Style</span>', '<span id="preset-label">Стиль</span>'],
  ['aria-label="Visual style"', 'aria-label="Стиль оформления"'],
  ['<span>Visual identity</span><span>S cycles</span>', '<span>Оформление</span><span>S — следующий</span>'],
  ['<strong>Classic</strong><small>Stable technical default</small>', '<strong>Классический</strong><small>Спокойный основной стиль</small>'],
  ['<strong>Signal Flow</strong><small>Motion-forward presentation</small>', '<strong>Поток</strong><small>Акцент на движении по схеме</small>'],
  ['<strong>Blueprint</strong><small>Engineering review</small>', '<strong>Чертёж</strong><small>Строгое рабочее представление</small>'],
  ['<strong>Editorial</strong><small>Publication and launch notes</small>', '<strong>Публикация</strong><small>Представление для отчёта</small>'],
  ['title="Pause motion"', 'title="Остановить движение"'],
  ['aria-label="Pause motion"', 'aria-label="Остановить движение"'],
  ['<span id="motion-label">Live</span>', '<span id="motion-label">Движение</span>'],
  ['title="Presentation stage (F)"', 'title="Режим показа (F)"'],
  ['aria-label="Enter presentation stage"', 'aria-label="Включить режим показа"'],
  ['<span id="present-label">Present</span>', '<span id="present-label">Показ</span>'],
  ['title="Export diagram (E)"', 'title="Экспортировать схему (E)"'],
  ['aria-label="Export diagram"', 'aria-label="Экспортировать схему"'],
  ['        Export <span class="toolbar-icon toolbar-chevron"', '        Экспорт <span class="toolbar-icon toolbar-chevron"'],
  ['aria-label="Export"', 'aria-label="Экспорт"'],
  ['<div><strong>Export diagram</strong><span>Portable, clean outputs</span></div>', '<div><strong>Экспорт схемы</strong><span>Готовые файлы без элементов управления</span></div>'],
  ['aria-label="Share"', 'aria-label="Поделиться"'],
  ['<span class="export-menu-heading" aria-hidden="true">Share</span>', '<span class="export-menu-heading" aria-hidden="true">Поделиться</span>'],
  ['<strong>Share Card</strong>', '<strong>Карточка для публикации</strong>'],
  ['<strong>Route Share Card</strong>', '<strong>Карточка маршрута</strong>'],
  ['<strong>Reach Share Card</strong>', '<strong>Карточка связей</strong>'],
  ['<strong>Copy Share Card</strong>', '<strong>Копировать карточку</strong>'],
  ['<strong>Copy diagram</strong>', '<strong>Копировать схему</strong>'],
  ['PNG to clipboard', 'PNG в буфер обмена'],
  ['aria-label="Raster images"', 'aria-label="Растровые изображения"'],
  ['<span class="export-menu-heading" aria-hidden="true">Image</span>', '<span class="export-menu-heading" aria-hidden="true">Изображение</span>'],
  ['Lossless image', 'Без потери качества'],
  ['Compact image', 'Компактное изображение'],
  ['Modern image', 'Современный формат'],
  ['aria-label="Vector and motion"', 'aria-label="Вектор и движение"'],
  ['<span class="export-menu-heading" aria-hidden="true">Vector &amp; motion</span>', '<span class="export-menu-heading" aria-hidden="true">Вектор и движение</span>'],
  ['Editable vector', 'Редактируемый вектор'],
  ['6s motion', '6 секунд движения'],
  ['aria-label="Guided diagram views"', 'aria-label="Режимы просмотра схемы"'],
  ['aria-label="Previous guided view"', 'aria-label="Предыдущий режим просмотра"'],
  ['title="Previous guided view ([)"', 'title="Предыдущий режим просмотра ([)"'],
  ['<span>Guided views</span>', '<span>Режимы просмотра</span>'],
  ['Explore this system', 'Обзор процесса'],
  ['Step through curated paths without changing the source diagram.', 'Просматривайте подготовленные маршруты без изменения исходной схемы.'],
  ['aria-label="Story trail"', 'aria-label="Последовательность шагов"'],
  ['>Beat</span>', '>Шаг</span>'],
  ['<small>Next</small>', '<small>Далее</small>'],
  ['aria-label="Next guided view"', 'aria-label="Следующий режим просмотра"'],
  ['title="Next guided view (])"', 'title="Следующий режим просмотра (])"'],
  ['aria-label="Play guided story"', 'aria-label="Показать маршрут по шагам"'],
  ['title="Play guided story (P)"', 'title="Показать маршрут по шагам (P)"'],
  ['<span id="guided-view-play-label">Play story</span>', '<span id="guided-view-play-label">Показать по шагам</span>'],
  ['aria-label="Select a Story Beat to copy its exact link"', 'aria-label="Выберите шаг, чтобы скопировать точную ссылку"'],
  ['title="Select a Story Beat to copy its exact link"', 'title="Выберите шаг, чтобы скопировать точную ссылку"'],
  ['<span id="guided-view-beat-link-label">Copy moment</span>', '<span id="guided-view-beat-link-label">Скопировать шаг</span>'],
  ['aria-label="Show entire diagram"', 'aria-label="Показать всю схему"'],
  ['>Show all</button>', '>Показать всё</button>'],
  ['aria-label="Story chapters"', 'aria-label="Режимы просмотра"'],
  ['title="Show all nodes"', 'title="Показать все шаги"'],
  ['aria-label="Show all nodes"', 'aria-label="Показать все шаги"'],
  ['>Show all</span>', '>Показать всё</span>'],
  ['title="Clear guided view"', 'title="Закрыть выбранный маршрут"'],
  ['aria-label="Clear guided view"', 'aria-label="Закрыть выбранный маршрут"'],
  ['>Clear</span>', '>Закрыть</span>'],
  ['>PATH</button>', '>МАРШРУТ</button>'],
  ['>MAP</button>', '>ОБЗОР</button>'],
  ['>LENS</button>', '>СВЯЗИ</button>'],
  ['data-view-detail hidden>READ</span>', 'data-view-detail hidden>ЧТЕНИЕ</span>'],
  ["var LABELS = { classic: 'Classic', 'signal-flow': 'Flow', blueprint: 'Blueprint', editorial: 'Editorial' };", "var LABELS = { classic: 'Классический', 'signal-flow': 'Поток', blueprint: 'Чертёж', editorial: 'Публикация' };"],
  ["label.textContent = theme === 'dark' ? 'Dark' : 'Light';", "label.textContent = theme === 'dark' ? 'Тёмная тема' : 'Светлая тема';"],
  ["label.textContent = next ? 'Exit' : 'Present';", "label.textContent = next ? 'Выйти' : 'Показ';"],
  ["playLabel.textContent = playing ? 'Pause' : (storyPlaybackComplete ? 'Replay story' : 'Play story');", "playLabel.textContent = playing ? 'Пауза' : (storyPlaybackComplete ? 'Повторить показ' : 'Показать по шагам');"],
  ["label.textContent = view ? view.label : 'Explore this system';", "label.textContent = view ? view.label : 'Обзор процесса';"],
  ["stops.textContent = view.focus.length + ' stop' + (view.focus.length === 1 ? '' : 's');", "stops.textContent = 'шагов: ' + view.focus.length;"],
  ['            deltaLabel.hidden = false;', '            deltaLabel.hidden = true;'],
  ["count.textContent = activeIndex < 0 ? '0 / ' + views.length : (activeIndex + 1) + ' / ' + views.length;", "count.textContent = activeIndex < 0 ? 'обзор · ' + views.length : (activeIndex + 1) + ' из ' + views.length;"],
  ["var levelLabel = detail === 'map' ? 'MAP ' : detail === 'read' ? 'READ ' : 'FULL ';", "var levelLabel = detail === 'map' ? 'ОБЗОР ' : detail === 'read' ? 'ЧТЕНИЕ ' : 'ПОЛНОСТЬЮ ';"],
];

function localizeRussianTemplate(template) {
  return RUSSIAN_TEMPLATE_REPLACEMENTS.reduce(
    (localized, [source, target]) => localized.replaceAll(source, target),
    template,
  );
}

export function applyTemplate(template, { title, subtitle, svg, cards, visualPreset = 'classic', guidedViews = [], sourceEvidence = null }) {
  if (!SVG_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:SVG_SLOT sentinel');
  }
  if (!CARDS_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:CARDS_SLOT sentinel');
  }
  if (!SUBTITLE_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing subtitle placeholder');
  }
  for (const ph of TEMPLATE_PLACEHOLDERS) {
    if (!template.includes(ph)) {
      throw new Error(`applyTemplate: template missing placeholder ${JSON.stringify(ph)}`);
    }
  }
  // Keep existing custom templates compatible when evidence is not requested.
  // Silently dropping verified evidence would be misleading, so the new slot
  // becomes mandatory only for the opt-in evidence path.
  if (sourceEvidence && !template.includes(SOURCE_EVIDENCE_PLACEHOLDER)) {
    throw new Error(`applyTemplate: repository evidence requires placeholder ${JSON.stringify(SOURCE_EVIDENCE_PLACEHOLDER)}`);
  }
  // Function replacers: a literal `$&`, `$'`, `$\`` or `$$` in titles, labels,
  // or rendered SVG must not be interpreted as a replacement pattern.
  const guidedViewsJson = JSON.stringify(guidedViews)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  const sourceEvidenceJson = JSON.stringify(sourceEvidence)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  const renderedSubtitle = typeof subtitle === 'string' && subtitle.trim()
    ? `<p class="subtitle">${esc(subtitle)}</p>`
    : '';
  const russian = /[А-Яа-яЁё]/u.test(String(title));
  const readerTemplate = russian ? localizeRussianTemplate(template) : template;
  return readerTemplate
    .replace(TEMPLATE_PLACEHOLDERS[0], () => `<html lang="${russian ? 'ru' : 'en'}" data-theme="dark" data-preset="${esc(visualPreset)}">`)
    .replace(TEMPLATE_PLACEHOLDERS[1], () => `<title>${esc(title)}${russian ? ' — схема' : ' Diagram'}</title>`)
    .replace(TEMPLATE_PLACEHOLDERS[2], () => `<h1>${esc(title)}</h1>`)
    .replace(SUBTITLE_SLOT_RE, (_match, indent, newline = '') => renderedSubtitle
      ? `${indent}${renderedSubtitle}${newline}`
      : '')
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => cards)
    .replace(GUIDED_VIEWS_PLACEHOLDER, () => `<script id="archify-guided-views-data" type="application/json">${guidedViewsJson}</script>`)
    .replace(SOURCE_EVIDENCE_PLACEHOLDER, () => sourceEvidence
      ? `    <script id="archify-source-evidence-data" type="application/json">${sourceEvidenceJson}</script>`
      : '');
}

// CJK and other wide/fullwidth glyphs render at roughly twice the advance
// width of ASCII in the monospace stacks the template uses. Keep halfwidth
// forms (notably U+FF61–U+FF9F Katakana) out of this set. The explicit ranges
// also cover vertical punctuation and supplementary East Asian scripts that
// literal glyph ranges made difficult to audit.
const FULLWIDTH_RE = /[\u1100-\u115F\u2329-\u232A\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6\u{16FE0}-\u{18DFF}\u{1AFF0}-\u{1AFFF}\u{1B000}-\u{1B2FF}\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

export function textUnits(text) {
  let units = 0;
  for (const ch of String(text ?? '')) units += FULLWIDTH_RE.test(ch) ? 2 : 1;
  return units;
}

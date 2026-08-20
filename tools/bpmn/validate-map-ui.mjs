import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const target = resolve(process.argv[2] || '../../processes/skupka-zolota/map/process-map.html');
const html = readFileSync(target, 'utf8');

function fail(message) {
  throw new Error(message);
}

if (!/<html\s+lang="ru"/i.test(html)) fail('Карта должна объявлять русский язык интерфейса');
if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) fail('Карта не должна загружать внешние шрифты');
if (!html.includes('Скупка золота и драгоценных металлов')) fail('На карте отсутствует полное название процесса');
if (!html.includes('Карточка элемента') || !html.includes('Поиск маршрута') || !html.includes('Мини-карта')) {
  fail('Не все основные инструменты карты локализованы');
}

const forbiddenReaderPhrases = [
  'Diagram guide',
  'Find a node',
  'Find any node',
  'Semantic passport',
  'Route probe',
  'Semantic lens',
  'Semantic radar',
  'Guided chapter',
  'No matching nodes',
  'Zoom in',
  'Zoom out',
  'Close diagram guide',
  'Search labels or IDs',
  'Choose a start node',
  'Pick two semantic nodes',
  'Inspecting compiled semantics',
  'Enter Presentation Stage',
  'Open diagram guide',
  'Copy failed',
  'No connected relationships',
  'content: "SIGNAL FLOW"',
  'content: "BLUEPRINT / REV 01"',
  'content: "EDITORIAL / FIELD NOTE"',
  'content: "ARCHIFY / PLATE 04"',
  'aria-label="Focus ',
  'aria-label="Clear route probe"',
  'title="Close"',
  'before exporting a Route Share Card',
  'before exporting a Reach Share Card',
  "'Walk ' + views + ' authored chapter'",
  "item.links + (item.links === 1 ? ' link' : ' links')",
  "? 'Choose ' + item.label",
  ": 'Focus ' + item.label",
  'meta.textContent = [item.type,',
  "setPassportValue(kind, node.getAttribute('data-node-kind')",
  "available.length + ' ' + context.availableNoun",
  "return activeNodeIds.length + ' nodes",
  "count + ' directed destination'",
  "kind.nodes.length + ' node'",
  "total + ' direct relationship'",
  "touching + ' touching relationship'",
  "reachSnapshot.direction + ' от '",
  "preset === 'signal-flow' ? 'FLOW'",
  " + ' HOPS'",
  ".toUpperCase() + ' REACH'",
  ": 'unknown'",
  "'Trace ' + upstreamReach",
  "relationships.length + ' связь'",
  "relationship.direction === 'out' ? 'OUT",
  "sourceBadges[id] = 'start'",
  "distances[id] + ' переход'",
  "resolvedLevel !== 'READ'",
  "\u00b7 starting point'",
  'reverse authored link',
  'grouped \\u00b7 no direct link',
  'semanticId.textContent = id',
  '[russianKindLabel(item.type), item.id',
  "nodeLabel(byId[id], id) + ' · ' + id",
  "'Playing'",
  "'Complete'",
  "'Inspecting'"
];

const remaining = forbiddenReaderPhrases.filter((phrase) => html.includes(phrase));
if (remaining.length) fail(`В карте остались английские подписи: ${remaining.join(', ')}`);

const readerMarkup = html
  .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '')
  .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, '');
const readerValues = [
  readerMarkup.replace(/<[^>]+>/g, ' '),
  ...[ ...readerMarkup.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/gi) ].map((match) => match[1])
];
const allowedTechnicalWords = new Set([ 'BPMN', 'Esc', 'JPEG', 'PNG', 'SVG', 'WebM', 'WebP', 'bull', 'times' ]);
const untranslatedStaticWords = [ ...new Set(readerValues
  .flatMap((value) => value.match(/[A-Za-z]{2,}/g) || [])
  .filter((word) => !allowedTechnicalWords.has(word))) ];
if (untranslatedStaticWords.length) {
  fail(`В статическом интерфейсе остались английские слова: ${untranslatedStaticWords.join(', ')}`);
}

const opaqueCodes = [ ...html.matchAll(/\b(?:БП|ОП|СКС)-\d+\b/gu) ].map((match) => match[0]);
if (opaqueCodes.length) fail(`На карте остались непрозрачные коды: ${[ ...new Set(opaqueCodes) ].join(', ')}`);

const mixedIdentifiers = [ ...html.matchAll(/\b(?=[A-Za-z_$\p{Script=Cyrillic}0-9]*[A-Za-z])(?=[A-Za-z_$\p{Script=Cyrillic}0-9]*\p{Script=Cyrillic})[A-Za-z_$\p{Script=Cyrillic}][A-Za-z0-9_$\p{Script=Cyrillic}]*\b/gu) ]
  .map((match) => match[0]);
if (mixedIdentifiers.length) {
  fail(`Локализация повредила идентификаторы: ${[ ...new Set(mixedIdentifiers) ].join(', ')}`);
}

const inlineScripts = [ ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi) ].map((match) => match[1]);
for (const [ index, source ] of inlineScripts.entries()) {
  try {
    new Function(source);
  } catch (error) {
    fail(`JavaScript карты не разбирается, блок ${index + 1}: ${error.message}`);
  }
}

console.log(JSON.stringify({
  status: 'passed',
  language: 'ru',
  external_fonts: false,
  forbidden_reader_phrases: 0,
  untranslated_static_words: 0,
  opaque_codes: 0,
  mixed_identifiers: 0,
  inline_scripts_parsed: inlineScripts.length
}, null, 2));

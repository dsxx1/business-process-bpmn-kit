import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BpmnModdle } from 'bpmn-moddle';

const uiRoot = join(import.meta.dirname, 'studio-ui');
const html = readFileSync(join(uiRoot, 'index.html'), 'utf8');
const css = readFileSync(join(uiRoot, 'styles.css'), 'utf8');
const script = readFileSync(join(uiRoot, 'app.js'), 'utf8');

for (const id of [
  'new-file-button',
  'open-file-button',
  'open-file-input',
  'save-button',
  'save-as-button',
  'check-button',
  'more-button',
  'advanced-toggle-button',
  'file-drop-overlay'
]) {
  assert.match(html, new RegExp(`id="${id}"`, 'u'), `в файловом интерфейсе отсутствует ${id}`);
}

assert.match(html, /accept="\.bpmn,application\/xml,text\/xml"/u, 'input должен принимать BPMN/XML');
assert.match(html, /Новая схема/u, 'новая схема должна запускаться понятной кнопкой');
assert.match(html, /Открыть BPMN/u, 'открытие BPMN должно запускаться понятной кнопкой');
assert.match(html, /Сохранить как…/u, 'сохранение в произвольную папку должно быть явным действием');
assert.match(html, /Дополнительно/u, 'управляемые функции должны находиться под «Дополнительно»');

for (const phrase of [
  'Получен запрос',
  'Уточнить входные данные',
  'Работу можно выполнить?',
  'Выполнить работу и проверить результат',
  'Результат передан',
  'Работа завершена без результата'
]) {
  assert.match(script, new RegExp(phrase.replace(/[?]/gu, '\\?'), 'u'), `в стартовой схеме отсутствует шаг: ${phrase}`);
}

const starterMatch = script.match(/const STARTER_BPMN_XML = `([\s\S]*?)`;/u);
assert.ok(starterMatch, 'стартовая BPMN-модель должна быть встроена в файловый редактор');
const { rootElement: definitions, warnings } = await new BpmnModdle().fromXML(starterMatch[1]);
assert.equal(warnings.length, 0, `стартовая BPMN-модель содержит предупреждения: ${warnings.map((item) => item.message).join('; ')}`);
const processElement = definitions.rootElements.find((item) => item.$type === 'bpmn:Process');
assert.ok(processElement, 'в стартовой BPMN-модели отсутствует процесс');
assert.equal(processElement.flowElements.filter((item) => item.$type === 'bpmn:StartEvent').length, 1, 'нужно одно понятное начало');
assert.equal(processElement.flowElements.filter((item) => item.$type === 'bpmn:EndEvent').length, 2, 'оба исхода должны иметь явное завершение');
assert.ok(processElement.flowElements.some((item) => item.$type === 'bpmn:ExclusiveGateway'), 'осмысленная основа должна показывать решение');
assert.ok(processElement.flowElements.every((item) => !item.name || item.name.trim()), 'подписи стартовой схемы не должны быть пустыми');

assert.match(script, /state\.mode === 'file'/u, 'локальный файл должен быть отдельным режимом');
assert.match(script, /file\.text\(\)/u, 'файл должен читаться локально в браузере');
assert.match(script, /showOpenFilePicker/u, 'поддерживаемый браузер должен получать доступ к открытому файлу');
assert.match(script, /handle\.getFile\(\)/u, 'после открытия нужно сохранить файловый handle для Ctrl+S');
assert.match(script, /showSaveFilePicker/u, 'поддерживаемый браузер должен сохранять в выбранную папку');
assert.match(script, /createWritable\(\)/u, 'повторное сохранение должно обновлять выбранный файл');
assert.match(script, /downloadXml\(xml, fileName\)/u, 'должен оставаться fallback через скачивание');
assert.match(script, /addEventListener\('drop'/u, 'редактор должен принимать BPMN перетаскиванием');
assert.match(script, /event\.ctrlKey \|\| event\.metaKey/u, 'должно работать Ctrl+S или Cmd+S');
assert.doesNotMatch(script, /полное название (?:процесса|будущего процесса) по-русски/iu, 'название процесса нельзя ограничивать кириллицей');

assert.match(css, /\.app-shell:not\(\.advanced-open\) \.advanced-only/u, 'расширенные вкладки должны быть скрыты по умолчанию');
assert.match(css, /\.app-shell\.advanced-open \.sidebar/u, 'каталог проекта должен открываться через «Дополнительно»');
assert.match(css, /\.file-drop-overlay/u, 'перетаскивание файла должно иметь видимую обратную связь');

console.log('STUDIO_FILE_MODE_OK');

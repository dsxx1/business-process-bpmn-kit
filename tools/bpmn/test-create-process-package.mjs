import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const creatorPath = resolve(import.meta.dirname, 'create-process-package.mjs');
const validatorPath = resolve(import.meta.dirname, 'validate-package.mjs');
const tempRoot = resolve(projectRoot, 'temp', 'create-process-package-test');
const title = 'Скупка золота & проверка <качества> "срочно"';
const generatedSlug = 'skupka-zolota-proverka-kachestva-srochno';
const generatedRoot = resolve(tempRoot, generatedSlug);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runNode(script, args, expectedStatus, label) {
  const result = spawnSync(process.execPath, [ script, ...args ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) {
    fail(`${label}: ожидался код ${expectedStatus}, получен ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}

function safeCleanup() {
  const expected = resolve(projectRoot, 'temp', 'create-process-package-test');
  const relation = relative(resolve(projectRoot, 'temp'), tempRoot);
  if (tempRoot !== expected || relation !== 'create-process-package-test' || isAbsolute(relation) || relation.includes(sep)) {
    fail('Небезопасный путь очистки тестового каталога.');
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

safeCleanup();

try {
  const creatorSource = readFileSync(creatorPath, 'utf8');
  const obsoleteConsolePrompt = [ 'Полное название процесса', ':' ].join('');
  assert(!creatorSource.includes(obsoleteConsolePrompt), 'Устаревший консольный вопрос всё ещё присутствует в мастере создания.');
  const rootLaunchers = readdirSync(projectRoot).filter((name) => name.toLocaleLowerCase('ru-RU').endsWith('.cmd'));
  assert(
    JSON.stringify(rootLaunchers) === JSON.stringify([ 'ОТКРЫТЬ-BPMN-РЕДАКТОР.cmd' ]),
    `В корне должен остаться один понятный запуск редактора, найдено: ${rootLaunchers.join(', ')}`
  );

  const created = runNode(creatorPath, [
    '--title', title,
    '--output-root', tempRoot,
    '--no-open'
  ], 0, 'Создание пакета с автоматически сформированным коротким именем');

  assert(existsSync(generatedRoot), 'Папка с автоматически сформированным коротким именем не создана.');
  assert(!created.stdout.includes('открыта в Camunda Modeler'), 'Автоматический режим не должен открывать редактор.');

  const bpmnRoot = resolve(generatedRoot, 'bpmn');
  const bpmnPath = resolve(bpmnRoot, 'process.bpmn');
  const metaPath = resolve(bpmnRoot, 'process.meta.json');
  const questionsPath = resolve(bpmnRoot, 'questions.json');
  const decisionsPath = resolve(bpmnRoot, 'decisions.json');
  const cardPath = resolve(generatedRoot, 'process-card.md');
  const evidencePath = resolve(generatedRoot, 'evidence', 'README.md');
  const readmePath = resolve(generatedRoot, 'README.md');
  for (const path of [ bpmnPath, metaPath, questionsPath, decisionsPath, cardPath, evidencePath, readmePath ]) {
    assert(existsSync(path), `Не создан обязательный файл: ${path}`);
  }

  const xml = readFileSync(bpmnPath, 'utf8');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const questions = JSON.parse(readFileSync(questionsPath, 'utf8'));
  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  const generatedReadme = readFileSync(readmePath, 'utf8');
  const allText = [
    ...[ bpmnPath, metaPath, questionsPath, decisionsPath, cardPath, evidencePath ],
    readmePath,
    resolve(generatedRoot, 'map', 'process-map.md')
  ].map((path) => readFileSync(path, 'utf8')).join('\n');

  assert(meta.process_id === 'SKUPKA-ZOLOTA-PROVERKA-KACHESTVA-SROCHNO', 'Сформирован неверный process_id.');
  assert(meta.title === title, 'Полное название искажено в process.meta.json.');
  assert(meta.status === 'draft', 'Новый пакет должен оставаться черновиком до проверки владельцем.');
  assert(meta.canonicality.business_status === 'pending_human_decision', 'Новый пакет не должен автоматически считаться утверждённым.');
  assert(meta.bpmn.definitions_id === 'Definitions_SkupkaZolotaProverkaKachestvaSrochno', 'definitions_id не является смысловым.');
  assert(meta.bpmn.process_element_id === 'Process_SkupkaZolotaProverkaKachestvaSrochno', 'process_element_id не является смысловым.');
  assert(meta.bpmn.collaboration_id === 'Collaboration_SkupkaZolotaProverkaKachestvaSrochno', 'collaboration_id не является смысловым.');
  assert(questions.process_id === meta.process_id && decisions.process_id === meta.process_id, 'process_id различается между JSON-файлами.');
  assert(questions.questions[0].question_id === `Q-${meta.process_id}-001`, 'Вопрос владельцу сохранил шаблонный ID.');
  assert(questions.questions[0].source_element_ids[0] === meta.bpmn.process_element_id, 'Вопрос ссылается на старый BPMN ID.');
  assert(questions.questions[0].title.includes(title), 'Вопрос владельцу не содержит название созданного процесса.');
  assert(meta.evidence[0].evidence_id === `EV-${meta.process_id}-01`, 'Основание сохранило шаблонный ID.');
  assert(meta.source_card.sha256 === sha256(cardPath), 'SHA-256 карточки процесса не обновлён.');
  assert(meta.evidence[0].sha256 === sha256(evidencePath), 'SHA-256 основания процесса не обновлён.');
  assert(generatedReadme.includes(`# ${title}`), 'README готового пакета не содержит название процесса.');
  assert(generatedReadme.includes('bpmn/process.bpmn'), 'README готового пакета не объясняет, какой BPMN-файл открыть.');
  assert(generatedReadme.includes('ОТКРЫТЬ-BPMN-РЕДАКТОР.cmd'), 'README готового пакета не ведёт в единый графический редактор.');
  assert(generatedReadme.includes('«Проверить»'), 'README готового пакета не объясняет проверку в редакторе.');
  assert(generatedReadme.includes('«Зарегистрировать»'), 'README готового пакета не объясняет безопасную регистрацию в редакторе.');
  assert(generatedReadme.includes('status `draft`') || generatedReadme.includes('статуса `draft`'), 'README готового пакета не объясняет статус черновика.');
  assert(!generatedReadme.includes('СОЗДАТЬ-НОВЫЙ-ПРОЦЕСС.cmd'), 'README готового пакета рекурсивно предлагает снова запустить мастер.');
  assert(xml.includes('name="Скупка золота &amp; проверка &lt;качества&gt; &quot;срочно&quot;"'), 'Название некорректно экранировано в XML-атрибуте.');
  assert(!xml.includes('name="Скупка золота & проверка <качества>'), 'В BPMN остались неэкранированные XML-символы.');
  assert(!/PROCESS-TEMPLATE|(?:Definitions|Collaboration|Process|LaneSet|BPMNDiagram|BPMNPlane)_Template|process-template|Новый бизнес-процесс/u.test(allText), 'В готовом пакете остались заполнители шаблона.');

  runNode(validatorPath, [ bpmnRoot ], 0, 'Техническая проверка созданного пакета');

  const marker = '\nПРОВЕРКА_НЕ_ПЕРЕЗАПИСЫВАТЬ\n';
  writeFileSync(cardPath, `${readFileSync(cardPath, 'utf8')}${marker}`, 'utf8');
  const duplicate = runNode(creatorPath, [
    '--title', title,
    '--output-root', tempRoot,
    '--no-open'
  ], 1, 'Защита существующего пакета от перезаписи');
  assert(duplicate.stderr.includes('ничего не перезаписано'), 'Ошибка существующего пакета не объясняет защиту от перезаписи.');
  assert(readFileSync(cardPath, 'utf8').includes(marker.trim()), 'Повторный запуск изменил существующий пакет.');

  const traversal = runNode(creatorPath, [
    '--title', 'Проверка безопасного пути',
    '--slug', '../outside',
    '--output-root', tempRoot,
    '--no-open'
  ], 1, 'Отказ от выхода за каталог назначения');
  assert(traversal.stderr.includes('Короткое имя'), 'Небезопасное короткое имя отклонено без понятного объяснения.');
  assert(!existsSync(resolve(tempRoot, '..', 'outside')), 'Небезопасное короткое имя создало файл вне каталога назначения.');

  runNode(creatorPath, [ '--title', '', '--output-root', tempRoot, '--no-open' ], 1, 'Отказ от пустого названия');
  runNode(creatorPath, [ '--title', "Две\nстроки", '--output-root', tempRoot, '--no-open' ], 1, 'Отказ от многострочного названия');
  for (const [ arbitraryTitle, arbitrarySlug ] of [
    [ 'Gold buying', 'english-title-test' ],
    [ 'ОП-03', 'opaque-title-test' ],
    [ '7', 'numeric-title-test' ]
  ]) {
    runNode(creatorPath, [
      '--title', arbitraryTitle,
      '--slug', arbitrarySlug,
      '--output-root', tempRoot,
      '--no-open'
    ], 0, `Создание процесса с произвольным названием «${arbitraryTitle}»`);
    const arbitraryBpmnRoot = resolve(tempRoot, arbitrarySlug, 'bpmn');
    const arbitraryMeta = JSON.parse(readFileSync(resolve(arbitraryBpmnRoot, 'process.meta.json'), 'utf8'));
    assert(arbitraryMeta.title === arbitraryTitle, `Название «${arbitraryTitle}» было изменено.`);
    runNode(validatorPath, [ arbitraryBpmnRoot ], 0, `Валидация процесса с названием «${arbitraryTitle}»`);
  }

  const invalidStepBpmn = resolve(tempRoot, 'english-title-test', 'bpmn', 'process.bpmn');
  writeFileSync(
    invalidStepBpmn,
    readFileSync(invalidStepBpmn, 'utf8').replace('name="Уточнить входные данные"', 'name="Task_01"'),
    'utf8'
  );
  const invalidStep = runNode(validatorPath, [ resolve(tempRoot, 'english-title-test', 'bpmn') ], 1, 'Отказ от технического кода вместо названия шага');
  assert(
    invalidStep.stderr.includes('русской фразой') || invalidStep.stderr.includes('внутренний код'),
    'Валидатор перестал требовать понятное русское название шага.'
  );
  runNode(creatorPath, [ '--title', 'Короткий ID', '--slug', 'ab', '--output-root', tempRoot, '--no-open' ], 1, 'Отказ от слишком короткого ID');
  runNode(creatorPath, [ '--unknown-option' ], 1, 'Отказ от неизвестного параметра');
  const nonInteractive = runNode(creatorPath, [ '--output-root', tempRoot, '--no-open' ], 1, 'Явный отказ от интерактивного ввода без терминала');
  assert(nonInteractive.stderr.includes('--title'), 'Неинтерактивный запуск без названия не подсказывает параметр --title.');

  const explicitSlug = 'loan-issuance';
  runNode(creatorPath, [
    '--title', 'Выдача займа клиенту',
    '--slug', explicitSlug,
    '--output-root', tempRoot,
    '--no-open'
  ], 0, 'Создание пакета с заданным коротким именем');
  const explicitMeta = JSON.parse(readFileSync(resolve(tempRoot, explicitSlug, 'bpmn', 'process.meta.json'), 'utf8'));
  assert(explicitMeta.process_id === 'LOAN-ISSUANCE', 'Заданный короткий ID не применён.');
  assert(explicitMeta.bpmn.process_element_id === 'Process_LoanIssuance', 'Из заданного короткого ID не сформирован смысловой BPMN ID.');

  console.log(JSON.stringify({
    status: 'passed',
    generated_slug: generatedSlug,
    xml_title_escaped: true,
    hashes_refreshed: true,
    existing_package_preserved: true,
    unsafe_paths_rejected: true,
    automatic_mode_did_not_open_editor: true,
    arbitrary_process_titles_accepted: [ 'Gold buying', 'ОП-03', '7' ],
    russian_step_labels_still_required: true,
    root_launcher: 'ОТКРЫТЬ-BPMN-РЕДАКТОР.cmd'
  }, null, 2));
} finally {
  safeCleanup();
}

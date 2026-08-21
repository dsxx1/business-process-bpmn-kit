import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { startStudioServer } from './studio-server.mjs';

function findBrowser() {
  const configured = process.env.BPMN_CHROME_PATH;
  if (configured && existsSync(configured)) return configured;
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      ]
    : process.platform === 'darwin'
      ? [ '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ]
      : [ '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser' ];
  return candidates.find(existsSync);
}

function runBrowser(browser, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(browser, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: [ 'ignore', 'pipe', 'pipe' ]
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`Браузер завершился с кодом ${code}: ${stderr || stdout}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

const browser = findBrowser();
if (!browser) throw new Error('Chrome или Edge не найден. Укажите BPMN_CHROME_PATH.');

const projectRoot = resolve(import.meta.dirname, '../..');
const sourceUiRoot = resolve(import.meta.dirname, 'studio-ui');
const tempRoot = resolve(projectRoot, 'temp', 'studio-browser-test');
const tempUiRoot = resolve(tempRoot, 'ui');
mkdirSync(tempUiRoot, { recursive: true });
cpSync(resolve(sourceUiRoot, 'styles.css'), resolve(tempUiRoot, 'styles.css'));
cpSync(resolve(sourceUiRoot, 'app.js'), resolve(tempUiRoot, 'app.js'));

const consoleProbe = `<script>
window.__studioConsoleErrors = [];
(function (originalError) {
  console.error = function () {
    var message = Array.prototype.map.call(arguments, function (value) {
      return value && value.stack ? value.stack : String(value);
    }).join(' ');
    window.__studioConsoleErrors.push(message);
    return originalError.apply(console, arguments);
  };
})(console.error);
</script>`;

const selfTest = `<script>
setTimeout(function () {
  var query = new URLSearchParams(window.location.search);
  if (query.get('studio-diagram-preview') === '1') return;
  if (query.get('studio-map-preview') === '1') {
    document.getElementById('map-tab').click();
    return;
  }
  if (query.get('studio-transition-preview') === '1') {
    document.getElementById('details-tab').click();
    setTimeout(function () {
      var transitionButton = document.querySelector('[data-edit-transition-source="CallActivity_HighEvaluation"]');
      if (transitionButton) transitionButton.click();
    }, 350);
    return;
  }
  if (query.get('studio-details-preview') === '1') {
    document.getElementById('details-tab').click();
    return;
  }
  if (query.get('studio-self-test') !== '1') return;
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  try {
    var processButtons = Array.from(document.querySelectorAll('[data-process-slug]'));
    assert(processButtons.length > 0, 'Каталог процессов не загрузился');
    assert(document.getElementById('process-title').textContent.trim() !== 'Выберите бизнес-процесс', 'Процесс не открылся');
    assert(document.getElementById('welcome-view').hidden, 'После загрузки процесса остался стартовый экран');
    assert(document.querySelectorAll('#bpmn-canvas .djs-element').length > 5, 'BPMN-схема не отрисовалась');
    var watermark = document.querySelector('#bpmn-canvas .bjs-powered-by');
    assert(watermark, 'Отсутствует обязательный знак bpmn.io');
    var watermarkStyle = window.getComputedStyle(watermark);
    var watermarkRect = watermark.getBoundingClientRect();
    var canvasRect = document.getElementById('bpmn-canvas').getBoundingClientRect();
    assert(watermarkStyle.display !== 'none' && watermarkStyle.visibility !== 'hidden', 'Знак bpmn.io скрыт стилями');
    assert(Number(watermarkStyle.opacity || '1') > 0, 'Знак bpmn.io полностью прозрачен');
    assert(watermarkRect.width > 0 && watermarkRect.height > 0, 'Знак bpmn.io не имеет видимой области');
    assert(
      watermarkRect.left >= canvasRect.left && watermarkRect.top >= canvasRect.top
        && watermarkRect.right <= canvasRect.right && watermarkRect.bottom <= canvasRect.bottom,
      'Знак bpmn.io вышел за пределы редактора',
    );
    var watermarkLink = watermark.matches('a') ? watermark : watermark.closest('a') || watermark.querySelector('a');
    assert(watermarkLink && /(?:^|\.)bpmn\.io$/u.test(new URL(watermarkLink.href).hostname), 'Знак ведёт не на bpmn.io');
    assert(!document.getElementById('diagram-view').hidden, 'Вкладка BPMN не показана');

    var englishUi = /\\b(?:create|append|remove|change type|activate|connect using|edit label|add lane|divide into)\\b/i;
    Array.from(document.querySelectorAll('#bpmn-canvas [title]')).forEach(function (item) {
      assert(!englishUi.test(item.getAttribute('title') || ''), 'Английская подсказка редактора: ' + item.getAttribute('title'));
    });

    document.getElementById('map-tab').click();
    assert(!document.getElementById('map-view').hidden, 'Вкладка карты не открылась');
    var mapFrame = document.getElementById('map-frame');
    assert(!mapFrame.hidden, 'Готовая карта Archify не показана');
    assert(/\\/view\\/.+\\/archify/.test(mapFrame.getAttribute('src') || ''), 'Карта открывается не через защищённый маршрут');

    document.getElementById('details-tab').click();
    assert(!document.getElementById('details-view').hidden, 'Вкладка готовности не открылась');
    assert(document.getElementById('details-status-title').textContent.trim(), 'Статус процесса не показан');
    var transitionButton = document.querySelector('[data-edit-transition-source="CallActivity_HighEvaluation"]');
    assert(transitionButton, 'Готовый межпроцессный переход не показан');
    assert(/Скупка золота/iu.test(document.getElementById('process-title').textContent), 'Для проверки supporting-данных открылась не скупка золота');
    var processCardText = document.getElementById('process-card-content').textContent;
    assert(/Зачем нужен процесс/iu.test(processCardText), 'Карточка процесса скупки не показана');
    var questionItems = Array.from(document.querySelectorAll('#questions-list .question-item'));
    assert(questionItems.length === 10, 'Ожидалось 10 вопросов скупки, показано: ' + questionItems.length);
    var openQuestionsBadge = document.getElementById('questions-count');
    assert(!openQuestionsBadge.hidden && openQuestionsBadge.textContent.trim() === '10', 'Badge не показывает 10 открытых вопросов');
    var firstQuestion = questionItems[0].querySelector('.question-title').textContent.trim();
    assert(
      firstQuestion === 'Кто является уполномоченным владельцем процесса «Скупка золота и драгоценных металлов»?',
      'Первый реальный вопрос скупки не показан: ' + firstQuestion,
    );
    assert(
      /Открыты блокирующие вопросы владельцу: 10\./u.test(document.getElementById('attention-list').textContent),
      'Блокирующие вопросы не попали в блок внимания',
    );
    var attentionList = document.getElementById('attention-list');
    var attentionCard = attentionList.closest('.summary-card');
    var attentionRows = Array.from(attentionList.querySelectorAll('li'));
    assert(attentionRows.length >= 3, 'Не показаны все предупреждения процесса');
    attentionRows.forEach(function (row) {
      var message = row.querySelector('span:last-child');
      assert(message && message.getBoundingClientRect().width > 180, 'Текст предупреждения сжат в узкую колонку');
    });
    assert(
      attentionList.getBoundingClientRect().bottom <= attentionCard.getBoundingClientRect().bottom + 1,
      'Предупреждения выходят за нижнюю границу карточки',
    );

    document.getElementById('help-button').click();
    assert(!document.getElementById('help-panel').hidden, 'Русская справка не открылась');
    assert(document.getElementById('help-title').textContent.trim() === 'BPMN за 2 минуты', 'Справка не локализована');
    assert(window.__studioConsoleErrors.length === 0, 'Ошибки консоли: ' + window.__studioConsoleErrors.join(' | '));

    document.documentElement.setAttribute('data-studio-test', 'passed');
  } catch (error) {
    document.documentElement.setAttribute('data-studio-test', 'failed');
    document.documentElement.setAttribute('data-studio-error', error.message);
  }
}, 2500);
</script>`;

const sourceHtml = readFileSync(resolve(sourceUiRoot, 'index.html'), 'utf8');
writeFileSync(
  resolve(tempUiRoot, 'index.html'),
  sourceHtml
    .replace('<head>', `<head>\n${consoleProbe}`)
    .replace('</body>', `${selfTest}\n</body>`),
  'utf8'
);

const studio = await startStudioServer({ projectRoot, uiRoot: tempUiRoot });
try {
  const profileRoot = resolve(tempRoot, `profile-${process.pid}`);
  const result = await runBrowser(browser, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    '--virtual-time-budget=9000',
    '--dump-dom',
    `--user-data-dir=${profileRoot}`,
    studio.url + '&studio-self-test=1&process=skupka-zolota'
  ]);
  const dom = result.stdout;
  if (!dom.includes('data-studio-test="passed"')) {
    const message = dom.match(/data-studio-error="([^"]*)"/)?.[1] || 'браузерный self-test не завершился';
    throw new Error(`BPMN-студия не прошла browser smoke: ${message}`);
  }
  const screenshotPath = process.env.STUDIO_SCREENSHOT_PATH
    ? resolve(process.env.STUDIO_SCREENSHOT_PATH)
    : resolve(tempRoot, 'studio.png');
  mkdirSync(dirname(screenshotPath), { recursive: true });
  await runBrowser(browser, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    '--virtual-time-budget=6000',
    `--screenshot=${screenshotPath}`,
    `--user-data-dir=${resolve(tempRoot, `profile-visual-${process.pid}`)}`,
    studio.url + '&studio-self-test=1&studio-diagram-preview=1&process=skupka-zolota'
  ]);
  if (!existsSync(screenshotPath)) throw new Error('Браузер не создал контрольный снимок BPMN-студии.');
  const archifyScreenshotPath = process.env.STUDIO_ARCHIFY_SCREENSHOT_PATH
    ? resolve(process.env.STUDIO_ARCHIFY_SCREENSHOT_PATH)
    : resolve(tempRoot, 'studio-archify.png');
  mkdirSync(dirname(archifyScreenshotPath), { recursive: true });
  await runBrowser(browser, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    '--virtual-time-budget=9000',
    `--screenshot=${archifyScreenshotPath}`,
    `--user-data-dir=${resolve(tempRoot, `profile-archify-${process.pid}`)}`,
    studio.url + '&studio-self-test=1&studio-map-preview=1&process=skupka-zolota'
  ]);
  if (!existsSync(archifyScreenshotPath)) throw new Error('Браузер не создал контрольный снимок Archify в Студии.');
  const detailsScreenshotPath = resolve(tempRoot, 'studio-details.png');
  await runBrowser(browser, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    '--virtual-time-budget=6000',
    `--screenshot=${detailsScreenshotPath}`,
    `--user-data-dir=${resolve(tempRoot, `profile-details-${process.pid}`)}`,
    studio.url + '&studio-details-preview=1&process=skupka-zolota'
  ]);
  if (!existsSync(detailsScreenshotPath)) throw new Error('Браузер не создал контрольный снимок карточки и вопросов.');
  console.log(JSON.stringify({
    status: 'passed',
    catalog: true,
    bpmn_rendered: true,
    reader_ui_russian: true,
    archify_embedded: true,
    details_and_help: true,
    process_card_visible: true,
    supporting_questions_visible: 10,
    first_supporting_question_visible: true,
    bpmn_io_mark_visible: true,
    screenshot: screenshotPath,
    archify_screenshot: archifyScreenshotPath,
    details_screenshot: detailsScreenshotPath
  }, null, 2));
} finally {
  await studio.close();
}

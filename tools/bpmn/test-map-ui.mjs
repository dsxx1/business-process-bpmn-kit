import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

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

const htmlPath = resolve(process.argv[2] || '../../processes/skupka-zolota/map/process-map.html');
if (!existsSync(htmlPath)) throw new Error(`Map HTML is missing: ${htmlPath}`);
const browser = findBrowser();
if (!browser) throw new Error('Chrome/Edge not found. Set BPMN_CHROME_PATH.');

const selfTest = `<script>
setTimeout(function () {
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function assertReaderRussian(value, label) {
    var forbidden = /\b(?:frontend|backend|database|cloud|security|external|node|nodes|relationship|relationships|chapter|route|focus|inspect|choose|playing|complete|grouped|direct|reverse|authored|link|request|agreement|storage)\b/i;
    assert(!forbidden.test(String(value || '')), label + ' contains reader-facing English: ' + value);
  }
  try {
    assert(window.Archify, 'Archify runtime is unavailable');

    document.getElementById('btn-node-finder').click();
    assert(!document.getElementById('node-finder').hidden, 'Element finder did not open');
    assert(document.getElementById('node-finder-title').textContent.trim() === 'Найти элемент', 'Element finder is not localized');
    assert(/элемент/.test(document.getElementById('node-finder-status').textContent), 'Element finder count did not render in Russian');
    var firstFinderKind = document.querySelector('.node-finder-result small');
    assert(firstFinderKind, 'Element finder did not render result metadata');
    assertReaderRussian(firstFinderKind.textContent, 'Element finder metadata');
    var firstFinderResult = firstFinderKind.closest('.node-finder-result');
    var firstFinderId = firstFinderResult.getAttribute('data-node-id');
    assert(!firstFinderKind.textContent.includes(firstFinderId), 'Element finder exposes a technical ID');
    assert(!firstFinderKind.title.includes(firstFinderId), 'Element finder tooltip exposes a technical ID');
    Archify.finder.close({ restoreFocus: false });

    Archify.focus.set('request', { toggle: false, updateUrl: false });
    assert(document.getElementById('focus-kind').textContent.trim() === 'Обращение клиента', 'Focused element kind is not localized');
    assertReaderRussian(document.getElementById('focus-chip').textContent, 'Focused element card');
    assert(document.getElementById('focus-id').hidden, 'Focused element exposes the technical ID field');
    assert(!document.getElementById('focus-id').textContent.trim(), 'Focused element exposes a technical ID');
    Archify.focus.clear({ updateUrl: false, preserveView: true });

    var guidedStops = Array.from(document.querySelectorAll('.guided-view-stop'));
    assert(guidedStops.length, 'Guided view did not render stops');
    assertReaderRussian(document.getElementById('guided-view-note').textContent, 'Guided view note');
    guidedStops.forEach(function (stop) {
      assertReaderRussian(stop.title + ' ' + stop.getAttribute('aria-label'), 'Guided view stop');
    });

    document.getElementById('btn-diagram-guide').click();
    assert(!document.getElementById('diagram-guide').hidden, 'Diagram guide did not open');
    assert(/элемент/.test(document.getElementById('diagram-guide-stats').textContent), 'Diagram facts did not render in Russian');
    Archify.guide.close({ restoreFocus: false });

    document.getElementById('btn-overview-map').click();
    assert(!document.getElementById('overview-map').hidden, 'Overview map did not open');
    assert(/элемент/.test(document.getElementById('overview-map-status').textContent), 'Overview map status did not render in Russian');
    assertReaderRussian(document.getElementById('overview-map-status').textContent, 'Overview map status');
    Archify.radar.close({ restoreFocus: false });

    document.getElementById('btn-semantic-lens').click();
    assert(!document.getElementById('semantic-lens').hidden, 'Semantic comparison did not open');
    var firstKindButton = document.querySelector('.semantic-lens-kind');
    assert(firstKindButton, 'Semantic comparison did not render kind buttons');
    assertReaderRussian(firstKindButton.textContent + ' ' + firstKindButton.getAttribute('aria-label'), 'Semantic kind button');
    Archify.semanticLens.select(firstKindButton.getAttribute('data-kind'));
    assert(/элемент|связ/.test(document.getElementById('semantic-lens-status').textContent), 'Semantic comparison status did not render in Russian');
    assertReaderRussian(document.getElementById('semantic-lens-status').textContent, 'Semantic comparison status');
    Archify.semanticLens.clear({ restoreFocus: false });
    Archify.semanticLens.close({ restoreFocus: false });

    document.getElementById('btn-route-probe').click();
    assert(!document.getElementById('route-probe').hidden, 'Route probe did not open');
    assert(document.getElementById('route-probe-title').textContent.trim() === 'Выберите начальный элемент', 'Route probe is not localized');
    Archify.routeProbe.choose('request');
    assert(/доступн/.test(document.getElementById('route-probe-status').textContent), 'Route destinations did not render in Russian');
    Archify.routeProbe.choose('storage');
    assertReaderRussian(document.getElementById('route-probe-status').textContent, 'Route status');
    assert(/→/.test(document.getElementById('route-probe-title').textContent), 'Completed route title was not rendered');
    Array.from(document.querySelectorAll('.route-probe-node[data-route-node-id]')).forEach(function (item) {
      var rawId = item.getAttribute('data-route-node-id');
      assert(!item.title.includes(rawId), 'Route tooltip exposes a technical ID');
    });
    Archify.routeProbe.clear({ restoreFocus: false });

    document.documentElement.setAttribute('data-map-ui-test', 'passed');
  } catch (error) {
    document.documentElement.setAttribute('data-map-ui-test', 'failed');
    document.documentElement.setAttribute('data-map-ui-error', error.message);
  }
}, 250);
</script>`;

const source = readFileSync(htmlPath, 'utf8');
const instrumented = source.replace('</body>', `${selfTest}\n</body>`);
const tempRoot = resolve(import.meta.dirname, '../../temp/map-ui-test');
mkdirSync(tempRoot, { recursive: true });
const testHtml = resolve(tempRoot, 'process-map-test.html');
writeFileSync(testHtml, instrumented, 'utf8');

const result = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--allow-file-access-from-files',
  '--virtual-time-budget=4000', '--dump-dom', `--user-data-dir=${resolve(tempRoot, `profile-${process.pid}`)}`,
  pathToFileURL(testHtml).href + '#view=linked_processes&beat=inspect'
], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Browser exited with ${result.status}: ${result.stderr || result.stdout}`);

const dom = result.stdout;
if (!dom.includes('data-map-ui-test="passed"')) {
  const error = dom.match(/data-map-ui-error="([^"]+)"/)?.[1] || dom.slice(-2000);
  throw new Error(`Map UI self-test failed: ${error}`);
}

console.log(JSON.stringify({
  status: 'passed',
  browser,
  interactions: [ 'поиск', 'карточка элемента', 'помощь', 'мини-карта', 'сравнение типов', 'маршрут' ]
}, null, 2));

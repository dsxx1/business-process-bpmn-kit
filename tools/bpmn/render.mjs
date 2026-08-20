import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, resolve } from 'node:path';
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

function runBrowser(browser, args) {
  const result = spawnSync(browser, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Browser exited with ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function normalizeSvg(svg) {
  const randomMarkerIds = [ ...svg.matchAll(/\bid="(marker-[a-z0-9]{20,})"/gu) ]
    .map((match) => match[1]);
  const markerIds = new Map();
  for (const markerId of randomMarkerIds) {
    if (!markerIds.has(markerId)) {
      markerIds.set(markerId, `marker-${String(markerIds.size + 1).padStart(4, '0')}`);
    }
  }
  let withStableMarkerIds = svg;
  for (const [ markerId, stableMarkerId ] of markerIds) {
    withStableMarkerIds = withStableMarkerIds.replaceAll(markerId, stableMarkerId);
  }
  return withStableMarkerIds.replace(/\r\n?/gu, '\n');
}

const inputPath = resolve(process.argv[2]);
const outputPaths = process.argv.slice(3).map((path) => resolve(path));
if (!existsSync(inputPath)) throw new Error(`BPMN file is missing: ${inputPath}`);
if (outputPaths.length === 0) throw new Error('At least one output path is required.');

const browser = findBrowser();
if (!browser) throw new Error('Chrome/Edge not found. Set BPMN_CHROME_PATH.');

const toolRoot = dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const viewerPath = resolve(toolRoot, 'node_modules/bpmn-js/dist/bpmn-viewer.production.min.js');
if (!existsSync(viewerPath)) throw new Error(`bpmn-js viewer is missing: ${viewerPath}`);

const tempRoot = resolve(toolRoot, '../../temp/bpmn-render');
const profileRoot = resolve(tempRoot, 'browser-profile');
mkdirSync(profileRoot, { recursive: true });

const xmlBase64 = Buffer.from(readFileSync(inputPath, 'utf8'), 'utf8').toString('base64');
const renderPage = resolve(tempRoot, 'render.html');
const viewerUrl = pathToFileURL(viewerPath).href;
writeFileSync(renderPage, `<!doctype html>
<html><head><meta charset="utf-8"><script src="${viewerUrl}"></script></head>
<body><div id="canvas"></div><div id="output"></div><script>
(async () => {
  try {
    const xml = new TextDecoder().decode(Uint8Array.from(atob('${xmlBase64}'), c => c.charCodeAt(0)));
    const viewer = new BpmnJS({ container: '#canvas' });
    await viewer.importXML(xml);
    const result = await viewer.saveSVG();
    document.getElementById('output').innerHTML = result.svg;
    document.documentElement.dataset.renderStatus = 'ready';
  } catch (error) {
    document.documentElement.dataset.renderStatus = 'failed';
    document.getElementById('output').textContent = String(error && error.stack || error);
  }
})();
</script></body></html>`, 'utf8');

const dumpedDom = runBrowser(browser, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--allow-file-access-from-files',
  '--virtual-time-budget=5000', '--dump-dom', `--user-data-dir=${profileRoot}`,
  pathToFileURL(renderPage).href
]);
if (!dumpedDom.includes('data-render-status="ready"')) {
  throw new Error(`bpmn-js did not render the diagram: ${dumpedDom.slice(-2000)}`);
}
const outputMatch = dumpedDom.match(/<div id="output"[^>]*>([\s\S]*?)<\/div>/);
if (!outputMatch || !outputMatch[1].includes('<svg')) {
  throw new Error('Rendered SVG was not found in the browser output.');
}
const svg = normalizeSvg(outputMatch[1]);

for (const outputPath of outputPaths) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const extension = extname(outputPath).toLowerCase();
  if (extension === '.svg') {
    writeFileSync(outputPath, svg, 'utf8');
    continue;
  }
  if (extension !== '.png') throw new Error(`Unsupported output format: ${extension}`);

  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch?.[1].trim().split(/\s+/).map(Number) || [];
  const sourceWidth = Number.isFinite(viewBox[2]) ? viewBox[2] : 1800;
  const sourceHeight = Number.isFinite(viewBox[3]) ? viewBox[3] : 1000;
  const width = Math.max(1200, Math.ceil(sourceWidth + 80));
  const height = Math.max(800, Math.ceil(sourceHeight + 80));
  const screenshotPage = resolve(tempRoot, 'screenshot.html');
  writeFileSync(screenshotPage, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:white} body{padding:40px;box-sizing:border-box} svg{display:block;width:${sourceWidth}px;height:${sourceHeight}px}
</style></head><body>${svg}</body></html>`, 'utf8');
  runBrowser(browser, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    `--window-size=${width},${height}`, '--virtual-time-budget=1000',
    `--screenshot=${outputPath}`, `--user-data-dir=${profileRoot}`,
    pathToFileURL(screenshotPage).href
  ]);
}

console.log(JSON.stringify({
  status: 'rendered',
  engine: 'bpmn-js + system Chromium',
  browser,
  input: inputPath,
  outputs: outputPaths
}, null, 2));

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
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

const htmlPath = resolve(process.argv[2]);
const packageRoot = resolve(process.argv[3] || dirname(dirname(htmlPath)));
if (!existsSync(htmlPath)) throw new Error(`Navigation HTML is missing: ${htmlPath}`);
const meta = JSON.parse(readFileSync(resolve(packageRoot, 'process.meta.json'), 'utf8'));
const expectedLinkedElements = new Set(meta.process_links.map((link) => link.source_element_id)).size;
const browser = findBrowser();
if (!browser) throw new Error('Chrome/Edge not found. Set BPMN_CHROME_PATH.');

const tempRoot = resolve(import.meta.dirname, '../../temp/bpmn-navigation-test');
mkdirSync(tempRoot, { recursive: true });
const result = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--allow-file-access-from-files',
  '--virtual-time-budget=3000', '--dump-dom', `--user-data-dir=${tempRoot}`,
  pathToFileURL(htmlPath).href
], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Browser exited with ${result.status}: ${result.stderr || result.stdout}`);

const dom = result.stdout;
if (!dom.includes('data-navigation-test="passed"')) throw new Error(`Navigation self-test failed: ${dom.slice(-2000)}`);
const linkedMatch = dom.match(/data-linked-elements="(\d+)"/);
const linkedElements = Number(linkedMatch?.[1]);
if (linkedElements !== expectedLinkedElements) throw new Error(`Expected ${expectedLinkedElements} linked BPMN elements, got ${linkedElements}`);

console.log(JSON.stringify({
  status: 'passed',
  title: meta.title,
  browser,
  linked_elements: linkedElements,
  process_links: meta.process_links.length
}, null, 2));

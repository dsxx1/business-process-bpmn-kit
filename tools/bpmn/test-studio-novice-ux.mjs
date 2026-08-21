import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  verifyStudioDependencies,
  writeStudioDependencyStamp
} from './verify-studio-dependencies.mjs';

const toolsRoot = import.meta.dirname;
const projectRoot = resolve(toolsRoot, '..', '..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'bpmn-studio-dependencies-'));

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixtureLock(extra = {}) {
  return {
    name: 'studio-dependency-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'studio-dependency-fixture', version: '1.0.0' },
      'node_modules/required-package': { version: '1.2.3' },
      'node_modules/optional-package': { version: '4.5.6', optional: true }
    },
    ...extra
  };
}

try {
  writeJson(join(temporaryRoot, 'package.json'), { name: 'studio-dependency-fixture', version: '1.0.0' });
  writeJson(join(temporaryRoot, 'package-lock.json'), fixtureLock());
  writeJson(join(temporaryRoot, 'node_modules', 'required-package', 'package.json'), {
    name: 'required-package',
    version: '1.2.3'
  });

  let result = verifyStudioDependencies(temporaryRoot, { requireStamp: false, requiredAssets: [] });
  assert.equal(result.ready, true, 'полный комплект должен проходить проверку без stamp');
  assert.equal(result.packagesVerified, 1, 'отсутствующий optional-пакет не должен блокировать запуск');

  result = verifyStudioDependencies(temporaryRoot, { requiredAssets: [] });
  assert.equal(result.ready, false, 'без install stamp комплект не должен считаться готовым');
  assert.match(result.reason, /Отметка завершённой установки/iu);

  writeStudioDependencyStamp(temporaryRoot, { requiredAssets: [] });
  result = verifyStudioDependencies(temporaryRoot, { requiredAssets: [] });
  assert.equal(result.ready, true, 'валидный install stamp должен подтверждать комплект');

  writeJson(join(temporaryRoot, 'package-lock.json'), fixtureLock({ changed_for_test: true }));
  result = verifyStudioDependencies(temporaryRoot, { requiredAssets: [] });
  assert.equal(result.ready, false, 'изменённый lock-файл должен делать stamp устаревшим');
  assert.match(result.reason, /package-lock\.json изменился/iu);

  writeJson(join(temporaryRoot, 'package-lock.json'), fixtureLock());
  writeStudioDependencyStamp(temporaryRoot, { requiredAssets: [] });
  writeJson(join(temporaryRoot, 'node_modules', 'required-package', 'package.json'), {
    name: 'required-package',
    version: '9.9.9'
  });
  result = verifyStudioDependencies(temporaryRoot, { requiredAssets: [] });
  assert.equal(result.ready, false, 'несовпадающая версия пакета должна блокировать запуск');
  assert.match(result.reason, /Версия пакета required-package/iu);

  rmSync(join(temporaryRoot, 'node_modules', 'required-package'), { recursive: true, force: true });
  result = verifyStudioDependencies(temporaryRoot, { requiredAssets: [] });
  assert.equal(result.ready, false, 'отсутствующий обязательный пакет должен блокировать запуск');
  assert.match(result.reason, /Не установлен обязательный пакет required-package/iu);

  const actual = verifyStudioDependencies(toolsRoot, { requireStamp: false });
  assert.equal(actual.ready, true, `текущая установка tools/bpmn неполна: ${actual.reason}`);

  const launcherPath = join(projectRoot, 'ОТКРЫТЬ-BPMN-РЕДАКТОР.cmd');
  const launcherBytes = readFileSync(launcherPath);
  assert.equal(
    Array.from(launcherBytes).every((byte) => byte <= 0x7f),
    true,
    'CMD должен оставаться ASCII-safe'
  );
  const launcherText = launcherBytes.toString('ascii');
  assert.doesNotMatch(launcherText, /if exist .*bpmn-modeler/iu, 'одного bundle недостаточно для проверки установки');
  assert.match(launcherText, /verify-studio-dependencies\.mjs" --check/iu);
  assert.match(launcherText, /verify-studio-dependencies\.mjs" --write-stamp/iu);
  assert.match(launcherText, /call npm ci/iu);
  assert.match(launcherText, /launch-studio-background\.mjs/iu, 'Studio должна запускаться в фоне с действующей сессией');
  assert.doesNotMatch(launcherText, /node .*studio-server\.mjs/iu, 'корневой launcher не должен держать чёрное окно сервера');

  if (process.platform === 'win32') {
    const help = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '& $env:STUDIO_LAUNCHER --help; exit $LASTEXITCODE'
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, STUDIO_LAUNCHER: launcherPath },
      timeout: 20_000,
      windowsHide: true
    });
    assert.equal(help.status, 0, `ОТКРЫТЬ-BPMN-РЕДАКТОР.cmd --help завершился с кодом ${help.status}: ${help.stderr}`);
    assert.match(help.stdout, /Локальная BPMN-студия/iu);
    assert.match(help.stdout, /Node\.js 22\.12/iu);
  }

  const uiHtml = readFileSync(join(toolsRoot, 'studio-ui', 'index.html'), 'utf8');
  const uiScript = readFileSync(join(toolsRoot, 'studio-ui', 'app.js'), 'utf8');
  for (const id of [
    'check-report',
    'check-first-error',
    'check-results',
    'map-empty-title',
    'map-empty-copy',
    'process-card-content',
    'process-card-missing',
    'questions-summary-count',
    'questions-list',
    'questions-empty',
    'questions-missing'
  ]) {
    assert.match(uiHtml, new RegExp(`id="${id}"`, 'u'), `в интерфейсе отсутствует ${id}`);
  }
  assert.match(uiScript, /check\?\.output/gu, 'UI должен читать check.output');
  assert.match(uiScript, /view\?\.fresh === true/gu, 'актуальная карта должна требовать fresh=true');
  assert.match(uiScript, /view\?\.reason/gu, 'UI должен показывать причину устаревания карты');
  assert.match(uiScript, /view\?\.fresh !== true \|\| state\.dirty/gu, 'несохранённая схема должна скрывать старую карту');
  assert.match(uiScript, /mapFrame\.src = 'about:blank'/gu, 'устаревшая карта не должна оставаться в iframe');
  assert.match(uiScript, /process\?\.supporting\?\.process_card/gu, 'UI должен читать карточку процесса из supporting');
  assert.match(uiScript, /process\?\.supporting\?\.questions/gu, 'UI должен читать реальные вопросы из supporting');
  assert.match(uiScript, /counts\?\.blocking_open/gu, 'UI должен учитывать открытые блокирующие вопросы');
  assert.match(uiScript, /elements\.questionsCount\.textContent = String\(counts\.open\)/gu, 'badge вкладки должен показывать число открытых вопросов');
  assert.match(uiScript, /document\.createElement\(`h\$\{level\}`\)/gu, 'Markdown карточки должен собираться безопасными DOM-узлами');
  assert.match(uiScript, /cell\.textContent = value/gu, 'ячейки Markdown-таблицы должны заполняться через textContent');
  assert.match(uiScript, /title\.textContent = factValue\(question\?\.title/gu, 'текст вопроса должен выводиться через textContent');
  assert.doesNotMatch(uiScript, /processCardContent\.innerHTML|questionsList\.innerHTML/gu, 'supporting-данные нельзя исполнять как HTML');
  assert.match(uiHtml, /Это безопасный просмотр без исполнения HTML/gu, 'интерфейс должен честно объяснять безопасный просмотр Markdown');
  assert.match(uiHtml, /npm run decision:owner/gu, 'рядом с вопросами должен быть указан способ фиксации решения владельца');
  const alignmentTranslations = [
    [ 'Align elements left', 'Выровнять по левому краю' ],
    [ 'Align elements center', 'Выровнять по центру по горизонтали' ],
    [ 'Align elements right', 'Выровнять по правому краю' ],
    [ 'Align elements top', 'Выровнять по верхнему краю' ],
    [ 'Align elements middle', 'Выровнять по центру по вертикали' ],
    [ 'Align elements bottom', 'Выровнять по нижнему краю' ]
  ];
  for (const [ source, translated ] of alignmentTranslations) {
    assert.ok(
      uiScript.includes(`'${source}': '${translated}'`),
      `в меню выравнивания отсутствует точный русский перевод «${source}»`
    );
  }
  assert.match(uiScript, /npm run decision:owner/gu, 'UI должен подсказывать точную команду решения владельца');
  assert.doesNotMatch(uiScript, /keyboard:\s*\{\s*bindTo/gu, 'новый bpmn-js не принимает устаревшую опцию keyboard.bindTo');

  process.stdout.write('Studio novice UX and dependency gate: PASS\n');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const templateRoot = resolve(projectRoot, 'templates', 'process-package');
const defaultOutputRoot = resolve(projectRoot, 'processes');

const transliteration = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}));

const windowsReservedNames = new Set([
  'con', 'prn', 'aux', 'nul', 'clock$',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);

function usage() {
  return `Создание готового пакета бизнес-процесса

  node create-process-package.mjs --title "Любое название" [--slug short-name] [--output-root PATH] [--no-open]

Параметры:
  --title        Любое непустое однострочное название процесса.
  --slug         Короткое имя папки: строчные латинские буквы, цифры и дефисы.
                 Если параметр не задан, имя создаётся из названия автоматически.
  --output-root  Технический каталог для тестовой или временной копии.
                 По умолчанию: processes в корне проекта. Пакет вне processes
                 нельзя зарегистрировать, пока он не перенесён в проект.
  --no-open      Не открывать BPMN-файл после создания.
  --help         Показать эту справку.`;
}

function fail(message) {
  throw new Error(message);
}

function argumentValue(argv, index, name) {
  const argument = argv[index];
  const equalsPrefix = `${name}=`;
  if (argument.startsWith(equalsPrefix)) return { value: argument.slice(equalsPrefix.length), consumed: 0 };
  if (argument !== name) return null;
  if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) fail(`Для ${name} не указано значение.`);
  return { value: argv[index + 1], consumed: 1 };
}

function parseArguments(argv) {
  const options = {
    title: undefined,
    slug: undefined,
    outputRoot: undefined,
    noOpen: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-open') {
      options.noOpen = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    const title = argumentValue(argv, index, '--title');
    if (title) {
      options.title = title.value;
      index += title.consumed;
      continue;
    }
    const slug = argumentValue(argv, index, '--slug');
    if (slug) {
      options.slug = slug.value;
      index += slug.consumed;
      continue;
    }
    const outputRoot = argumentValue(argv, index, '--output-root');
    if (outputRoot) {
      options.outputRoot = outputRoot.value;
      index += outputRoot.consumed;
      continue;
    }
    fail(`Неизвестный параметр: ${argument}`);
  }

  return options;
}

function validateTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) fail('Название процесса не может быть пустым.');
  if (title.length > 200) fail('Название процесса не должно быть длиннее 200 символов.');
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(title)) {
    fail('Название процесса должно быть записано в одну строку без управляющих символов.');
  }
  return title;
}

function slugify(title) {
  let source = title.toLocaleLowerCase('ru-RU').normalize('NFKD');
  source = [ ...source ].map((character) => transliteration.get(character) ?? character).join('');
  source = source.replace(/[\u0300-\u036f]/gu, '');
  source = source.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  if (!/^[a-z]/.test(source)) source = `process-${source || 'new'}`;
  if (source.length < 3) source = `${source}-process`;
  source = source.slice(0, 64).replace(/-+$/g, '');
  return source;
}

function validateSlug(value) {
  const slug = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
    fail('Короткое имя должно начинаться с латинской буквы и содержать только строчные латинские буквы, цифры и одиночные дефисы.');
  }
  if (slug.length < 3 || slug.length > 64) fail('Короткое имя должно содержать от 3 до 64 символов.');
  if (windowsReservedNames.has(slug)) fail(`Короткое имя ${slug} зарезервировано операционной системой.`);
  return slug;
}

function technicalStem(slug) {
  return slug
    .split('-')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('');
}

function escapeXmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function containedTarget(root, slug) {
  const target = resolve(root, slug);
  const relation = relative(root, target);
  if (!relation || relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
    fail('Небезопасный путь назначения. Пакет должен находиться внутри указанного каталога.');
  }
  return target;
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function replaceIdentifiers(value, replacements) {
  return value
    .replaceAll('PROCESS-TEMPLATE', replacements.processId)
    .replaceAll('Definitions_Template', replacements.definitionsId)
    .replaceAll('Collaboration_Template', replacements.collaborationId)
    .replaceAll('Process_Template', replacements.processElementId)
    .replaceAll('LaneSet_Template', replacements.laneSetId)
    .replaceAll('BPMNDiagram_Template', replacements.diagramId)
    .replaceAll('BPMNPlane_Template', replacements.planeId)
    .replaceAll('process-template', replacements.slug);
}

function transformJson(value, replacements) {
  if (typeof value === 'string') {
    return replaceIdentifiers(value, replacements).replaceAll('Новый бизнес-процесс', replacements.title);
  }
  if (Array.isArray(value)) return value.map((item) => transformJson(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ key, transformJson(item, replacements) ]));
  }
  return value;
}

function generatedPackageReadme(title) {
  return `# ${title}

Это готовый черновик процесса, созданный из нейтральной BPMN 2.0-модели. Эталонная схема хранится в \`bpmn/process.bpmn\`. Статус пакета — \`draft\`: техническая генерация не означает, что процесс утверждён владельцем.

## Что делать дальше

1. В корне проекта дважды щёлкните \`ОТКРЫТЬ-BPMN-РЕДАКТОР.cmd\`.
2. Откройте этот процесс и замените стартовые роли, действия, развилку и результаты на реальный маршрут.
3. Сохраните схему и нажмите «Проверить». Для публикации черновика используйте действие «Зарегистрировать» в редакторе.
4. Заполните \`process-card.md\`: цель, границы, роли, основной маршрут и исключения.
5. Запишите проверяемые основания в \`evidence/README.md\`, а неизвестные факты — вопросами в \`bpmn/questions.json\`.
6. Решение об утверждении принимает уполномоченный владелец через защищённый Merge Request. Для технической фиксации уже согласованного решения используйте из \`tools/bpmn\` команду \`npm run decision:owner -- <короткое-имя>\`.

Не выводите пакет из статуса \`draft\` и не редактируйте журнал решений вручную. Регистрация оставляет его черновиком; бизнес-статус меняется только после явного решения уполномоченного владельца. Локальный мастер не проверяет личность человека, поэтому публикация решения должна пройти обязательное согласование владельца через защищённый Merge Request в GitLab. Автоматическая проверка его не заменяет.
`;
}

function transformPackage(packageRoot, title, slug) {
  const stem = technicalStem(slug);
  const replacements = {
    title,
    slug,
    processId: slug.toUpperCase(),
    definitionsId: `Definitions_${stem}`,
    collaborationId: `Collaboration_${stem}`,
    processElementId: `Process_${stem}`,
    laneSetId: `LaneSet_${stem}`,
    diagramId: `BPMNDiagram_${stem}`,
    planeId: `BPMNPlane_${stem}`
  };

  for (const path of walkFiles(packageRoot)) {
    if (path.endsWith('.json')) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const transformed = transformJson(parsed, replacements);
      writeFileSync(path, `${JSON.stringify(transformed, null, 2)}\n`, 'utf8');
      continue;
    }
    if (path.endsWith('.bpmn')) {
      const xmlTitle = escapeXmlAttribute(title);
      const transformed = replaceIdentifiers(readFileSync(path, 'utf8'), replacements)
        .replaceAll('Новый бизнес-процесс', xmlTitle);
      writeFileSync(path, transformed, 'utf8');
      continue;
    }
    if (path.endsWith('.md')) {
      const transformed = replaceIdentifiers(readFileSync(path, 'utf8'), replacements)
        .replaceAll('Новый бизнес-процесс', title);
      writeFileSync(path, transformed, 'utf8');
    }
  }

  const bpmnRoot = resolve(packageRoot, 'bpmn');
  const metaPath = resolve(bpmnRoot, 'process.meta.json');
  const questionsPath = resolve(bpmnRoot, 'questions.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const questions = JSON.parse(readFileSync(questionsPath, 'utf8'));

  function ownedReferencePath(ref) {
    if (typeof ref !== 'string' || (!ref.startsWith('./') && !ref.startsWith('../'))) {
      fail(`Ссылка пакета должна быть относительной: ${String(ref)}`);
    }
    const referencePath = resolve(bpmnRoot, ref);
    const relation = relative(packageRoot, referencePath);
    if (relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
      fail(`Ссылка выходит за пределы пакета: ${ref}`);
    }
    return referencePath;
  }

  meta.process_id = replacements.processId;
  meta.title = title;
  meta.bpmn.definitions_id = replacements.definitionsId;
  meta.bpmn.process_element_id = replacements.processElementId;
  meta.bpmn.collaboration_id = replacements.collaborationId;
  meta.source_card.sha256 = sha256(ownedReferencePath(meta.source_card.ref));
  for (const evidence of meta.evidence) {
    evidence.sha256 = sha256(ownedReferencePath(evidence.ref));
  }

  if (questions.questions?.[0]) {
    questions.questions[0].title = `Кто является уполномоченным владельцем процесса «${title}»?`;
  }

  writeFileSync(resolve(packageRoot, 'README.md'), generatedPackageReadme(title), 'utf8');
  writeFileSync(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  const placeholders = /PROCESS-TEMPLATE|(?:Definitions|Collaboration|Process|LaneSet|BPMNDiagram|BPMNPlane)_Template|process-template|Новый бизнес-процесс/u;
  for (const path of walkFiles(packageRoot).filter((file) => /\.(?:bpmn|json|md)$/u.test(file))) {
    if (placeholders.test(readFileSync(path, 'utf8'))) {
      fail(`В созданном файле остался шаблонный заполнитель: ${relative(packageRoot, path)}`);
    }
  }

  return replacements;
}

function safeRemoveStage(outputRoot, stageRoot) {
  const relation = relative(outputRoot, stageRoot);
  if (!relation.startsWith('.process-package-') || relation.includes(sep) || isAbsolute(relation)) {
    fail('Отказ от удаления неожиданного временного пути.');
  }
  rmSync(stageRoot, { recursive: true, force: true });
}

function renameDirectoryWithRetry(source, target) {
  const transientWindowsErrors = new Set([ 'EACCES', 'EBUSY', 'EPERM' ]);
  const pauseBuffer = new Int32Array(new SharedArrayBuffer(4));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      const canRetry = process.platform === 'win32'
        && transientWindowsErrors.has(error?.code)
        && attempt < 9
        && !existsSync(target);
      if (!canRetry) throw error;
      Atomics.wait(pauseBuffer, 0, 0, 25 * (attempt + 1));
    }
  }
}

function createPackage({ title, slug, outputRoot }) {
  if (!existsSync(templateRoot) || !statSync(templateRoot).isDirectory()) fail(`Шаблон не найден: ${templateRoot}`);
  mkdirSync(outputRoot, { recursive: true });
  if (!statSync(outputRoot).isDirectory()) fail(`Путь назначения не является каталогом: ${outputRoot}`);

  const targetRoot = containedTarget(outputRoot, slug);
  if (existsSync(targetRoot)) fail(`Папка уже существует, поэтому ничего не перезаписано: ${targetRoot}`);

  const stageRoot = mkdtempSync(join(outputRoot, '.process-package-'));
  const stagedPackageRoot = resolve(stageRoot, 'package');
  try {
    cpSync(templateRoot, stagedPackageRoot, { recursive: true, force: false, errorOnExist: true });
    const replacements = transformPackage(stagedPackageRoot, title, slug);
    renameDirectoryWithRetry(stagedPackageRoot, targetRoot);
    return { targetRoot, bpmnPath: resolve(targetRoot, 'bpmn', 'process.bpmn'), replacements };
  } finally {
    if (existsSync(stageRoot)) safeRemoveStage(outputRoot, stageRoot);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.title === undefined) fail('Для создания пакета укажите название через --title.');
  options.title = validateTitle(options.title);
  options.slug = options.slug === undefined ? slugify(options.title) : validateSlug(options.slug);

  const title = validateTitle(options.title);
  const slug = validateSlug(options.slug);
  const outputRoot = options.outputRoot === undefined
    ? defaultOutputRoot
    : resolve(process.cwd(), options.outputRoot);
  const result = createPackage({ title, slug, outputRoot });

  console.log(`\nГотовый пакет создан: ${result.targetRoot}`);
  console.log(`BPMN-модель: ${result.bpmnPath}`);
  console.log(`Технический ID процесса: ${result.replacements.processId}`);
}

main().catch((error) => {
  console.error(`Ошибка создания пакета: ${error.message}`);
  process.exitCode = 1;
});

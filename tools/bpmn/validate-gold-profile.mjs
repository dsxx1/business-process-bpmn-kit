import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { BpmnModdle } from 'bpmn-moddle';

const packageRoot = resolve(process.argv[2] || '../../processes/skupka-zolota/bpmn');
const meta = JSON.parse(readFileSync(resolve(packageRoot, 'process.meta.json'), 'utf8'));
const questions = JSON.parse(readFileSync(resolve(packageRoot, 'questions.json'), 'utf8'));
const xml = readFileSync(resolve(packageRoot, 'process.bpmn'), 'utf8');

if (meta.process_id !== 'GOLD-BUYING') throw new Error(`Unexpected process_id: ${meta.process_id}`);
if (meta.title !== 'Скупка золота и драгоценных металлов') throw new Error(`Unexpected title: ${meta.title}`);
if (/(?:БП|BP)-?\d+|Task_OP\d+|ОП-\d+/iu.test(xml + JSON.stringify(meta) + JSON.stringify(questions))) {
  throw new Error('Legacy numeric process or task code leaked into the package');
}

const parsed = await new BpmnModdle().fromXML(xml);
const processElement = parsed.rootElement.rootElements.find((element) => element.$type === 'bpmn:Process');
const expectedTasks = [
  'Task_ClarifyClientRequest',
  'Task_InspectItem',
  'Task_CalculatePreliminaryPrice',
  'Task_IdentifyClient',
  'Task_AgreeTermsAndPrice',
  'Task_PrepareDocuments',
  'Task_VerifyTermsAndDocuments',
  'Task_SignPostAndConfirmPayment',
  'Task_SecureAndPrepareHandoff'
];
const ids = new Set(processElement.flowElements.map((element) => element.id));
for (const id of expectedTasks) {
  if (!ids.has(id)) throw new Error(`Required semantic task is missing: ${id}`);
}
const openBlocking = questions.questions.filter((question) => question.blocking && question.status === 'open').length;
if (openBlocking !== 10) throw new Error(`Expected 10 open blocking questions, got ${openBlocking}`);
if (meta.process_links.length !== 7) throw new Error(`Expected 7 process links, got ${meta.process_links.length}`);

console.log(JSON.stringify({
  status: 'passed',
  title_is_human_readable: true,
  semantic_task_ids: expectedTasks.length,
  legacy_numeric_codes: 0,
  open_blocking_questions: openBlocking,
  process_links: meta.process_links.length
}, null, 2));

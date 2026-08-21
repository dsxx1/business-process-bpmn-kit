import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const templateRoot = resolve(projectRoot, 'templates', 'process-package');
const tempRoot = resolve(projectRoot, 'temp', 'semantic-bpmn-id-test');
const bpmnRoot = resolve(tempRoot, 'bpmn');
const bpmnPath = resolve(bpmnRoot, 'process.bpmn');
const validatorPath = resolve(import.meta.dirname, 'validate-package.mjs');

if (tempRoot !== resolve(projectRoot, 'temp', 'semantic-bpmn-id-test') || !tempRoot.startsWith(`${resolve(projectRoot, 'temp')}${sep}`)) {
  throw new Error('Небезопасный путь временной проверки BPMN ID');
}

rmSync(tempRoot, { recursive: true, force: true });

try {
  cpSync(templateRoot, tempRoot, { recursive: true });
  const xml = readFileSync(bpmnPath, 'utf8').replaceAll('Task_ClarifyInput', 'Activity_1abc');
  writeFileSync(bpmnPath, xml, 'utf8');

  const result = spawnSync(process.execPath, [ validatorPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1, `Валидатор принял автоматически созданный BPMN ID: ${result.stdout}`);
  assert.match(
    result.stderr,
    /replace generated or numeric ids: Activity_1abc/u,
    'Ошибка не объясняет, какой автоматически созданный ID нужно заменить'
  );

  rmSync(tempRoot, { recursive: true, force: true });
  cpSync(templateRoot, tempRoot, { recursive: true });
  writeFileSync(
    bpmnPath,
    readFileSync(bpmnPath, 'utf8').replace('name="Уточнить входные данные"', 'name="ОП-03"'),
    'utf8'
  );
  const opaqueLabel = spawnSync(process.execPath, [ validatorPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  assert.equal(opaqueLabel.status, 1, 'Валидатор принял внутренний код вместо понятной подписи.');
  assert.match(opaqueLabel.stderr, /внутренний код нужно заменить/u);

  rmSync(tempRoot, { recursive: true, force: true });
  cpSync(templateRoot, tempRoot, { recursive: true });
  writeFileSync(
    bpmnPath,
    readFileSync(bpmnPath, 'utf8').replace('name="Уточнить входные данные"', 'name="Check input"'),
    'utf8'
  );
  const englishLabel = spawnSync(process.execPath, [ validatorPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  assert.equal(englishLabel.status, 1, 'Валидатор принял английскую подпись пользовательского действия.');
  assert.match(englishLabel.stderr, /понятной русской фразой/u);

  rmSync(tempRoot, { recursive: true, force: true });
  cpSync(templateRoot, tempRoot, { recursive: true });
  writeFileSync(
    bpmnPath,
    readFileSync(bpmnPath, 'utf8').replace(' name="Организация"', ''),
    'utf8'
  );
  const unnamedParticipant = spawnSync(process.execPath, [ validatorPath, bpmnRoot ], {
    cwd: import.meta.dirname,
    encoding: 'utf8'
  });
  assert.equal(unnamedParticipant.status, 1, 'Валидатор принял участника без понятного названия.');
  assert.match(unnamedParticipant.stderr, /Участник Participant_Organization/u);

  console.log(JSON.stringify({
    status: 'passed',
    generated_numeric_id_rejected: true,
    rejected_id: 'Activity_1abc',
    opaque_reader_code_rejected: true,
    english_reader_label_rejected: true,
    unnamed_participant_rejected: true
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

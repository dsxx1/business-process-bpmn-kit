import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const uiRoot = resolve(import.meta.dirname, 'studio-ui');
const html = readFileSync(resolve(uiRoot, 'index.html'), 'utf8');
const script = readFileSync(resolve(uiRoot, 'app.js'), 'utf8');
const styles = readFileSync(resolve(uiRoot, 'styles.css'), 'utf8');

assert.match(html, /id="transition-panel"[\s\S]*Связать с другим процессом/gu);
assert.match(html, /value="registered"[\s\S]*Процесс уже есть/gu);
assert.match(html, /value="reserved"[\s\S]*Процесс появится позже/gu);
assert.match(html, /value="unknown"[\s\S]*Пока неизвестно/gu);
assert.match(html, /id="transitions-list"/gu);
assert.match(html, /Куда процесс передаёт работу/gu);
assert.match(html, /id="transition-convert"[\s\S]*Сначала обозначьте переход в другой процесс/gu);
assert.match(html, /id="convert-to-call-activity-button"[\s\S]*Сделать этот шаг вызовом другого процесса/gu);
assert.match(html, /id="future-process-dialog"[\s\S]*Карточка будущего процесса/gu);

assert.match(script, /businessObject\?\.\$type === 'bpmn:CallActivity'/gu);
assert.match(script, /get\('bpmnReplace'\)\.replaceElement\(selected, \{ type: 'bpmn:CallActivity' \}\)/gu);
assert.match(script, /isCallActivity\(selected\) \|\| isConvertibleTask\(selected\)/gu);
assert.match(script, /\/transition-targets/gu);
assert.match(script, /\/transitions`/gu);
assert.match(script, /method: linkId \? 'PUT' : 'POST'/gu);
assert.match(script, /method: 'DELETE'/gu);
assert.match(script, /replaceElement\(selected, \{ type: 'bpmn:Task' \}\)/gu);
assert.match(script, /xml = await serializeCurrentXml\(\)/gu);
assert.match(script, /if \(converted && commandStack\.canUndo\(\)\) commandStack\.undo\(\)/gu);
assert.match(script, /Блок останется на BPMN-схеме как обычный шаг/gu);
assert.match(script, /target: transitionTargetFromForm\(\)/gu);
assert.match(script, /expected_bpmn_sha256: bpmnSha/gu);
assert.match(script, /expected_meta_sha256: metaSha/gu);

assert.match(script, /\[ 'canonical', 'candidate' \]\.includes\(link\.target_status\)/gu);
assert.doesNotMatch(script, /target_status === 'resolved'/gu);
assert.match(script, /open\.kind === 'process'/gu);
assert.match(script, />Открыть процесс<\/button>/gu);
assert.match(script, /selectProcess\(button\.dataset\.openTransitionTarget\)/gu);
assert.match(script, /open\.kind === 'card' && typeof open\.card_markdown === 'string'/gu);
assert.match(script, /futureProcessCard\.textContent = open\.card_markdown/gu);
assert.match(script, />Открыть карточку будущего процесса<\/button>/gu);
assert.match(script, /data-create-future-process=/gu);
assert.match(script, /body: JSON\.stringify\(\{ title: reserved\.title, slug: reserved\.slug \}\)/gu);

assert.match(styles, /\.transition-panel\s*\{/gu);
assert.match(styles, /\.transition-choice:has\(input:checked\)/gu);
assert.match(styles, /\.transition-card\.unresolved/gu);
assert.match(styles, /\.future-process-card-text\s*\{/gu);

process.stdout.write('Studio cross-process transition UI contract: PASS\n');

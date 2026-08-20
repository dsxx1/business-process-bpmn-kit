import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { layoutProcess } from 'bpmn-auto-layout';

const inputPath = resolve(process.argv[2]);
const xml = readFileSync(inputPath, 'utf8');
const result = await layoutProcess(xml);
const layouted = typeof result === 'string' ? result : result.xml;
const warnings = typeof result === 'string' ? [] : result.warnings;
writeFileSync(inputPath, layouted, 'utf8');
console.log(JSON.stringify({ status: 'layouted', file: inputPath, warnings }, null, 2));

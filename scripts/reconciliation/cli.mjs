#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { canonicalJson, parseArtifact } from './artifact.mjs';
import { reconcileArtifacts } from './runner.mjs';

const { values } = parseArgs({ options: { source: { type: 'string' }, target: { type: 'string' }, config: { type: 'string' }, pretty: { type: 'boolean', default: false } } });
if (!values.source || !values.target || !values.config) throw new Error('usage: cli.mjs --source FILE --target FILE --config FILE [--pretty]');
const [sourceBytes, targetBytes, configBytes] = await Promise.all([readFile(values.source), readFile(values.target), readFile(values.config)]);
const result = reconcileArtifacts(parseArtifact(sourceBytes, 'source'), parseArtifact(targetBytes, 'target'), JSON.parse(configBytes));
process.stdout.write(values.pretty ? `${JSON.stringify(result, null, 2)}\n` : `${canonicalJson(result)}\n`);

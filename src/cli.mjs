import { parseArgs } from 'node:util';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { links, scenes } from '../data/chats.mjs';
import { demoQuestion, questions } from '../data/questions.mjs';
import { benchmark, methods } from './benchmark.mjs';
import { createGraph, openGraph } from './graph.mjs';
import { retrieve } from './retrieval.mjs';

const defaultStore = fileURLToPath(new URL('../data/demo.rl', import.meta.url));
const dateFromIso = value => {
  const timestamp = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date ${value}. Use YYYY-MM-DD.`);
  }
  return value;
};

function printDemo(question, target, result) {
  console.log(`\n${question}\n${target}\n`);
  const scenesById = new Map(scenes.map(scene => [scene.id, scene]));
  for (const method of methods) {
    console.log(`${method.padEnd(8)} ${result[method].map(hit => `${hit.date.slice(5)} ${hit.id}`).join('  |  ') || '근거 없음'}`);
  }
  const selected = [...result.relate].sort((a, b) => a.date.localeCompare(b.date));
  console.log('\n날짜별 카톡 후보 근거');
  for (const hit of selected) {
    const scene = scenesById.get(hit.id);
    console.log(`\n${scene.date}  ${scene.id}${hit.path ? `  [${hit.path.join(' → ')}]` : ''}`);
    if (hit.reasons) console.log(`  연결: ${hit.reasons.join(' / ')}`);
    for (const [speaker, message] of scene.lines) console.log(`  ${speaker}: ${message}`);
  }
  if (!selected.length) console.log('  이 기간에 확인할 수 있는 장면이 없어요.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({
    args,
    options: {
      store: { type: 'string' },
      couple: { type: 'string', default: 'morning' },
      question: { type: 'string' },
      from: { type: 'string' },
      through: { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (!['demo', 'benchmark', 'inspect', 'seed'].includes(command)) {
    throw new Error('Use npm run demo, npm run benchmark, npm run inspect or npm run seed.');
  }

  const store = resolve(values.store ?? defaultStore);
  if (command === 'seed') {
    if (!store.endsWith('.rl')) throw new Error('The store path must end in .rl.');
    mkdirSync(dirname(store), { recursive: true });
    const temporary = `${store}.${randomUUID()}.rl`;
    try {
      createGraph(temporary, scenes, links);
      renameSync(temporary, store);
    } finally {
      rmSync(temporary, { force: true });
    }
    console.log(`Wrote ${scenes.length} scenes and ${links.length} relationships to ${store}`);
    return;
  }

  const graph = openGraph(store);
  if (command === 'inspect') {
    console.table(graph.query(`MATCH (a:Scene)-[r:CONTINUED_IN]->(b:Scene)
      RETURN a.couple AS couple, a.id AS start, a.date AS firstDate, b.id AS next,
        b.date AS nextDate, r.label AS explanation
      ORDER BY couple, start`).rows);
    return;
  }
  const { loadEmbeddings } = await import('./embeddings.mjs');
  const start = performance.now();
  const embeddings = await loadEmbeddings(scenes);
  await embeddings.query(demoQuestion);
  const indexMs = performance.now() - start;
  const search = async ({ question, couple, from, through }) => {
    const begin = performance.now();
    const vector = await embeddings.query(question);
    const embeddingMs = performance.now() - begin;
    const timings = {};
    const hits = retrieve({ scenes, graph, vectors: embeddings.vectors, vector, question, couple, from, through, timings });
    return { hits, timings, embeddingMs };
  };

  if (command === 'demo') {
    if (!scenes.some(scene => scene.couple === values.couple)) throw new Error('Choose the morning or evening demo couple.');
    const question = (values.question ?? demoQuestion).trim();
    if (!question) throw new Error('Enter a question.');
    const from = values.from === undefined ? undefined : dateFromIso(values.from);
    const through = values.through === undefined ? undefined : dateFromIso(values.through);
    if (from && through && from > through) throw new Error('The start date must be on or before the end date.');
    const { hits } = await search({ question, couple: values.couple, from, through });
    if (values.json) console.log(JSON.stringify(hits, null, 2));
    else printDemo(question, `${values.couple} · ${from ?? '처음'} ~ ${through ?? '마지막'}`, hits);
    return;
  }

  const report = await benchmark(questions, search);
  if (values.json) {
    console.log(JSON.stringify({ indexMs, ...report }, null, 2));
    return;
  }
  for (const group of ['connected', 'single', 'stress', 'overall']) {
    const groupReport = report[group];
    console.log(`\n${group}`);
    console.table(methods.map(method => {
      const row = groupReport[method];
      return {
        method,
        allEvidence: `${row.allEvidence}/${row.questionsWithEvidence}`,
        meanRecall: `${(row.meanRecall * 100).toFixed(1)}%`,
        irrelevantScenes: row.irrelevantScenes,
        abstained: row.questionsWithoutEvidence ? `${row.abstentions}/${row.questionsWithoutEvidence}` : '—',
        searchMs: row.medianSearchMs.toFixed(2),
      };
    }));
  }
  console.log(`\nWarm query embedding: ${report.embeddingMs.toFixed(2)} ms mean. Model load, indexing and warm-up: ${indexMs.toFixed(0)} ms.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

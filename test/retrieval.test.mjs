import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scenes as demoScenes, links as demoLinks } from '../data/chats.mjs';
import { createGraph, expandTrail, openGraph } from '../src/graph.mjs';
import { retrieve } from '../src/retrieval.mjs';

const scenes = [
  ['a1', 'alpha', '2026-11-03', '약속이 또 바뀌었어.'],
  ['a2', 'alpha', '2026-11-05', '전날 시간을 확인하자.'],
  ['a3', 'alpha', '2026-11-08', '어제 확인한 그대로 도착했어.'],
  ['a4', 'alpha', '2026-11-07', '정기 검진 약속 잡았어.'],
  ['a5', 'alpha', '2026-11-09', '다음 달 식사 약속은 토요일.'],
  ['a6', 'alpha', '2026-11-10', '이번 주 동창 모임 약속.'],
  ['b1', 'beta', '2026-11-03', '우리 약속은 잘 확인했어.'],
].map(([id, couple, date, text]) => ({ id, couple, date, lines: [['A', text]] }));

const links = [
  { from: 'a1', to: 'a2', label: '두 사람이 정한 방법' },
  { from: 'a2', to: 'a3', label: '이후 확인 메시지' },
];

const fixture = {
  scenes,
  graph: createGraph(':memory:', scenes, links),
  vector: [1, 0],
  vectors: new Map(scenes.map((scene, i) => [scene.id, [[1, 0], [0.3, 0.95], [0.2, 0.98], [0.9, 0.44], [0.85, 0.52], [0.8, 0.6], [1, 0]][i]])),
  couple: 'alpha',
};

test('a follow-up question retrieves dated evidence through two actual Relate edges', () => {
  const result = retrieve({ ...fixture, question: '약속이 어긋난 뒤에 합의한 방법을 실제로 지켰어?' });
  assert.deepEqual(result.semantic.map(hit => hit.id), ['a1', 'a4', 'a5', 'a6']);
  assert.deepEqual(result.relate.map(hit => hit.id), ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(result.relate[2].path, ['a1', 'a2', 'a3']);
  assert.deepEqual(result.relate[2].reasons, ['두 사람이 정한 방법', '이후 확인 메시지']);
});

test('a simple lookup keeps the same evidence ranking as semantic search', () => {
  const result = retrieve({ ...fixture, question: '약속은 언제였어?' });
  assert.deepEqual(result.relate, result.semantic);
  assert.deepEqual(result.keyword.map(hit => hit.id), ['a6', 'a5', 'a4', 'a1']);
});

test('a date filter covers the entire path and every retrieval method', () => {
  const result = retrieve({
    ...fixture, question: '약속 뒤에 어떻게 달라졌어?', from: '2026-11-06', through: '2026-11-08',
  });
  for (const hits of Object.values(result)) {
    assert.ok(hits.every(hit => ['a3', 'a4'].includes(hit.id)));
  }
  assert.deepEqual(expandTrail(fixture.graph, 'alpha', 'a3', '2026-11-06', '2026-11-08'), []);
});

test('links across couples are rejected, and a foreign anchor returns no evidence', () => {
  assert.throws(() => createGraph(':memory:', scenes, [{ from: 'a1', to: 'b1', label: 'cross-couple' }]), /same couple/);
  assert.deepEqual(expandTrail(fixture.graph, 'beta', 'a1'), []);
});

test('an empty date interval yields no evidence in any method', () => {
  assert.deepEqual(retrieve({ ...fixture, question: '약속 이후 뭐가 달라졌어?', from: '2026-11-21' }),
    { keyword: [], semantic: [], relate: [] });
});

test('the committed graph has the same attached scenes and links as the public fixtures', () => {
  const path = fileURLToPath(new URL('../data/demo.rl', import.meta.url));
  const connection = openGraph(path);

  assert.deepEqual(
    connection.query('MATCH (c:Couple)-[:HAS_SCENE]->(s:Scene) RETURN c.id AS couple, s.id AS id, s.date AS date, s.transcript AS transcript ORDER BY id').rows,
    demoScenes.map(({ couple, id, date, lines }) => ({
      couple, id, date, transcript: lines.map(([speaker, message]) => `${speaker}: ${message}`).join('\n'),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(
    connection.query('MATCH (a:Scene)-[r:CONTINUED_IN]->(b:Scene) RETURN a.id AS source, b.id AS target, r.label AS label ORDER BY source').rows,
    demoLinks.map(({ from, to, label }) => ({ source: from, target: to, label })).sort((a, b) => a.source.localeCompare(b.source)),
  );
});

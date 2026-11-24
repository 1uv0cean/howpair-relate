import assert from 'node:assert/strict';
import test from 'node:test';
import { createChat, groundedAnswer, queryWithHistory } from '../src/chat.mjs';
import { validateLinks } from '../src/auto-links.mjs';

const first = { id: 'a', couple: 'one', date: '2026-11-02', lines: [['A', '약속이 갑자기 바뀌었어.']] };
const second = { id: 'b', couple: 'one', date: '2026-11-05', lines: [['B', '전날 저녁에 확인하자.']] };
const other = { ...second, id: 'c', couple: 'two' };
const evidence = [first, second];
const modelAnswer = (answer, citations) => ({ answer, citations, partial: false });

test('grounded answers only expose citations to exact quotes in the selected scenes', async () => {
  const generate = async () => modelAnswer('전날 확인하기로 했어요.', ['b.1']);
  const answer = await groundedAnswer({ question: '뭘 정했어?', previous: [], evidence, generate });
  assert.equal(answer.status, 'supported');
  assert.deepEqual(answer.claims[0].citations, [{ id: 'b', date: '2026-11-05', by: 'B', quote: '전날 저녁에 확인하자.' }]);
});

test('invented line numbers and references to scenes outside the search both fail closed', async () => {
  for (const id of ['b.99', 'c.1']) {
    const generate = async () => modelAnswer('항상 잘 만났어요.', [id]);
    const answer = await groundedAnswer({ question: '도움이 됐어?', previous: [], evidence, generate });
    assert.equal(answer.status, 'absent');
    assert.deepEqual(answer.claims, []);
  }
});

test('empty evidence skips generation and the model can explicitly abstain with candidates', async () => {
  const generate = async () => { throw Error('should not call the model'); };
  const empty = await groundedAnswer({ question: '그때 어땠어?', previous: [], evidence: [], generate });
  assert.equal(empty.status, 'absent');
  const insufficient = await groundedAnswer({
    question: '약이 있었어?', previous: [], evidence, generate: async () => modelAnswer('', []),
  });
  assert.equal(insufficient.status, 'absent');
});

test('follow-ups can use the subject of the immediately preceding question', () => {
  assert.match(queryWithHistory('그 뒤엔 어떻게 됐어?', ['약속이 갑자기 취소됐을 때 뭐라고 했어?']), /약속이/);
  assert.equal(queryWithHistory('치과에 언제 갔어?', ['약속이 취소됐어?']), '치과에 언제 갔어?');
});

test('automatic relationships require chronological evidence in the same couple and the original quotes', () => {
  const good = { from: 'a.1', to: 'b.1', kind: 'agreement' };
  assert.deepEqual(validateLinks([good, { ...good, to: 'c.1' }, { ...good, from: 'a.99' }], [first, second, other], 'a'),
    [{ from: 'a', to: 'b', label: '해결 방법을 정함' }]);
  assert.deepEqual(validateLinks([{ ...good, from: 'b.1', to: 'a.1' }], evidence, 'a'), []);
});


test('the chatbot can still answer with semantic evidence if automatic links fail', async () => {
  const chat = createChat({
    scenes: evidence,
    embeddings: { vectors: new Map([['a', [1]], ['b', [0.5]]]), query: async () => [1] },
    generate: async ({ name }) => {
      if (name === 'scene_links') throw Error('graph inference unavailable');
      return modelAnswer('전날 저녁에 확인하기로 했어요.', ['b.1']);
    },
  });
  const answer = await chat({ question: '약속 뒤에 어떻게 됐어?', couple: 'one' });
  assert.equal(answer.status, 'supported');
  assert.equal(answer.linkStatus, 'failed');
  assert.deepEqual(answer.links, []);
});

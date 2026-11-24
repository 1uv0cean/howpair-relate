const $ = selector => document.querySelector(selector);
const couple = $('#couple');
const method = $('#method');
const composer = $('#composer');
const question = $('#question');
const send = $('#send');
const status = $('#status');
const examples = $('#examples');
const thread = $('#thread');
const prompts = {
  morning: ['약속이 자꾸 틀어졌을 때, 뒤에 정한 방법을 실제로 지켰어?', '여행 예산 문제 뒤에 세운 기준을 예약 때에도 지켰어?'],
  evening: ['밤에 통화 소리 때문에 잠을 못 잔 뒤에 정한 방법이 실제로 효과가 있었어?', '공과금을 연체할 뻔한 뒤에 둘이 정한 방법을 실제로 써봤어?'],
};
let previous = [];
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

function showPrompts() {
  examples.replaceChildren(...prompts[couple.value].map(prompt => {
    const button = element('button', prompt);
    button.type = 'button';
    button.addEventListener('click', () => {
      question.value = prompt;
      question.focus();
    });
    return button;
  }));
}

couple.addEventListener('change', () => {
  previous = [];
  thread.replaceChildren();
  question.value = '';
  showPrompts();
  status.textContent = '';
});
showPrompts();

function showAnswer(reply, answer) {
  if (answer.status === 'absent') {
    reply.append(element('p', '이 질문에 답할 만한 근거를 카톡에서 찾지 못했어요.'));
    return;
  }
  if (answer.status === 'partial') reply.append(element('p', '카톡에서 확인되는 부분만 답할게요.'));
  for (const claim of answer.claims) {
    const sources = element('details');
    sources.append(element('summary', '카톡 근거'));
    for (const citation of claim.citations) {
      sources.append(element('blockquote', `${citation.date} · ${citation.by}\n${citation.quote}`));
    }
    reply.append(element('p', claim.text), sources);
  }
  if (answer.linkStatus === 'failed') reply.append(element('p', '연결을 확인할 수 없어 의미 검색 결과로 답했어요.', 'status'));
  const paths = answer.selected.filter(hit => hit.path);
  if (paths.length) {
    const detail = element('details');
    detail.append(element('summary', 'Relate로 연결한 장면'));
    for (const hit of paths) detail.append(element('p', hit.path.join(' → ')));
    reply.append(detail);
  }
}

composer.addEventListener('submit', async event => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || send.disabled) return;
  const turn = element('li', '', 'turn');
  const reply = element('div', '', 'reply');
  turn.append(element('p', text, 'ask'), reply);
  thread.append(turn);
  question.value = '';
  send.disabled = couple.disabled = method.disabled = true;
  status.textContent = '관련 카톡을 읽고 답을 작성하는 중이에요.';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: text, previous, couple: couple.value, method: method.value }),
    });
    const answer = await response.json();
    if (!response.ok) throw Error(answer.error);
    showAnswer(reply, answer);
    previous = [...previous.slice(-2), text];
  } catch (error) {
    reply.append(element('p', error.message));
    if (!question.value) question.value = text;
  } finally {
    status.textContent = '';
    send.disabled = couple.disabled = method.disabled = false;
    question.focus();
  }
});

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/chat.js': ['chat.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const LIMIT_BYTES = 8000;

async function readChatInput(req) {
  if (req.headers['content-type'] !== 'application/json') throw Error('JSON 요청이 필요해요.');
  const size = Number(req.headers['content-length']);
  if (!Number.isInteger(size) || size < 2 || size > LIMIT_BYTES) throw Error('질문 길이를 줄여 주세요.');
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const input = JSON.parse(Buffer.concat(parts).toString('utf8'));
  const { question, previous, couple, method } = input ?? {};
  if (typeof question !== 'string' || !question.trim() || question.length > 600
      || !Array.isArray(previous) || previous.length > 3
      || previous.some(value => typeof value !== 'string' || value.length > 600)
      || !['morning', 'evening'].includes(couple)
      || !['semantic', 'automatic', 'curated'].includes(method)) {
    throw Error('질문과 검색 방식을 확인해 주세요.');
  }
  return { question: question.trim(), previous, couple, method };
}

export async function serveChat(chat, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('챗봇 포트를 확인해 주세요.');
  const origin = `http://127.0.0.1:${port}`;
  const files = Object.fromEntries(await Promise.all(Object.entries(assets).map(async ([route, [file, contentType]]) => [
    route, { contentType, body: await readFile(new URL(`../web/${file}`, import.meta.url)) },
  ])));

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== `127.0.0.1:${port}`) return json(403, { error: '로컬 주소로 열어 주세요.' });

    if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
      const { contentType, body } = files[req.url];
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(body);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/chat') return json(404, { error: '페이지를 찾을 수 없어요.' });
    if (req.headers.origin !== origin) return json(403, { error: '챗봇 화면에서 요청해 주세요.' });

    let input;
    try {
      input = await readChatInput(req);
    } catch {
      return json(400, { error: '질문, 이전 대화 또는 검색 방식을 확인해 주세요.' });
    }
    try {
      return json(200, await chat(input));
    } catch {
      return json(503, { error: '로컬 모델의 답변을 받지 못했어요. llama-server를 확인한 뒤 다시 보내 주세요.' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`HowPair chat is ready at ${origin}`);
}

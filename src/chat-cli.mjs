import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scenes } from '../data/chats.mjs';
import { questions } from '../data/questions.mjs';
import { createChat } from './chat.mjs';
import { loadEmbeddings } from './embeddings.mjs';
import { openGraph } from './graph.mjs';
import { localModel } from './local-model.mjs';

const methods = ['semantic', 'automatic', 'curated'];
const store = fileURLToPath(new URL('../data/demo.rl', import.meta.url));
const [command, ...args] = process.argv.slice(2);
const { values } = parseArgs({
  args,
  options: { case: { type: 'string' }, port: { type: 'string', default: '18129' }, 'model-port': { type: 'string', default: '18128' } },
});

async function main() {
  const generate = localModel(Number(values['model-port']));
  const embeddings = await loadEmbeddings(scenes);
  const chat = createChat({ scenes, graph: openGraph(store), embeddings, generate });
  if (command === 'serve') {
    const { serveChat } = await import('./chat-http.mjs');
    await serveChat(chat, Number(values.port));
    return;
  }
  if (command !== 'benchmark') throw Error('Use npm run chat or npm run benchmark:answers.');
  const ids = values.case?.split(',');
  const selected = ids ? questions.filter(item => ids.includes(item.id)) : questions;
  if (!selected.length || ids?.some(id => !selected.some(item => item.id === id))) throw Error('Unrecognized benchmark case.');
  for (const input of selected) {
    for (const method of methods) {
      const started = performance.now();
      const result = await chat({ ...input, method });
      const cited = new Set(result.claims.flatMap(claim => claim.citations.map(citation => citation.id)));
      console.log(JSON.stringify({
        id: input.id,
        method,
        relevant: input.relevant,
        allRequiredSources: input.relevant.length ? input.relevant.every(id => cited.has(id)) : null,
        answeredWithoutEvidence: !input.relevant.length ? result.status !== 'absent' : null,
        elapsedMs: Math.round(performance.now() - started),
        ...result,
      }));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

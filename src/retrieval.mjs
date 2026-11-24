import { expandTrail } from './graph.mjs';

const LIMIT = 4;
const COMMON_WORDS = new Set([
  '우리', '카톡', '대화', '메시지', '그때', '언제', '있어', '어떻게', '뭐였어', '뭐야',
  'what', 'when', 'how', 'the', 'did', 'was', 'our', 'after', 'and', 'have', 'ever',
]);
const MULTI_SCENE = /이후|그 뒤|나중에|뒤에|하고 나서|되풀이|반복|달라졌|실제로|지켰|어떻게 됐|\b(?:after|later|follow[- ]?up|changed|follow through|kept|actually)\b/i;

export function sceneText(scene) {
  return scene.lines.map(([, message]) => message).join('\n');
}

function tokens(text) {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words
    .map(word => word.replace(/(?<=[가-힣]{2})(?:에서|에게|으로|까지|이랑|[을를이가은는의에와과도])$/u, ''))
    .filter(word => !COMMON_WORDS.has(word)))];
}

function sortHits(a, b) {
  return b.score - a.score || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
}

export function retrieve({ scenes, graph, vectors, vector, question, couple, from = '', through = '9999-12-31', timings = {} }) {
  const start = performance.now();
  const candidates = scenes.filter(scene => scene.couple === couple && scene.date >= from && scene.date <= through);
  const terms = tokens(question);
  const keyword = candidates.map(scene => {
    const document = sceneText(scene).normalize('NFKC').toLowerCase();
    return { id: scene.id, date: scene.date, score: terms.filter(term => document.includes(term)).length };
  }).filter(hit => hit.score > 0).sort(sortHits).slice(0, LIMIT);

  const semanticStart = performance.now();
  timings.keyword = semanticStart - start;
  const ranked = candidates.map(scene => {
    const passage = vectors.get(scene.id);
    if (passage?.length !== vector.length) throw new Error(`Missing or incompatible vector for ${scene.id}.`);
    const score = passage.reduce((sum, value, i) => sum + value * vector[i], 0);
    return { id: scene.id, date: scene.date, score };
  }).sort(sortHits);
  const semantic = ranked.slice(0, LIMIT);
  const graphStart = performance.now();
  timings.semantic = graphStart - semanticStart;
  timings.relate = timings.semantic;
  const seed = ranked[0];
  if (!seed || !MULTI_SCENE.test(question)) return { keyword, semantic, relate: semantic };

  const byId = new Map(ranked.map(hit => [hit.id, hit]));
  const chosen = new Map([[seed.id, seed]]);
  for (const link of expandTrail(graph, couple, seed.id, from, through)) {
    if (!byId.has(link.id) || chosen.has(link.id)) continue;
    chosen.set(link.id, { ...byId.get(link.id), path: link.path, reasons: link.reasons });
    if (chosen.size === LIMIT) break;
  }
  for (const hit of ranked) {
    if (chosen.size === LIMIT) break;
    if (!chosen.has(hit.id)) chosen.set(hit.id, hit);
  }
  timings.relate += performance.now() - graphStart;
  return { keyword, semantic, relate: [...chosen.values()] };
}

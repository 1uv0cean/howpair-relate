export const methods = ['keyword', 'semantic', 'relate'];

function scores(rows, method) {
  const samples = rows.map(({ hits, relevant, timings }) => {
    const returned = hits[method].map(hit => hit.id);
    const correct = returned.filter(id => relevant.includes(id)).length;
    return { expected: relevant.length, returned: returned.length, correct, ms: timings[method] };
  });
  const positives = samples.filter(sample => sample.expected > 0);
  const negatives = samples.filter(sample => sample.expected === 0);
  const times = samples.map(sample => sample.ms).sort((a, b) => a - b);
  return {
    questionsWithEvidence: positives.length,
    allEvidence: positives.filter(sample => sample.correct === sample.expected).length,
    meanRecall: positives.length ? positives.reduce((total, sample) => total + sample.correct / sample.expected, 0) / positives.length : null,
    irrelevantScenes: samples.reduce((total, sample) => total + sample.returned - sample.correct, 0),
    questionsWithoutEvidence: negatives.length,
    abstentions: negatives.filter(sample => sample.returned === 0).length,
    medianSearchMs: times.length ? times[Math.floor(times.length / 2)] : null,
  };
}

export async function benchmark(questions, search) {
  const rows = [];
  for (const example of questions) {
    rows.push({ ...example, ...await search(example) });
  }
  const report = (set) => Object.fromEntries(methods.map(method => [method, scores(set, method)]));
  return {
    overall: report(rows),
    connected: report(rows.filter(row => row.group === 'connected')),
    single: report(rows.filter(row => row.group === 'single')),
    stress: report(rows.filter(row => row.group === 'stress')),
    embeddingMs: (rows.reduce((sum, row) => sum + row.embeddingMs, 0) / rows.length),
    rows,
  };
}

import { env, pipeline } from '@huggingface/transformers';
import { fileURLToPath } from 'node:url';
import { sceneText } from './retrieval.mjs';

export async function loadEmbeddings(scenes) {
  env.cacheDir = fileURLToPath(new URL('../.local/models/', import.meta.url));
  const embed = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    dtype: 'q8',
  });
  const vectorize = async texts => (await embed(texts, { pooling: 'mean', normalize: true })).tolist();
  const vectors = new Map();
  for (let offset = 0; offset < scenes.length; offset += 8) {
    const batch = scenes.slice(offset, offset + 8);
    const projected = await vectorize(batch.map(scene => `passage: ${sceneText(scene)}`));
    batch.forEach((scene, i) => vectors.set(scene.id, projected[i]));
  }

  return { vectors, query: async text => (await vectorize([`query: ${text}`]))[0] };
}

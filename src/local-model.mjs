export function localModel(port = 18128) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('로컬 모델 포트를 확인해 주세요.');
  const endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  return async ({ name, schema, system, data, maxTokens }) => {
    let result;
    try {
      result = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(90000),
        redirect: 'error',
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(data) },
          ],
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        }),
      });
    } catch {
      throw Error('로컬 llama-server에 연결할 수 없어요. 포트와 실행 상태를 확인해 주세요.');
    }
    if (!result.ok) throw Error(`로컬 모델 응답 오류 (HTTP ${result.status}).`);
    const completion = await result.json();
    const answer = completion.choices?.[0];
    if (answer?.finish_reason !== 'stop') throw Error('로컬 모델이 답변을 끝까지 생성하지 못했어요.');
    try {
      return JSON.parse(answer.message.content);
    } catch {
      throw Error('로컬 모델에서 구조화된 답변을 읽을 수 없어요.');
    }
  };
}

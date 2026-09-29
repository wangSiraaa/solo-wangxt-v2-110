const BASE = '/api';
async function req(path, opts) {
  const res = await fetch(BASE + path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
export const api = {
  health: () => req('/health'),
  mappings: () => req('/mappings'),
  ambiguities: () => req('/ambiguities'),
  resolveAmbiguity: (id, resolution) =>
    req(`/ambiguities/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  verify: () => req('/verify', { method: 'POST' }),
  runs: () => req('/runs'),
  run: (id) => req(`/runs/${id}`),
  plan: () => req('/plan'),
  reviewPlan: (id, reviewed) =>
    req(`/plan/${id}/review`, { method: 'POST', body: JSON.stringify({ reviewed }) }),
  report: () => req('/report'),
};

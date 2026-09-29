// selftest.js — 规则与验证器的可重复自检（不依赖服务进程；验证器使用 mock fetch）
// 运行：node scripts/selftest.js
import assert from 'node:assert/strict';
import {
  normalizeUrl, detectAmbiguities, queryParamsPreserved,
} from '../server/lib/normalize.js';
import { createVerifier } from '../server/lib/verifier.js';

let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

const OLD = 'http://127.0.0.1:18080';

console.log('R1/R2 WHATWG 解析与 origin 规范化');
assert.equal(normalizeUrl('http://127.0.0.1:80/x', 'http://127.0.0.1/').canonicalKey,
  'http://127.0.0.1/x'); // 默认端口 80 被去除；非标准端口（如 18080）必须保留
assert.equal(normalizeUrl(`${OLD}/x`, OLD).canonicalKey, `${OLD}/x`);
assert.equal(normalizeUrl('/rel/a', OLD).canonicalKey, `${OLD}/rel/a`); // 相对链接
assert.equal(normalizeUrl('   ', OLD).ok, false);
assert.equal(normalizeUrl('http://[broken', OLD).ok, false); // 真正无法解析
assert.equal(normalizeUrl('https://127.0.0.1:18080/x', OLD).error, 'UNSUPPORTED_SCHEME');
ok('默认端口去除 / 相对链接解析 / 非法与非 http scheme 拒绝');

console.log('R3 路径大小写敏感');
const a = normalizeUrl(`${OLD}/News`, OLD).canonicalKey;
const b = normalizeUrl(`${OLD}/news`, OLD).canonicalKey;
assert.notEqual(a, b);
ok('/News 与 /news 是不同 canonicalKey');

console.log('R4 百分号编码：字节保真，不自由解码');
assert.equal(normalizeUrl(`${OLD}/%e6%a0%8f%e7%9b%ae`, OLD).path, '/%E6%A0%8F%E7%9B%AE'); // 十六进制大写
assert.equal(normalizeUrl(`${OLD}/栏目`, OLD).path, '/%E6%A0%8F%E7%9B%AE'); // 原始 UTF-8 规范编码
assert.equal(normalizeUrl(`${OLD}/x%2Fy`, OLD).path, '/x%2Fy'); // %2F 不变成分隔符
assert.notEqual(normalizeUrl(`${OLD}/x%2Fy`, OLD).canonicalKey, normalizeUrl(`${OLD}/x/y`, OLD).canonicalKey);
assert.equal(normalizeUrl(`${OLD}/x%2dy`, OLD).path, '/x%2Dy'); // %2d→%2D 仅十六进制大写，字节不变
ok('十六进制大写、中文规范编码、%2F/%2d 字节保真');

console.log('R5 尾斜杠是路径的一部分');
assert.notEqual(normalizeUrl(`${OLD}/a`, OLD).canonicalKey, normalizeUrl(`${OLD}/a/`, OLD).canonicalKey);
ok('/a 与 /a/ 不归一');

console.log('R6 查询/追踪参数保留，顺序保留，参与身份');
assert.equal(
  normalizeUrl(`${OLD}/s?id=8&utm_source=x&spm=a`, OLD).canonicalKey,
  `${OLD}/s?id=8&utm_source=x&spm=a`);
assert.equal(queryParamsPreserved(`${OLD}/s?id=8&utm_source=x`, `${NEW2()}/t?utm_source=x&id=8`), true);
assert.equal(queryParamsPreserved(`${OLD}/s?gclid=z&page=2`, `${NEW2()}/t?page=2`), false);
ok('追踪参数端到端保留检测（子集多重集合）');

console.log('R7 fragment 不参与资源身份');
assert.equal(
  normalizeUrl(`${OLD}/p?a=1#x`, OLD).canonicalKey,
  normalizeUrl(`${OLD}/p?a=1#y`, OLD).canonicalKey);
ok('仅 fragment 不同 => 同一 canonicalKey');

console.log('歧义检测');
const amb = detectAmbiguities([
  { ...normalizeUrl(`${OLD}/News/1`, OLD), raw: `${OLD}/News/1`, expectedTarget: `${OLD}/t1`, pathSegments: normalizeUrl(`${OLD}/News/1`, OLD).pathSegments },
  { ...normalizeUrl(`${OLD}/news/1`, OLD), raw: `${OLD}/news/1`, expectedTarget: `${OLD}/t1`, pathSegments: normalizeUrl(`${OLD}/news/1`, OLD).pathSegments },
  { ...normalizeUrl(`${OLD}/c?x=1`, OLD), raw: `${OLD}/c?x=1`, expectedTarget: `${OLD}/t`, pathSegments: normalizeUrl(`${OLD}/c?x=1`, OLD).pathSegments },
  { ...normalizeUrl(`${OLD}/c?x=2`, OLD), raw: `${OLD}/c?x=2`, expectedTarget: `${OLD}/t`, pathSegments: normalizeUrl(`${OLD}/c?x=2`, OLD).pathSegments },
]);
assert.ok(amb.some((i) => i.kind === 'CASE_VARIANT' && i.severity === 'BLOCKER'));
assert.ok(amb.some((i) => i.kind === 'QUERY_VARIANT'));
ok('CASE_VARIANT=BLOCKER，QUERY_VARIANT=WARNING');

// ---- 验证器（mock fetch：不会产生任何真实网络）----
console.log('验证器：环 / 过长链 / 越权拦截 / 最终状态');
const ALLOW = ['http://local-old', 'http://local-new'];
function mockFetch(routes) {
  return async (u) => {
    const r = routes[new URL(u).pathname];
    if (!r) throw new Error('unexpected fetch ' + u);
    return { status: r.status, headers: { get: (k) => (k.toLowerCase() === 'location' ? r.location : null) } };
  };
}

{
  const v = createVerifier({ fetchImpl: mockFetch({
    '/a': { status: 302, location: 'http://local-old/b' },
    '/b': { status: 302, location: 'http://local-old/a' },
  }), allowedOrigins: ALLOW, maxHops: 5 });
  const r = await v.resolve('http://local-old/a');
  assert.ok(r.codes.has('REDIRECT_LOOP'));
  ok('重定向环识别');
}
{
  let calls = 0;
  const routes = {};
  for (let i = 0; i <= 5; i++) routes[`/c${i}`] = { status: 302, location: `http://local-old/c${i + 1}` };
  const v = createVerifier({
    fetchImpl: async (u) => { calls++; return mockFetch(routes)(u); },
    allowedOrigins: ALLOW, maxHops: 5,
  });
  const r = await v.resolve('http://local-old/c0');
  assert.ok(r.codes.has('CHAIN_TOO_LONG'));
  assert.ok(calls <= 6, '超过上限后不再请求');
  ok('过长链识别且超限后停止');
}
{
  let externalCalled = false;
  const v = createVerifier({
    fetchImpl: async (u) => {
      if (new URL(u).hostname === 'example.com') { externalCalled = true; throw new Error('SHOULD NOT FETCH'); }
      return { status: 302, headers: { get: (k) => k === 'location' ? 'http://example.com/x' : null } };
    }, allowedOrigins: ALLOW, maxHops: 5,
  });
  const r = await v.resolve('http://local-old/escape');
  assert.ok(r.blocked);
  assert.ok(r.codes.has('BLOCKED_ORIGIN'));
  assert.equal(externalCalled, false);
  assert.equal(r.chain[r.chain.length - 1].status, null);
  ok('跨站点跳转被拦截，绝不向项目外发起请求');
}
{
  const v = createVerifier({
    fetchImpl: mockFetch({ '/ok': { status: 201, location: null } }),
    allowedOrigins: ALLOW, maxHops: 5,
  });
  const r = await v.resolve('http://local-old/ok');
  assert.equal(r.finalStatus, 201);
  assert.equal(r.codes.size, 0);
  ok('终止状态如实记录（最终页面状态由编排层按裁决核实）');
}

function NEW2() { return 'http://127.0.0.1:18081'; }
console.log(`\n全部 ${n} 组断言通过。`);

// sites.js — 随项目一起启动的本地“旧内容平台 / 新内容平台”
// 仅监听 127.0.0.1。用 node:http 手工分发，刻意保持路径大小写敏感、
// 不做任何隐式解码，以真实复现改版前后的边界行为。
// SITE_MODE=broken（默认）：内置全部缺陷供验证器抓出；
// SITE_MODE=fixed：按评审结论修复后的旧站/新站，用于复跑验证闸门转绿。
import http from 'node:http';

export const OLD_PORT = Number(process.env.OLD_PORT || 18080);
export const NEW_PORT = Number(process.env.NEW_PORT || 18081);
export const OLD_ORIGIN = `http://127.0.0.1:${OLD_PORT}`;
export const NEW_ORIGIN = `http://127.0.0.1:${NEW_PORT}`;
export const SITE_MODE = process.env.SITE_MODE === 'fixed' ? 'fixed' : 'broken';

function send(res, status, headers, body = '') {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function page(title, body) {
  return `<!doctype html><meta charset=utf-8><title>${title}</title><h1>${title}</h1><p>${body}</p>`;
}

// ---- 旧站：按路径精确（大小写敏感、字节保真）匹配的行为表 ----
function oldHandler(req, res) {
  const u = new URL(req.url, OLD_ORIGIN); // WHATWG 解析；原始中文被规范编码
  const p = u.pathname;
  const q = u.search; // 含前导 ?
  const fixed = SITE_MODE === 'fixed';

  // 正常迁移：保留全部查询（含追踪参数）
  if (p === '/News/Tech/123')
    return send(res, 301, { location: `${NEW_ORIGIN}/tech/123${q}` });

  // broken：301 时丢掉查询串（追踪参数丢失）；fixed：保留
  if (p === '/News/Tech/456')
    return send(res, 301, { location: `${NEW_ORIGIN}/tech/456${fixed ? q : ''}` });

  // fragment 不影响资源身份（冲突裁决后统一 301）
  if (p === '/News/Tech/999')
    return send(res, 301, { location: `${NEW_ORIGIN}/tech/999${q}` });

  // broken：目标在新站并不存在 -> 最终状态核实失败；fixed：按评审并入 archive
  if (p === '/News/Life/77')
    return send(res, 301, {
      location: `${NEW_ORIGIN}/${fixed ? 'archive/life/77' : 'life/77'}${q}`,
    });

  // 编码中文路径：/栏目/weekly
  if (p === '/%E6%A0%8F%E7%9B%AE/weekly')
    return send(res, 301, { location: `${NEW_ORIGIN}/column/weekly${q}` });

  // 尾斜杠：带斜杠是真实资源
  if (p === '/Sports/Basketball/')
    return send(res, 301, { location: `${NEW_ORIGIN}/sport/basketball/${q}` });

  // 大小写：评审结论是小写形态确属误写需要兜底；fixed 补 301，broken 维持 404
  if (p === '/news/tech/123')
    return fixed
      ? send(res, 301, { location: `${NEW_ORIGIN}/tech/123${q}` })
      : send(res, 404, {}, page('404 Not Found', `旧站无此资源：${p}${q}`));

  // 已删除栏目：明确 410 Gone
  if (p === '/Dead/column/9')
    return send(res, 410, {}, page('410 Gone', '该栏目已随改版永久下线（/Dead/*）。'));

  // 重定向环 a -> b -> a；fixed：环拆除
  if (p === '/loop/a')
    return fixed
      ? send(res, 301, { location: `${NEW_ORIGIN}/loops/end${q}` })
      : send(res, 302, { location: `${OLD_ORIGIN}/loop/b` });
  if (p === '/loop/b')
    return send(res, 302, { location: `${OLD_ORIGIN}/loop/a` });

  // 过长链；fixed：种子入口 /chain/0 只保留单次 301
  if (p === '/chain/0')
    return fixed
      ? send(res, 301, { location: `${NEW_ORIGIN}/chains/end` })
      : send(res, 302, { location: `${OLD_ORIGIN}/chain/1` });
  if (!fixed) {
    const m = p.match(/^\/chain\/(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n <= 5) return send(res, 302, { location: `${OLD_ORIGIN}/chain/${n + 1}` });
      return send(res, 200, {}, page('Chain End', `最终节点 /chain/${n}`));
    }
  }

  // broken：重定向到项目外站点（验证器必须拦截，不得请求）；fixed：落地页迁入新站
  if (p === '/promo/partner')
    return fixed
      ? send(res, 301, { location: `${NEW_ORIGIN}/partners/landing${q}` })
      : send(res, 302, { location: 'http://example.com/landing' });

  // 编码即资源：%2F 不是路径分隔符
  if (p === '/a%2Fb')
    return send(res, 301, { location: `${NEW_ORIGIN}/new/encoded/a-b${q}` });
  if (p === '/a/b')
    return send(res, 301, { location: `${NEW_ORIGIN}/new/a/b${q}` });

  // 无“大小写不敏感”兜底：/Sports/Basketball（无尾斜杠）始终 404（该映射将被评审删除）
  send(res, 404, {}, page('404 Not Found', `旧站无此资源：${p}${q}`));
}

// ---- 新站：最终页面 ----
function newHandler(req, res) {
  const u = new URL(req.url, NEW_ORIGIN);
  const p = u.pathname;
  const exists = new Set([
    '/tech/123',
    '/tech/456',
    '/tech/999',
    '/column/weekly',
    '/sport/basketball/',
    '/new/encoded/a-b',
    '/new/a/b',
    // fixed 模式新增的最终页面
    '/archive/life/77',
    '/loops/end',
    '/chains/end',
    '/partners/landing',
  ]);
  if (exists.has(p)) {
    return send(res, 200, {}, page('新站页面', `最终落点：${p}${u.search || '（无查询）'}`));
  }
  send(res, 404, {}, page('404 Not Found', `新站尚未建页：${p}`));
}

export function startLocalSites() {
  const oldSite = http.createServer((req, res) => oldHandler(req, res));
  const newSite = http.createServer((req, res) => newHandler(req, res));
  return Promise.all([
    new Promise((resolve) => oldSite.listen(OLD_PORT, '127.0.0.1', resolve)),
    new Promise((resolve) => newSite.listen(NEW_PORT, '127.0.0.1', resolve)),
  ]).then(() => ({ oldSite, newSite }));
}

// normalize.js — 基于 WHATWG URL（全局 URL / URL.canParse）的地址规范化
//
// 显式规则（评审可追溯，禁止“随意 decodeURI 后合并”）：
//  R1 解析器：只用 WHATWG URL（Node 全局 URL，等价于浏览器 URL）。相对链接以
//      站点登记的 base origin 解析；非法 URL 直接拒绝（canParse=false）。
//  R2 scheme/host：scheme 与 host 按 WHATWG 小写化；去掉默认端口；路径点段
//      （. / ..）由 WHATWG 解析期消除。仅允许 http:（随项目启动的本地站点）。
//  R3 路径大小写：路径是大小写敏感的，不做小写化。/News 与 /news 是不同资源；
//      出现仅大小写不同的形态 => 记 CASE_VARIANT 歧义，交人判，不自动合并。
//  R4 百分号编码：不做 decodeURIComponent 式的自由解码。以 WHATWG 序列化结果为准
//      （原始 UTF-8 中文会被规范编码为 %XX，十六进制统一为大写）；已编码字节原样
//      保留（%2F 不是分隔符、%2d 不等于 '-'）。仅在“候选彼此解码后字节相同”时
//      记 ENCODING_VARIANT 提示，由人确认是否同一资源，绝不静默合并。
//  R5 尾斜杠：是路径的一部分。/a 与 /a/ 身份不同，保留并记 TRAILING_SLASH 提示。
//  R6 查询参数：属于资源身份，参与归一化键；顺序与大小写保留。追踪参数
//      (utm_*/spm/gclid 等) 必须端到端保留，绝不剥离；仅查询不同的链接登记为
//      QUERY_VARIANT 供评审，不折叠。
//  R7 fragment：不属于服务端资源身份，规范化时剥离（仅作用于浏览器内定位）。
//  R8 输出：canonical_key = origin + pathname + search（WHATWG href 去掉 hash）。

const TRACKING_PARAM_RE = /^(utm_[a-z0-9_]+|spm|gclid|fbclid|yclid|msclkid|mc_eid|_hsenc|_hsmi)$/i;

// 把百分号编码的十六进制位统一为大写（不触碰字节本身，不做解码）
function upperHexTriplets(s) {
  return s.replace(/%[0-9a-fA-F]{2}/g, (t) => '%' + t.slice(1).toUpperCase());
}

/**
 * 规范化一个原始 URL
 * @param raw 原始链接（绝对或相对）
 * @param base 原始链接为相对路径时使用的站点 base（必须是可解析的 http origin）
 */
export function normalizeUrl(raw, base) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'EMPTY_URL' };
  }
  const trimmed = raw.trim();
  let url;
  try {
    if (URL.canParse(trimmed, base)) {
      url = new URL(trimmed, base);
    } else {
      return { ok: false, error: 'UNPARSEABLE_URL', raw };
    }
  } catch (e) {
    return { ok: false, error: 'UNPARSEABLE_URL', raw, detail: e.message };
  }

  if (url.protocol !== 'http:') {
    return { ok: false, error: 'UNSUPPORTED_SCHEME', raw, scheme: url.protocol.replace(':', '') };
  }

  // R2/R3/R4: host 已由 WHATWG 小写；pathname 原样；仅统一十六进制大小写
  const path = upperHexTriplets(url.pathname);
  // R6: 查询串原样保留（含顺序与大小写）；空串表示无查询
  const query = url.search ? upperHexTriplets(url.search) : '';
  const origin = url.origin; // WHATWG origin：小写 host、去默认端口

  return {
    ok: true,
    raw,
    origin,
    path,
    query,
    // R7: 不含 hash
    canonicalKey: origin + path + query,
    hrefNoHash: origin + path + query,
    href: url.href,
    pathSegments: path.split('/').map((seg) => ({
      raw: seg,
      decodedSafely: safeDecodeSegmentForComparison(seg),
    })),
  };
}

// 仅用于“歧义提示”的保守解码：逐 triplet 解到字节，再按 UTF-8 还原；
// 非法 UTF-8 返回 null（表示不能安全比较）。绝不用于生成合并键。
export function safeDecodeSegmentForComparison(seg) {
  const bytes = [];
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] === '%') {
      const hx = seg.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hx)) return null;
      bytes.push(parseInt(hx, 16));
      i += 2;
    } else {
      const ch = seg.charCodeAt(i);
      if (ch > 0x7f) return null; // 未编码的非 ASCII：交回 WHATWG 结果比较
      bytes.push(ch);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

/** 追踪参数是否在查询串中保留（顺序无关地比对参数多重集合） */
export function trackingParamsOf(searchOrUrl) {
  try {
    const u = searchOrUrl.startsWith('http')
      ? new URL(searchOrUrl)
      : new URL(searchOrUrl.startsWith('?') ? searchOrUrl.slice(1) : searchOrUrl, 'http://x/');
    const out = [];
    for (const [k, v] of u.searchParams) {
      if (TRACKING_PARAM_RE.test(k)) out.push(`${k}=${v}`);
    }
    return out;
  } catch {
    return [];
  }
}

/** 查询参数多重集合是否为子集保留（旧侧所有参数都必须出现在新侧，值一致） */
export function queryParamsPreserved(oldUrl, newUrl) {
  const a = new URL(oldUrl).searchParams;
  const b = new URL(newUrl).searchParams;
  const count = (p) => {
    const m = new Map();
    for (const [k, v] of p) m.set(k + '' + v, (m.get(k + '' + v) || 0) + 1);
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  for (const [kv, n] of ma) {
    if ((mb.get(kv) || 0) < n) return false;
  }
  return true;
}

/**
 * 在一组已规范化候选项中检测归一化歧义
 * @returns 歧义记录数组（kind/severity/canonicalKey/...）
 */
export function detectAmbiguities(normalized) {
  const issues = [];

  // 1) 同一 canonicalKey 下目标冲突（不同旧链接归一后指向不同新址）
  const byKey = new Map();
  for (const n of normalized) {
    if (!n.ok) continue;
    if (!byKey.has(n.canonicalKey)) byKey.set(n.canonicalKey, []);
    byKey.get(n.canonicalKey).push(n);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const targets = new Set(group.map((g) => g.expectedTarget ?? null));
    const rawSet = [...new Set(group.map((g) => g.raw))];
    if (targets.size > 1) {
      const targetText = [...targets].map((t) => t || '(无目标/410)').join(' , ');
      issues.push({
        kind: 'CONFLICT',
        severity: 'BLOCKER',
        canonicalKey: key,
        candidateUrls: rawSet,
        candidateTargets: [...targets].filter(Boolean),
        detail: `${rawSet.length} 个旧链接归一为同一资源键，但裁决目标不一致（${targetText}），拒绝自动合并。`,
      });
    }
  }

  // 2) 路径大小写形态差异：origin + toLowerCase(path) 相同
  const byLowerPath = new Map();
  for (const n of normalized) {
    if (!n.ok) continue;
    const k = n.origin + n.path.toLowerCase() + n.query;
    if (!byLowerPath.has(k)) byLowerPath.set(k, []);
    byLowerPath.get(k).push(n);
  }
  for (const [, group] of byLowerPath) {
    const keys = new Set(group.map((g) => g.canonicalKey));
    if (keys.size > 1) {
      const canonicalKey = group[0].origin + group[0].path + group[0].query;
      issues.push({
        kind: 'CASE_VARIANT',
        severity: 'BLOCKER',
        canonicalKey,
        candidateUrls: [...new Set(group.map((g) => g.raw))],
        candidateTargets: [...new Set(group.map((g) => g.expectedTarget).filter(Boolean))],
        detail: '路径仅大小写不同即被视为不同资源（R3）；是否为同一页面需人工确认，确认前不发布。',
      });
    }
  }

  // 3) 编码形态差异：逐字节安全解码后路径相同，但 canonicalKey 不同（不自动合并）
  const byDecoded = new Map();
  for (const n of normalized) {
    if (!n.ok) continue;
    const dec = n.pathSegments.map((s) => s.decodedSafely).join('/');
    if (dec === null || dec.includes(null)) continue;
    const k = n.origin + '|' + dec + '|' + n.query;
    if (!byDecoded.has(k)) byDecoded.set(k, []);
    byDecoded.get(k).push(n);
  }
  for (const [, group] of byDecoded) {
    const keys = new Set(group.map((g) => g.canonicalKey));
    if (keys.size > 1) {
      issues.push({
        kind: 'ENCODING_VARIANT',
        severity: 'WARNING',
        canonicalKey: group[0].canonicalKey,
        candidateUrls: [...new Set(group.map((g) => g.raw))],
        candidateTargets: [...new Set(group.map((g) => g.expectedTarget).filter(Boolean))],
        detail: '候选仅百分号编码形态不同（R4）。系统不会自由解码合并；请人工确认字节是否指向同一资源后再决定是否折叠。',
      });
    }
  }

  // 4) 尾斜杠形态（路径去尾 / 后相同、但身份不同）
  const byNoTrail = new Map();
  for (const n of normalized) {
    if (!n.ok || n.path === '/' || !n.path.endsWith('/')) continue;
    const k = n.origin + n.path.replace(/\/+$/, '') + n.query;
    if (!byNoTrail.has(k)) byNoTrail.set(k, []);
    byNoTrail.get(k).push(n);
  }
  const plain = new Map(normalized.filter((n) => okAnd(n, (x) => !x.path.endsWith('/'))).map((n) => [n.origin + n.path + n.query, n]));
  for (const [k, group] of byNoTrail) {
    if (plain.has(k)) {
      issues.push({
        kind: 'TRAILING_SLASH',
        severity: 'WARNING',
        canonicalKey: group[0].canonicalKey,
        candidateUrls: [...new Set([...group.map((g) => g.raw), plain.get(k).raw])],
        candidateTargets: [...new Set([...group, plain.get(k)].map((g) => g.expectedTarget).filter(Boolean))],
        detail: '仅尾斜杠不同（R5）：尾斜杠是路径的一部分，默认视为两个资源，请人工确认。',
      });
    }
  }

  // 5) 仅查询不同（含追踪参数差异）——不折叠，登记评审
  const byPathOnly = new Map();
  for (const n of normalized) {
    if (!n.ok) continue;
    const k = n.origin + n.path;
    if (!byPathOnly.has(k)) byPathOnly.set(k, []);
    byPathOnly.get(k).push(n);
  }
  for (const [, group] of byPathOnly) {
    const queries = new Set(group.map((g) => g.query));
    if (queries.size > 1) {
      issues.push({
        kind: 'QUERY_VARIANT',
        severity: 'WARNING',
        canonicalKey: group[0].canonicalKey,
        candidateUrls: [...new Set(group.map((g) => g.raw))],
        candidateTargets: [...new Set(group.map((g) => g.expectedTarget).filter(Boolean))],
        detail: '路径相同但查询参数（含追踪参数）不同（R6）。追踪参数端到端保留，各链接独立验证，不按查询折叠。',
      });
    }
  }

  return dedupeIssues(issues);
}

function okAnd(n, f) {
  return n.ok && f(n);
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((i) => {
    const k = i.kind + '|' + i.canonicalKey + '|' + [...i.candidateUrls].sort().join('>');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

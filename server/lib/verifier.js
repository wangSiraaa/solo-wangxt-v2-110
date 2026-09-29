// verifier.js — 对随项目启动的本地站点做受控验证
// 安全边界：只允许访问“登记在案、随项目启动”的本地 origin（ALLOWED_ORIGINS）。
// 任何映射/重定向把请求引到其它 host/port/scheme，一律标记 blocked_by_policy，
// 绝不发起请求（满足“验证请求只访问随项目启动的本地站点”）。

const MAX_HOPS_DEFAULT = 5; // 超过即“过长链” FAIL(CHAIN_TOO_LONG)

/**
 * @param fetchImpl  注入的 fetch（实际运行传 globalThis.fetch；可测试）
 * @param allowedOrigins Set<string>，允许访问的 origin，如 http://127.0.0.1:18080
 */
export function createVerifier({ fetchImpl, allowedOrigins, maxHops = MAX_HOPS_DEFAULT }) {
  const allow = new Set(allowedOrigins);

  function originOf(u) {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  }

  function assertAllowed(rawUrl, ctx = {}) {
    const o = originOf(rawUrl);
    if (!o || !allow.has(o)) {
      const err = new Error('BLOCKED_ORIGIN');
      err.code = 'BLOCKED_ORIGIN';
      ctx.origin = o;
      err.context = ctx;
      throw err;
    }
  }

  /**
   * 手工跟随重定向（不使用 redirect:'follow'），以便：
   *  - 每一跳都校验目的 origin 是否仍在允许名单
   *  - 精确记录链，检测环与过长链
   */
  async function resolve(startUrl) {
    const chain = [];
    const seen = new Map(); // url(无hash)->hop 序号，检测环
    let current = startUrl;
    const codes = new Set();
    let blocked = false;
    let detail = null;

    try {
      assertAllowed(current, { hop: 0, phase: 'start' });
    } catch (e) {
      return buildFailure({ startUrl, chain, codes, blocked: true, detail: '起点不在允许访问的本地站点名单：' + (e.context?.origin || current) });
    }

    // hop 0..maxHops；最终响应必须是终止状态（非 3xx）
    for (let hop = 0; hop <= maxHops; hop++) {
      const key = current.split('#')[0];
      if (seen.has(key)) {
        codes.add('REDIRECT_LOOP');
        detail = `检测到重定向环：第 ${seen.get(key)} 跳与第 ${hop} 跳为同一地址 ${key}`;
        return buildFailure({ startUrl, chain, codes, detail });
      }
      seen.set(key, hop);

      let res;
      try {
        res = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': 'migration-workbench/1.0 (local-only verifier)' },
        });
      } catch (err) {
        codes.add('NETWORK_ERROR');
        detail = `第 ${hop} 跳请求失败：${err.message}`;
        return buildFailure({ startUrl, chain, codes, detail });
      }

      const status = res.status;
      const loc = res.headers.get('location');
      chain.push({ hop, url: current, status, location: loc || null });

      if (status >= 300 && status < 400 && loc) {
        let next;
        try {
          next = new URL(loc, current).href;
        } catch {
          codes.add('BAD_REDIRECT_LOCATION');
          detail = `第 ${hop} 跳 Location 无法解析：${loc}`;
          return buildFailure({ startUrl, chain, codes, detail });
        }
        try {
          assertAllowed(next, { hop: hop + 1, phase: 'redirect' });
        } catch (e) {
          codes.add('BLOCKED_ORIGIN');
          detail = `第 ${hop + 1} 跳试图离开本地站点（${e.context?.origin || next}），已按策略拦截，未发起请求`;
          chain.push({ hop: hop + 1, url: next, status: null, location: null, blocked: true });
          return buildFailure({ startUrl, chain, codes, blocked: true, detail, noExtraHop: true });
        }
        if (hop === maxHops) {
          codes.add('CHAIN_TOO_LONG');
          detail = `重定向链超过 ${maxHops} 跳仍未到达终止页面`;
          return buildFailure({ startUrl, chain, codes, detail });
        }
        current = next;
        continue;
      }

      // 终止响应
      return {
        finalUrl: current,
        finalStatus: status,
        chain,
        hopCount: chain.length - 1,
        blocked: false,
        codes,
        detail: null,
      };
    }
    codes.add('CHAIN_TOO_LONG');
    return buildFailure({ startUrl, chain, codes, detail: detail || `重定向链超过 ${maxHops} 跳` });
  }

  return { resolve, allowedOrigins: allow };
}

function buildFailure({ startUrl, chain, codes, blocked, detail, noExtraHop = false }) {
  return {
    finalUrl: chain.length ? chain[chain.length - 1].url : startUrl,
    finalStatus: chain.length ? chain[chain.length - 1].status : null,
    chain,
    hopCount: Math.max(0, chain.length - 1 - (noExtraHop ? 1 : 0)),
    blocked: !!blocked,
    codes,
    detail,
  };
}

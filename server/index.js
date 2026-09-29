// index.js — Fastify API + 随项目启动的本地旧站/新站
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { q, pool } from './lib/db.js';
import { normalizeUrl, queryParamsPreserved } from './lib/normalize.js';
import { createVerifier } from './lib/verifier.js';
import { startLocalSites, OLD_ORIGIN, NEW_ORIGIN, SITE_MODE } from './lib/sites.js';

const API_PORT = Number(process.env.API_PORT || 18000);
// 唯一允许验证器访问的目标：随本进程启动的旧站/新站
const ALLOWED_ORIGINS = [OLD_ORIGIN, NEW_ORIGIN];

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { transport: undefined } });

// ---------- 验证一次运行 ----------
async function runVerification() {
  const { rows: mappings } = await q('SELECT * FROM url_mappings ORDER BY id');
  const { rows: unresolvedAmb } = await q(
    `SELECT * FROM ambiguities WHERE resolved = false`,
  );

  const run = await q(
    `INSERT INTO verification_runs (total_count) VALUES ($1) RETURNING *`,
    [mappings.length],
  );
  const runId = run.rows[0].id;

  const verifier = createVerifier({
    fetchImpl: globalThis.fetch,
    allowedOrigins: ALLOWED_ORIGINS,
    maxHops: 5,
  });

  let passed = 0, failed = 0, blocked = 0, ambiguousCount = 0;

  for (const m of mappings) {
    const codes = [];
    let detail = null;
    // BLOCKER 歧义阻塞其涉及的所有候选行：在人工裁决前，这些条目都不得发布
    const blockerAmb = unresolvedAmb.filter(
      (a) => a.severity === 'BLOCKER' && a.candidate_urls.includes(m.raw_old_url),
    );
    if (blockerAmb.length) {
      codes.push(...blockerAmb.map((a) => `AMBIGUITY_${a.kind}`));
      ambiguousCount += blockerAmb.length;
    }

    const r = await verifier.resolve(m.raw_old_url);
    for (const c of r.codes) codes.push(c);
    if (r.blocked) blocked++;

    let queryPreserved = null;
    const chainDefect = codes.includes('REDIRECT_LOOP') || codes.includes('CHAIN_TOO_LONG');

    if (m.decision === 'REDIRECT_301') {
      // 越权已拦截：链尾不可达，无法核实目标/参数，只保留 BLOCKED_ORIGIN 证据
      if (!r.blocked) {
        queryPreserved = queryParamsPreserved(m.raw_old_url, r.finalUrl || m.raw_old_url);
        if (queryPreserved === false) codes.push('QUERY_LOST');

        const nf = normalizeUrl(r.finalUrl || '', OLD_ORIGIN);
        const nt = normalizeUrl(m.target_new_url, OLD_ORIGIN);

        // 首跳状态（旧站该资源是否还在、是不是 301；环/过长链场景以专门问题码为准）
        const first = r.chain[0];
        if (first && first.status !== 301 && first.status !== 308 && !chainDefect) {
          codes.push(first.status === 404 ? 'OLD_URL_404' : 'OLD_STATUS_UNEXPECTED');
        }
        if (r.finalStatus !== 200 && !chainDefect) codes.push('FINAL_STATUS_NOT_OK');
        if (nf.ok && nt.ok && nf.canonicalKey !== nt.canonicalKey && !chainDefect) {
          codes.push('TARGET_MISMATCH');
        }
      }
    } else if (m.decision === 'GONE_410' && !r.blocked) {
      if (r.finalStatus !== 410) codes.push('EXPECTED_410');
      if (r.chain.length > 1) codes.push('GONE_MUST_NOT_REDIRECT');
    }

    const dedupCodes = [...new Set(codes)];
    const outcome = dedupCodes.length === 0 ? 'PASS' : 'FAIL';
    if (outcome === 'PASS') passed++; else failed++;

    detail = r.detail || (dedupCodes.length
      ? `未通过项：${dedupCodes.join(', ')}`
      : null);

    await q(
      `INSERT INTO crawl_results
        (mapping_id, run_id, final_url, final_status, chain, hop_count,
         outcome, issue_codes, issue_detail, query_preserved, case_mismatch, blocked_by_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [m.id, runId, r.finalUrl, r.finalStatus, JSON.stringify(r.chain), r.hopCount,
       outcome, dedupCodes, detail, queryPreserved,
       blockerAmb.some((a) => a.kind === 'CASE_VARIANT'), r.blocked],
    );

    // 回填迁移方案：证据驱动的发布闸门状态（填完表绝不算完成）
    const planAction = m.decision === 'GONE_410' ? 'GONE_410' : 'REDIRECT_301';
    const reasons = dedupCodes;
    let readiness = 'PENDING';
    if (m.decision === 'GONE_410' && outcome === 'PASS') readiness = 'CONFIRMED_GONE';
    else if (outcome === 'PASS' && !blockerAmb.length) readiness = 'READY';
    else readiness = 'BLOCKED';

    await q(
      `UPDATE migration_plan
         SET proposed_action=$1, proposed_target=$2, readiness=$3,
             block_reasons=$4, evidence_run_id=$5, updated_at=now()
       WHERE mapping_id=$6`,
      [planAction, m.target_new_url, readiness, reasons, runId, m.id],
    );
  }

  const ok = failed === 0 && blocked === 0;
  await q(
    `UPDATE verification_runs
       SET finished_at=now(), passed_count=$1, failed_count=$2,
           blocked_count=$3, ambiguous_count=$4,
           summary=$5
     WHERE id=$6`,
    [passed, failed, blocked, ambiguousCount,
      ok ? '全部通过' : `${failed} 条未通过（其中 ${blocked} 次越权被拦截）`, runId],
  );

  return runId;
}

// ---------- 路由 ----------
app.get('/api/health', async () => ({
  ok: true,
  siteMode: SITE_MODE,
  allowedOrigins: ALLOWED_ORIGINS,
  sites: { old: OLD_ORIGIN, new: NEW_ORIGIN },
  rules: [
    'R2 host 小写/默认端口去除；R3 路径大小写敏感',
    'R4 不自由解码，WHATWG 字节保真；R5 尾斜杠是路径一部分',
    'R6 查询与追踪参数端到端保留；R7 fragment 不参与资源身份',
    '重定向环立即失败；链长 >5 跳失败；仅允许访问随项目启动的本地站点',
  ],
}));

app.get('/api/mappings', async () => {
  const { rows } = await q(`
    SELECT m.*, cr.final_status, cr.outcome, cr.issue_codes, cr.query_preserved,
           cr.blocked_by_policy, cr.run_id, cr.chain
      FROM url_mappings m
      LEFT JOIN LATERAL (
        SELECT * FROM crawl_results c
         WHERE c.mapping_id = m.id ORDER BY c.run_id DESC LIMIT 1
      ) cr ON true
     ORDER BY m.id`);
  return { rows };
});

app.get('/api/ambiguities', async () => {
  const { rows } = await q('SELECT * FROM ambiguities ORDER BY resolved, severity DESC, id');
  return { rows };
});

app.post('/api/ambiguities/:id/resolve', async (req) => {
  const { id } = req.params;
  const { resolution } = req.body || {};
  await q('UPDATE ambiguities SET resolved=true, resolution=$2, updated_at=now() WHERE id=$1',
    [id, resolution || '人工确认']);
  return { ok: true };
});

app.post('/api/verify', async () => {
  const id = await runVerification();
  return { runId: id };
});

app.get('/api/runs', async () => {
  const { rows } = await q(
    `SELECT id, started_at, finished_at, total_count, passed_count, failed_count,
            blocked_count, ambiguous_count, summary
       FROM verification_runs ORDER BY id DESC LIMIT 20`);
  return { rows };
});

app.get('/api/runs/:id', async (req) => {
  const runId = Number(req.params.id);
  const { rows: runRows } = await q('SELECT * FROM verification_runs WHERE id=$1', [runId]);
  const { rows: results } = await q(
    `SELECT c.*, m.raw_old_url, m.target_new_url, m.decision
       FROM crawl_results c JOIN url_mappings m ON m.id = c.mapping_id
      WHERE run_id=$1 ORDER BY m.id`, [runId]);
  return { run: runRows[0] || null, results };
});

app.get('/api/plan', async () => {
  const { rows } = await q(`
    SELECT p.*, m.raw_old_url, m.section_old, m.section_new, m.note,
           r.started_at AS evidence_at
      FROM migration_plan p
      JOIN url_mappings m ON m.id = p.mapping_id
      LEFT JOIN verification_runs r ON r.id = p.evidence_run_id
     ORDER BY p.readiness, m.id`);
  return { rows };
});

app.post('/api/plan/:id/review', async (req) => {
  const { reviewed } = req.body || {};
  await q('UPDATE migration_plan SET reviewed=$2, updated_at=now() WHERE id=$1',
    [Number(req.params.id), !!reviewed]);
  return { ok: true };
});

// 发布闸门报告：受影响链接 + 每条的验证证据
app.get('/api/report', async () => {
  const { rows: latest } = await q(`
    SELECT m.id, m.raw_old_url, m.raw_variants, m.target_new_url, m.decision,
           m.section_old, m.section_new, m.note,
           c.final_url, c.final_status, c.outcome, c.issue_codes, c.issue_detail,
           c.query_preserved, c.blocked_by_policy, c.hop_count, c.chain, c.checked_at,
           p.readiness, p.reviewed
      FROM url_mappings m
      LEFT JOIN LATERAL (
        SELECT * FROM crawl_results c WHERE c.mapping_id = m.id
        ORDER BY c.run_id DESC LIMIT 1
      ) c ON true
      JOIN migration_plan p ON p.mapping_id = m.id
     ORDER BY m.id`);
  const { rows: ambRows } = await q(
    `SELECT * FROM ambiguities WHERE resolved=false ORDER BY severity DESC, id`);

  const verifiedCount = latest.filter((r) => r.outcome).length;
  const failRows = latest.filter((r) => r.outcome === 'FAIL');
  const passRows = latest.filter((r) => r.outcome === 'PASS');
  const blockerAmb = ambRows.filter((a) => a.severity === 'BLOCKER');

  // 最终页面状态核实：301 裁决的链尾必须 200；410 裁决的链尾必须是 410 且无跳转
  const finalPageStatusVerified = latest.length > 0 && latest.every((r) => {
    if (!r.outcome) return false;
    if (r.decision === 'GONE_410') return r.final_status === 410;
    return r.final_status === 200;
  });

  const gate = {
    hasEvidenceForAll: verifiedCount === latest.length,
    finalPageStatusVerified,
    zeroFailures: failRows.length === 0,
    zeroBlockedOrigin: !latest.some((r) => r.blocked_by_policy),
    zeroUnresolvedBlockers: blockerAmb.length === 0,
    allReady: latest.every((r) => r.readiness === 'READY' || r.readiness === 'CONFIRMED_GONE'),
  };
  gate.releasable = Object.entries(gate)
    .filter(([k]) => k !== 'releasable').every(([, v]) => v === true);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      affectedLinks: latest.length,
      verified: verifiedCount,
      passed: passRows.length,
      failed: failRows.length,
      unresolvedAmbiguities: ambRows.length,
      blockers: blockerAmb.length,
    },
    gate,
    blockers: failRows.map((r) => ({
      id: r.id, raw: r.raw_old_url, target: r.target_new_url,
      finalUrl: r.final_url, finalStatus: r.final_status,
      issues: r.issue_codes, detail: r.issue_detail,
      chain: r.chain, blocked: r.blocked_by_policy,
    })),
    links: latest,
    ambiguities: ambRows,
  };
});

// 生产模式托管构建后的工作台
const dist = join(__dirname, '..', 'web', 'dist');
if (existsSync(dist)) {
  app.register(fastifyStatic, { root: dist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith('/api/')) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'not found' });
  });
}

await startLocalSites();
// 启动即自检：旧/新站必须只监听在 127.0.0.1
await app.listen({ port: API_PORT, host: '127.0.0.1' });
app.log.info(`API       http://127.0.0.1:${API_PORT}`);
app.log.info(`本地站点模式 SITE_MODE=${SITE_MODE}`);
app.log.info(`旧站(随启) ${OLD_ORIGIN}  /  新站(随启) ${NEW_ORIGIN}`);
app.log.info(`验证器允许访问名单: ${ALLOWED_ORIGINS.join(' , ')}`);

const shutdown = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

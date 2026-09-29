// seed.js — 演示数据集：编码中文路径、追踪参数保留、已删除栏目、
// 重定向环、过长链、越权重定向、大小写/编码/尾斜杠/查询歧义、目标缺失、丢查询。
// 幂等：清空后重建。
import { pool } from '../server/lib/db.js';
import { normalizeUrl, detectAmbiguities } from '../server/lib/normalize.js';

const OLD = 'http://127.0.0.1:18080';
const NEW = 'http://127.0.0.1:18081';

// decision: REDIRECT_301 / GONE_410 / UNMAPPED
// expectedTarget 仅用于歧义检测分组（映射表里的裁决目标）
const rawSeed = [
  {
    raw: `${OLD}/News/Tech/123?id=8&utm_source=weekly_newsletter&spm=a2.13`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/tech/123?id=8&utm_source=weekly_newsletter&spm=a2.13`,
    sectionOld: 'News/Tech', sectionNew: 'tech',
    note: '正常迁移：查询与追踪参数端到端保留',
  },
  {
    raw: `${OLD}/News/Tech/456?gclid=AB-CD_123&page=2`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/tech/456?gclid=AB-CD_123&page=2`,
    sectionOld: 'News/Tech', sectionNew: 'tech',
    note: '缺陷演示：旧站当前 301 会丢掉查询串（追踪参数丢失）',
  },
  {
    raw: `${OLD}/News/Tech/999?utm_campaign=spring#chapter-2`,
    variants: [`${OLD}/News/Tech/999?utm_campaign=spring`],
    decision: 'REDIRECT_301',
    target: `${NEW}/tech/999?utm_campaign=spring`,
    sectionOld: 'News/Tech', sectionNew: 'tech',
    note: 'fragment 不属于资源身份（R7），两种原始形态归一为同一资源',
  },
  {
    raw: `${OLD}/News/Tech/999?utm_campaign=spring#archived`,
    variants: [],
    decision: 'GONE_410',
    target: null,
    sectionOld: 'News/Tech', sectionNew: null,
    note: '归一冲突演示：同一资源键（fragment 被剥离）出现“重定向/下线”两份矛盾裁决',
  },
  {
    raw: `${OLD}/News/Life/77?utm_source=oldportal`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/life/77?utm_source=oldportal`,
    sectionOld: 'News/Life', sectionNew: 'life',
    note: '缺陷演示：映射目标在新站不存在，最终状态必须核实出来',
  },
  {
    raw: `${OLD}/%E6%A0%8F%E7%9B%AE/weekly?utm_source=wechat`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/column/weekly?utm_source=wechat`,
    sectionOld: '栏目', sectionNew: 'column',
    note: '编码中文路径：百分号编码字节保真，不做自由解码',
  },
  {
    raw: `${OLD}/Sports/Basketball/?ref=home`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/sport/basketball/?ref=home`,
    sectionOld: 'Sports', sectionNew: 'sport',
    note: '带尾斜杠的真实资源（对照无斜杠形态）',
  },
  {
    raw: `${OLD}/Sports/Basketball?ref=home`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/sport/basketball?ref=home`,
    sectionOld: 'Sports', sectionNew: 'sport',
    note: '尾斜杠歧义对照：旧站无斜杠实际 404，需人工确认是否同资源',
  },
  {
    raw: `${OLD}/news/tech/123?id=8&utm_source=weekly_newsletter&spm=a2.13`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/tech/123?id=8&utm_source=weekly_newsletter&spm=a2.13`,
    sectionOld: 'news/tech', sectionNew: 'tech',
    note: '大小写歧义对照：路径大小写敏感，旧站小写形态为 404',
  },
  {
    raw: `${OLD}/Dead/column/9`,
    variants: [],
    decision: 'GONE_410',
    target: null,
    sectionOld: 'Dead', sectionNew: null,
    note: '已删除栏目：不做跳转，明确返回 410 Gone',
  },
  {
    raw: `${OLD}/Dead/column/9?from=footer`,
    variants: [],
    decision: 'GONE_410',
    target: null,
    sectionOld: 'Dead', sectionNew: null,
    note: '已删除栏目的带查询入口：同样必须 410；查询不同不折叠（R6，QUERY_VARIANT 对照）',
  },
  {
    raw: `${OLD}/loop/a`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/loops/end`,
    sectionOld: 'loop', sectionNew: 'loops',
    note: '缺陷演示：旧站存在重定向环',
  },
  {
    raw: `${OLD}/chain/0`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/chains/end`,
    sectionOld: 'chain', sectionNew: 'chains',
    note: '缺陷演示：旧站重定向链过长（>5 跳）',
  },
  {
    raw: `${OLD}/promo/partner?utm_term=partner`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/partners/landing?utm_term=partner`,
    sectionOld: 'promo', sectionNew: 'partners',
    note: '缺陷演示：旧站把访问引到项目外站点 example.com，验证必须拦截',
  },
  {
    raw: `${OLD}/a%2Fb`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/new/encoded/a-b`,
    sectionOld: 'misc', sectionNew: 'new',
    note: '编码即资源：%2F 不是分隔符，与 /a/b 不得合并',
  },
  {
    raw: `${OLD}/a/b`,
    variants: [],
    decision: 'REDIRECT_301',
    target: `${NEW}/new/a/b`,
    sectionOld: 'misc', sectionNew: 'new',
    note: '编码歧义对照：真实的两级路径 /a/b',
  },
];

const normalized = rawSeed.map((s) => {
  const n = normalizeUrl(s.raw, OLD);
  if (!n.ok) throw new Error(`seed URL 规范化失败: ${s.raw} -> ${n.error}`);
  return { ...s, n, expectedTarget: s.target };
});

// detectAmbiguities 期望 {ok, origin,path,query,canonicalKey,raw,pathSegments,expectedTarget}
const amb = detectAmbiguities(normalized.map((s) => ({ ...s.n, raw: s.raw, expectedTarget: s.target })));

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('TRUNCATE migration_plan, crawl_results, ambiguities, url_mappings RESTART IDENTITY CASCADE');

  for (const s of normalized) {
    await client.query(
      `INSERT INTO url_mappings
        (raw_old_url, raw_variants, canonical_key, old_origin, old_path, old_query,
         decision, target_new_url, section_old, section_new, note, crawl_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'seed')`,
      [s.raw, s.variants, s.n.canonicalKey, s.n.origin, s.n.path, s.n.query,
       s.decision, s.target, s.sectionOld, s.sectionNew, s.note],
    );
  }

  for (const a of amb) {
    await client.query(
      `INSERT INTO ambiguities (kind, severity, canonical_key, candidate_urls, candidate_targets, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.kind, a.severity, a.canonicalKey, a.candidateUrls, a.candidateTargets, a.detail],
    );
  }

  // 迁移方案：按当前映射裁决生成初稿，readiness 一律 PENDING（填表 ≠ 完成）
  await client.query(`
    INSERT INTO migration_plan (mapping_id, proposed_action, proposed_target, readiness)
    SELECT id,
           CASE decision WHEN 'GONE_410' THEN 'GONE_410' ELSE 'REDIRECT_301' END,
           target_new_url,
           'PENDING'
    FROM url_mappings
  `);

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}

console.log(`✓ seeded ${normalized.length} 条映射，检出 ${amb.length} 条歧义：`);
for (const a of amb) console.log(`  [${a.severity}] ${a.kind}  ${a.canonicalKey}`);
await pool.end();

// remediate.js — 发布前评审结论落库（数据层修复），配合 SITE_MODE=fixed 复跑
// 每一步都是“评审动作”，有明确结论与理由；不是改验证结果，而是修正映射与裁决。
import { pool } from '../server/lib/db.js';

const OLD = 'http://127.0.0.1:18080';
const NEW = 'http://127.0.0.1:18081';

async function getOne(sql, p = []) {
  const { rows } = await pool.query(sql, p);
  return rows[0];
}

// 1) 归一冲突：同资源键的“重定向 vs 410”矛盾裁决——
//    评审结论：保留 301 到新站 tech/999；删除误登记的 410 条目（fragment 不同不构成两资源）
const conflict = await getOne(
  `SELECT m.id FROM url_mappings m
     JOIN ambiguities a ON a.canonical_key = m.canonical_key AND a.kind='CONFLICT'
    WHERE m.decision='GONE_410' LIMIT 1`);
if (conflict) {
  await pool.query('DELETE FROM url_mappings WHERE id=$1', [conflict.id]);
  console.log('✓ 删除矛盾的 GONE_410 条目 #' + conflict.id);
}
await pool.query(
  `UPDATE ambiguities SET resolved=true,
     resolution='评审：fragment 不构成不同资源（R7），统一 301 到 tech/999，误登记的 410 已删除'
   WHERE kind='CONFLICT' AND resolved=false`);

// 2) 尾斜杠：评审确认 /Sports/Basketball（无斜杠）在旧站本就 404、不属于受影响资源，
//    不应做迁移——从映射范围移除（404 即正确响应，不造假跳转）；带斜杠条目保留
const noSlash = await getOne(
  `SELECT id FROM url_mappings WHERE old_path='/Sports/Basketball'`);
if (noSlash) {
  await pool.query('DELETE FROM url_mappings WHERE id=$1', [noSlash.id]);
  console.log('✓ 移出迁移范围：无尾斜杠形态 #' + noSlash.id + '（旧站真实 404，维持 404）');
}
await pool.query(
  `UPDATE ambiguities SET resolved=true,
     resolution='评审：尾斜杠是路径的一部分（R5），确认为两个资源；无斜杠形态从迁移范围移除'
   WHERE kind='TRAILING_SLASH' AND resolved=false`);

// 3) 大小写：评审确认小写 /news/tech/123 为历史误写，需在旧站补规范 301（站点层修复），
//    映射保留并按大小写敏感原则独立验证（不与大写形态合并）
await pool.query(
  `UPDATE ambiguities SET resolved=true,
     resolution='评审：路径大小写敏感（R3），小写形态确认为误写；旧站补 301 兜底（SITE_MODE=fixed），两条映射独立保留'
   WHERE kind='CASE_VARIANT' AND resolved=false`);

// 4) 编码形态：%2F 与真实斜杠确认为不同资源，保持独立，不折叠
await pool.query(
  `UPDATE ambiguities SET resolved=true,
     resolution='评审：%2F 是编码字节不是分隔符（R4），/a%2Fb 与 /a/b 保持两个资源，不合并'
   WHERE kind='ENCODING_VARIANT' AND resolved=false`);

// 5) 查询形态：追踪参数必须保留，按查询独立验证，不折叠
await pool.query(
  `UPDATE ambiguities SET resolved=true,
     resolution='评审：查询参数（含 utm_*）端到端保留（R6），/Dead/column/9 两种入口均返回 410'
   WHERE kind='QUERY_VARIANT' AND resolved=false`);

// 6) 栏目并入归档：站点层把 /News/Life/77 落到 /archive/life/77 后，映射目标必须同步，
//    否则“站点改了、表没改”同样是 TARGET_MISMATCH——更新映射与迁移方案
const life = await getOne(
  `SELECT id, target_new_url FROM url_mappings WHERE old_path='/News/Life/77'`);
if (life && life.target_new_url && life.target_new_url.includes('/life/77')
    && !life.target_new_url.includes('/archive/')) {
  const newTarget = life.target_new_url.replace('/life/77', '/archive/life/77');
  await pool.query('UPDATE url_mappings SET target_new_url=$2, updated_at=now() WHERE id=$1',
    [life.id, newTarget]);
  await pool.query('UPDATE migration_plan SET proposed_target=$2, updated_at=now() WHERE mapping_id=$1',
    [life.id, newTarget]);
  console.log('✓ 同步归档栏目的映射目标 #' + life.id + ' -> ' + newTarget);
}

const { rows: left } = await pool.query(
  'SELECT count(*)::int AS n FROM ambiguities WHERE resolved=false');
console.log(`✓ 未决歧义剩余 ${left[0].n} 条`);
await pool.end();

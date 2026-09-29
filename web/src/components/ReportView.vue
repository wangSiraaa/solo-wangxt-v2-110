<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import ChainView from './ChainView.vue';

const rep = ref(null);
const showBlockers = ref(true);
async function load() { rep.value = await api.report(); }
onMounted(load);

const gateLabels = {
  hasEvidenceForAll: '每条受影响链接都有最新验证证据（不是只填了映射表）',
  finalPageStatusVerified: '最终页面状态已核实（301→200；下线→410 且无跳转）',
  zeroFailures: '不存在未通过的链接',
  zeroBlockedOrigin: '不存在把访问引向项目外站点的旧链接（越权跳转是缺陷；验证器已拦截、未实际访问）',
  zeroUnresolvedBlockers: '无未裁决的 BLOCKER 归一化歧义',
  allReady: '迁移方案条目均为 READY / CONFIRMED_GONE',
};
</script>

<template>
  <div v-if="rep">
    <div class="gate" :class="rep.gate.releasable ? 'go' : 'no'">
      {{ rep.gate.releasable ? '✅ 发布闸门通过：可以上线' : '⛔ 发布闸门未通过：禁止上线' }}
      <div style="font-weight:400;font-size:12.5px;margin-top:4px">
        报告生成时间 {{ new Date(rep.generatedAt).toLocaleString() }} ｜
        受影响链接 {{ rep.totals.affectedLinks }} ｜ 已验证 {{ rep.totals.verified }} ｜
        通过 {{ rep.totals.passed }} ｜ 未通过 {{ rep.totals.failed }} ｜
        未裁决歧义 {{ rep.totals.unresolvedAmbiguities }}（BLOCKER {{ rep.totals.blockers }}）
      </div>
    </div>

    <div class="card">
      <h2>发布检查清单（闸门逐项证据）</h2>
      <ul class="gates">
        <li v-for="(v, k) in gateLabels" :key="k" :class="rep.gate[k] ? 'ok' : 'no'">
          <span :style="{ color: rep.gate[k] ? 'var(--ok)' : 'var(--bad)' }">
            {{ rep.gate[k] ? '✓' : '✗' }}
          </span>
          {{ v }}
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>必须先修复的问题（{{ rep.blockers.length }}）</h2>
      <table>
        <thead><tr><th>旧址</th><th>映射目标</th><th>链尾</th><th>问题</th><th>链证据</th></tr></thead>
        <tbody>
          <tr v-for="b in rep.blockers" :key="b.id">
            <td style="max-width:260px"><code>{{ b.raw }}</code></td>
            <td style="max-width:230px"><code>{{ b.target || '—' }}</code></td>
            <td><b :style="{color: b.finalStatus===200?'var(--ok)':'var(--bad)'}">{{ b.finalStatus ?? '拦截' }}</b>
              <div class="muted"><code>{{ b.finalUrl }}</code></div></td>
            <td><code v-for="x in b.issues" :key="x" class="badge fail" style="margin:2px">{{ x }}</code>
              <div class="muted">{{ b.detail }}</div></td>
            <td><ChainView :chain="b.chain" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>全部受影响链接及验证证据（{{ rep.links.length }}）</h2>
      <table>
        <thead>
          <tr><th>#</th><th>旧址</th><th>裁决/目标</th><th>最终落点与状态</th>
            <th>参数保留</th><th>证据</th><th>方案状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="l in rep.links" :key="l.id">
            <td>{{ l.id }}</td>
            <td style="max-width:280px"><code>{{ l.raw_old_url }}</code>
              <div class="muted">{{ l.note }}</div></td>
            <td style="max-width:250px">
              {{ l.decision === 'GONE_410' ? '410 Gone' : '301 →' }}
              <code v-if="l.target_new_url">{{ l.target_new_url }}</code>
            </td>
            <td style="max-width:280px">
              <code>{{ l.final_url || '—' }}</code>
              <div><b :style="{color:l.final_status===200||l.final_status===410?'var(--ok)':'var(--bad)'}">
                {{ l.final_status ?? '未验证' }}
              </b></div>
            </td>
            <td>
              <span v-if="l.query_preserved === true" class="badge pass">保留</span>
              <span v-else-if="l.query_preserved === false" class="badge fail">丢失</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="!l.outcome" class="badge pending">尚无证据</span>
              <span v-else class="badge" :class="l.outcome.toLowerCase()">
                {{ l.outcome }}@{{ new Date(l.checked_at).toLocaleTimeString() }}
              </span>
              <ChainView v-if="l.chain?.length > 1" :chain="l.chain" />
            </td>
            <td><span class="badge" :class="l.readiness.toLowerCase()">{{ l.readiness }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>未裁决歧义（{{ rep.ambiguities.length }}）</h2>
      <table>
        <thead><tr><th>级别</th><th>类型</th><th>候选</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="a in rep.ambiguities" :key="a.id">
            <td><span class="badge" :class="a.severity.toLowerCase()">{{ a.severity }}</span></td>
            <td>{{ a.kind }}</td>
            <td style="max-width:320px">
              <div v-for="u in a.candidate_urls" :key="u"><code>{{ u }}</code></div>
            </td>
            <td>{{ a.detail }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

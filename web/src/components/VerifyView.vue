<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import ChainView from './ChainView.vue';

const runs = ref([]);
const selected = ref(null);
const running = ref(false);

async function loadRuns() { runs.value = (await api.runs()).rows; }
async function showRun(id) { selected.value = await api.run(id); }
async function verify() {
  running.value = true;
  try {
    const { runId } = await api.verify();
    await loadRuns();
    await showRun(runId);
  } finally { running.value = false; }
}
const codeText = {
  REDIRECT_LOOP: '重定向环',
  CHAIN_TOO_LONG: '重定向链过长（>5 跳）',
  BLOCKED_ORIGIN: '试图访问项目外站点，已拦截',
  QUERY_LOST: '查询/追踪参数未端到端保留',
  FINAL_STATUS_NOT_OK: '最终页面非 200',
  TARGET_MISMATCH: '链尾与映射目标不一致',
  OLD_URL_404: '旧链接当前即 404（大小写/拼写问题）',
  OLD_STATUS_UNEXPECTED: '旧链接首跳状态不是 301',
  EXPECTED_410: '已删除栏目应返回 410，实际不符',
  GONE_MUST_NOT_REDIRECT: '410 资源不应再跳转',
  NETWORK_ERROR: '请求失败',
};
onMounted(loadRuns);
</script>

<template>
  <div class="card">
    <div class="toolbar">
      <button class="primary" :disabled="running" @click="verify">
        {{ running ? '正在验证（手工逐跳跟随）…' : '▶ 对全部受影响链接执行验证' }}
      </button>
      <span class="muted">
        手工跟随重定向：每一跳都先校验目的 origin 是否在
        <code>127.0.0.1:18080/18081</code> 名单内；检环、限长 5 跳，并核实最终页面状态。
      </span>
    </div>
    <div v-if="runs.length" style="margin-bottom:14px">
      <b class="muted">历史运行：</b>
      <button v-for="r in runs" :key="r.id" class="small" style="margin:2px" @click="showRun(r.id)">
        #{{ r.id }} {{ new Date(r.started_at).toLocaleString() }}
        <span :style="{color: r.failed_count ? 'var(--bad)' : 'var(--ok)'}">
          ✓{{ r.passed_count }} ✗{{ r.failed_count }}
        </span>
      </button>
    </div>
  </div>

  <div v-if="selected" class="card">
    <h2>运行 #{{ selected.run.id }} 证据
      <span class="muted" style="font-weight:400">
        共 {{ selected.run.total_count }} ｜
        <span style="color:var(--ok)">通过 {{ selected.run.passed_count }}</span> ｜
        <span style="color:var(--bad)">未通过 {{ selected.run.failed_count }}</span> ｜
        越权拦截 {{ selected.run.blocked_count }} ｜
        歧义 {{ selected.run.ambiguous_count }}
      </span>
    </h2>
    <table>
      <thead>
        <tr><th>旧址</th><th>裁决</th><th>结果</th><th>问题</th><th>重定向链证据</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in selected.results" :key="c.id">
          <td style="max-width:280px"><code>{{ c.raw_old_url }}</code></td>
          <td>{{ c.decision === 'GONE_410' ? '410' : '301' }}</td>
          <td>
            <span class="badge" :class="c.outcome.toLowerCase()">{{ c.outcome }}</span>
            <div class="muted">链尾 {{ c.final_status ?? '—' }}（{{ c.hop_count }} 跳）</div>
          </td>
          <td style="max-width:260px">
            <div v-if="!c.issue_codes.length" class="muted">无</div>
            <div v-for="x in c.issue_codes" :key="x">
              <span class="badge fail">{{ x }}</span>
              <div class="muted">{{ codeText[x] || '' }}</div>
            </div>
            <div v-if="c.issue_detail" class="muted" style="max-width:250px">{{ c.issue_detail }}</div>
          </td>
          <td><ChainView :chain="c.chain" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

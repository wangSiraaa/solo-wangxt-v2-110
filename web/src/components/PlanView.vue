<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';

const rows = ref([]);
async function load() { rows.value = (await api.plan()).rows; }
async function toggleReview(p) { await api.reviewPlan(p.id, !p.reviewed); await load(); }
const label = {
  PENDING: '待验证', READY: '可发布', BLOCKED: '被阻塞', CONFIRMED_GONE: '已确认下线(410)',
};
onMounted(load);
</script>

<template>
  <div class="card">
    <h2>迁移方案（证据驱动，不允许“填完映射表即完成”）</h2>
    <p class="muted" style="margin-top:0">
      readiness 由最近一次验证运行的证据自动计算：仅当链路无环、未越权、最终页面状态正确、
      追踪参数保留且不存在 BLOCKER 歧义时，才进入 READY / CONFIRMED_GONE。
    </p>
    <table>
      <thead>
        <tr><th>旧址</th><th>方案动作</th><th>目标</th><th>闸门状态</th><th>阻塞原因（证据）</th><th>人工复核</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in rows" :key="p.id">
          <td style="max-width:280px"><code>{{ p.raw_old_url }}</code>
            <div class="muted">{{ p.note }}</div>
          </td>
          <td>
            <span class="badge" :class="p.proposed_action === 'GONE_410' ? 'gone' : 'ready'">
              {{ p.proposed_action === 'GONE_410' ? '410 Gone' : '301 永久重定向' }}
            </span>
          </td>
          <td style="max-width:260px">
            <code v-if="p.proposed_target">{{ p.proposed_target }}</code>
            <span v-else class="muted">—</span>
          </td>
          <td><span class="badge" :class="p.readiness.toLowerCase()">{{ label[p.readiness] }}</span>
            <div v-if="p.evidence_at" class="muted">证据：{{ new Date(p.evidence_at).toLocaleString() }}</div>
          </td>
          <td style="max-width:280px">
            <div v-if="!p.block_reasons.length" class="muted">无</div>
            <code v-for="b in p.block_reasons" :key="b" class="badge fail" style="margin:2px">{{ b }}</code>
          </td>
          <td>
            <button class="small" :disabled="p.readiness === 'BLOCKED' || p.readiness === 'PENDING'"
                    @click="toggleReview(p)">
              {{ p.reviewed ? '已复核 ✓' : '标记复核' }}
            </button>
            <div v-if="(p.readiness==='BLOCKED'||p.readiness==='PENDING')" class="muted">
              阻塞/未验证项不可复核
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

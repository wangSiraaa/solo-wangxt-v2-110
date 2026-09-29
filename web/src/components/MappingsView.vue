<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import ChainView from './ChainView.vue';

const rows = ref([]);
const open = ref(new Set());
async function load() { rows.value = (await api.mappings()).rows; }
function toggle(id) {
  const s = new Set(open.value);
  s.has(id) ? s.delete(id) : s.add(id);
  open.value = s;
}
onMounted(load);
</script>

<template>
  <div class="card">
    <h2>旧/新链接映射（{{ rows.length }} 条受影响链接）</h2>
    <p class="muted" style="margin-top:0">
      canonical_key 由 WHATWG URL 生成：host 小写、路径保持大小写（R3）、百分号编码字节保真（R4）、
      尾斜杠保留（R5）、查询与追踪参数原样保留（R6）、剥离 fragment（R7）。映射存在 ≠ 迁移完成，
      每条须经“验证运行”拿到最终页面证据。
    </p>
    <table>
      <thead>
        <tr>
          <th>#</th><th>原始旧址（原样保存）</th><th>canonical_key</th>
          <th>裁决</th><th>新址 / 最终状态</th><th>最新验证</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.id }}</td>
          <td style="max-width:300px">
            <code>{{ r.raw_old_url }}</code>
            <div v-for="v in r.raw_variants" :key="v" class="muted">
              变体：<code>{{ v }}</code>
            </div>
            <div class="muted">{{ r.section_old }} → {{ r.section_new || '—（下线）' }}</div>
            <div class="muted">{{ r.note }}</div>
          </td>
          <td style="max-width:260px"><code>{{ r.canonical_key }}</code></td>
          <td>
            <span class="badge" :class="r.decision === 'GONE_410' ? 'gone' : 'ready'">
              {{ r.decision === 'GONE_410' ? '410 Gone' : r.decision === 'UNMAPPED' ? '不映射' : '301' }}
            </span>
          </td>
          <td style="max-width:260px">
            <div v-if="r.target_new_url"><code>{{ r.target_new_url }}</code></div>
            <div v-else class="muted">无（下线）</div>
            <div v-if="r.final_status != null" class="muted">
              链尾状态：<b :style="{color: r.final_status === 200 ? 'var(--ok)' : 'var(--bad)'}">{{ r.final_status }}</b>
              <span v-if="r.query_preserved === false" class="badge fail">追踪/查询参数丢失</span>
              <span v-if="r.blocked_by_policy" class="badge fail">越权已拦截</span>
            </div>
          </td>
          <td>
            <span v-if="!r.outcome" class="badge pending">未验证</span>
            <span v-else class="badge" :class="r.outcome.toLowerCase()">{{ r.outcome }}</span>
            <div v-if="r.issue_codes?.length" class="muted" style="max-width:150px">
              <code v-for="c in r.issue_codes" :key="c">{{ c }} </code>
            </div>
          </td>
          <td><button class="small" @click="toggle(r.id)">{{ open.has(r.id) ? '隐' : '链' }}</button></td>
        </tr>
        <tr v-if="open.has(r.id)">
          <td colspan="7">
            <div v-if="!r.chain?.length" class="muted">尚无验证证据，请先执行验证运行。</div>
            <ChainView v-else :chain="r.chain" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

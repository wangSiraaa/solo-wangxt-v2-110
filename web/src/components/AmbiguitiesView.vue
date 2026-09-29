<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';

const rows = ref([]);
const busy = ref(false);
async function load() { rows.value = (await api.ambiguities()).rows; }
async function resolve(id) {
  busy.value = true;
  try {
    await api.resolveAmbiguity(id, '人工评审确认：按裁决保留区分，不自动合并');
    await load();
  } finally { busy.value = false; }
}
const kindLabel = {
  CASE_VARIANT: '路径大小写形态',
  ENCODING_VARIANT: '百分号编码形态',
  CONFLICT: '归一后目标冲突',
  TRAILING_SLASH: '尾斜杠形态',
  QUERY_VARIANT: '查询参数形态',
};
onMounted(load);
</script>

<template>
  <div class="card">
    <h2>归一化歧义（多旧址归一后的冲突，须人工裁决）</h2>
    <p class="muted" style="margin-top:0">
      系统不做“decodeURIComponent 后合并”。仅大小写/编码/尾斜杠/查询不同的候选默认是不同资源，
      只登记提示；同一资源键却出现互相矛盾的裁决是 BLOCKER，发布闸门不放行。
    </p>
    <table>
      <thead>
        <tr><th>类型</th><th>级别</th><th>候选旧链接</th><th>冲突目标</th><th>说明</th><th>状态</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="a in rows" :key="a.id">
          <td>{{ kindLabel[a.kind] || a.kind }}</td>
          <td><span class="badge" :class="a.severity.toLowerCase()">{{ a.severity }}</span></td>
          <td style="max-width:330px">
            <div v-for="u in a.candidate_urls" :key="u"><code>{{ u }}</code></div>
          </td>
          <td style="max-width:240px">
            <div v-if="!a.candidate_targets.length" class="muted">—</div>
            <div v-for="t in a.candidate_targets" :key="t"><code>{{ t }}</code></div>
          </td>
          <td style="max-width:360px">{{ a.detail }}</td>
          <td>
            <span v-if="a.resolved" class="badge pass">已裁决</span>
            <span v-else class="badge pending">待裁决</span>
            <div v-if="a.resolution" class="muted">{{ a.resolution }}</div>
          </td>
          <td>
            <button v-if="!a.resolved" class="small" :disabled="busy" @click="resolve(a.id)">
              标记已人工处理
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

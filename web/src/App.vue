<script setup>
import { ref, onMounted } from 'vue';
import { api } from './api.js';
import MappingsView from './components/MappingsView.vue';
import AmbiguitiesView from './components/AmbiguitiesView.vue';
import VerifyView from './components/VerifyView.vue';
import PlanView from './components/PlanView.vue';
import ReportView from './components/ReportView.vue';

const health = ref(null);
const tab = ref('mappings');
const tabs = [
  ['mappings', '映射总览'],
  ['ambiguities', '归一化歧义'],
  ['verify', '验证运行'],
  ['plan', '迁移方案'],
  ['report', '发布闸门报告'],
];
onMounted(async () => { health.value = await api.health(); });
</script>

<template>
  <div class="topbar">
    <h1>栏目改版 · 旧链接迁移验证工作台</h1>
    <span class="sub">Vue 3 + Fastify + PostgreSQL ｜ WHATWG URL 规范化 ｜ 验证器仅访问随项目启动的本地站点</span>
    <span v-if="health" class="sub">
      站点模式：<b :style="{color: health.siteMode === 'fixed' ? 'var(--ok)' : 'var(--warn)'}">
        {{ health.siteMode === 'fixed' ? 'fixed（缺陷已修复）' : 'broken（含内置缺陷）' }}
      </b> ｜
      允许访问名单：
      <code v-for="o in health.allowedOrigins" :key="o" class="mono tag">{{ o }}</code>
    </span>
  </div>
  <div class="layout">
    <div class="sidebar">
      <button v-for="[k, label] in tabs" :key="k"
              :class="{ active: tab === k }" @click="tab = k">{{ label }}</button>
    </div>
    <div class="content">
      <MappingsView v-if="tab === 'mappings'" />
      <AmbiguitiesView v-else-if="tab === 'ambiguities'" />
      <VerifyView v-else-if="tab === 'verify'" />
      <PlanView v-else-if="tab === 'plan'" />
      <ReportView v-else />
    </div>
  </div>
</template>

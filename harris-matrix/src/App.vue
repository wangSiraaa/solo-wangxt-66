<script setup lang="ts">
import { onMounted, provide, ref } from 'vue'
import MatrixCanvas from './components/MatrixCanvas.vue'
import RelationForm from './components/RelationForm.vue'
import RelationList from './components/RelationList.vue'
import BatchPanel from './components/BatchPanel.vue'
import DatingPanel from './components/DatingPanel.vue'
import HypothesisPanel from './components/HypothesisPanel.vue'
import ComparePanel from './components/ComparePanel.vue'
import { clearAll, reload, state } from './store'
import { loadSample } from './sample'
import { exportProject, importProject } from './io'

const mode = ref<'raw' | 'simplified'>('raw')
const tab = ref<'relations' | 'dating' | 'hypotheses' | 'compare'>('relations')
const canvas = ref<InstanceType<typeof MatrixCanvas>>()
const notice = ref('')
const fileInput = ref<HTMLInputElement>()

onMounted(reload)

// 供各面板把成环/矛盾路径投到画布上
provide('highlightCycle', (ids: string[]) => canvas.value?.highlightCycle(ids))

function onCycle(ids: string[]) {
  canvas.value?.highlightCycle(ids)
}

async function onExport() {
  const json = await exportProject()
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `harris-matrix-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  notice.value = '已导出（含偏序摘要，导入时将校验偏序不变）。'
}

async function onImportFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const res = await importProject(await file.text())
  if (!res.ok) {
    notice.value = `导入失败：${res.error}`
  } else {
    notice.value = `导入完成：${res.counts!.loci} 层位 / ${res.counts!.relations} 关系 / ${res.counts!.evidence} 证据 / ${res.counts!.dating} 测年；偏序校验${
      res.orderPreserved ? '通过，偏序未改变 ✓' : '未通过 ✗'
    }`
  }
  ;(ev.target as HTMLInputElement).value = ''
}

async function onClear() {
  await clearAll()
  notice.value = '已清空本地工程。'
}

async function onSample() {
  await loadSample()
  notice.value =
    '示例工程已载入：TG1/TG2 双探方（含同号不同层位 105）、切割事件、孤立层 TG1·110、矛盾记录、4 条测年、甲乙两个关联假设。'
}
</script>

<template>
  <div class="app">
    <header>
      <h1>地层矩阵编辑台 <small>Harris Matrix · 纯浏览器 · 数据不出本机</small></h1>
      <div class="toolbar">
        <div class="toggle">
          <button :class="{ on: mode === 'raw' }" @click="mode = 'raw'">
            原始关系
          </button>
          <button
            :class="{ on: mode === 'simplified' }"
            @click="mode = 'simplified'"
          >
            简化矩阵
          </button>
        </div>
        <button @click="onSample">载入示例</button>
        <button @click="onExport">导出 JSON</button>
        <button @click="fileInput?.click()">导入 JSON</button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json"
          hidden
          @change="onImportFile"
        />
        <button class="danger" @click="onClear">清空</button>
      </div>
    </header>
    <div v-if="notice" class="notice">{{ notice }}</div>
    <main>
      <aside class="left">
        <RelationForm @cycle="onCycle" />
        <BatchPanel />
      </aside>
      <section class="center">
        <MatrixCanvas ref="canvas" :mode="mode" />
      </section>
      <aside class="right">
        <nav class="tabs">
          <button :class="{ on: tab === 'relations' }" @click="tab = 'relations'">台账</button>
          <button :class="{ on: tab === 'dating' }" @click="tab = 'dating'">测年</button>
          <button :class="{ on: tab === 'hypotheses' }" @click="tab = 'hypotheses'">假设</button>
          <button :class="{ on: tab === 'compare' }" @click="tab = 'compare'">对比</button>
        </nav>
        <RelationList v-if="tab === 'relations'" />
        <DatingPanel v-else-if="tab === 'dating'" />
        <HypothesisPanel v-else-if="tab === 'hypotheses'" />
        <ComparePanel v-else />
      </aside>
    </main>
    <footer v-if="state.loaded">
      {{ state.loci.length }} 层位 ·
      {{ state.relations.filter((r) => r.status === 'active' && r.kind === 'stratigraphic').length }} 有效有向关系 ·
      {{ state.relations.filter((r) => r.status === 'conflicted').length }} 矛盾 ·
      {{ state.relations.filter((r) => r.status === 'revoked').length }} 已撤销 ·
      {{ state.evidence.length }} 证据 ·
      {{ state.dating.length }} 测年 ·
      {{ state.hypotheses.length }} 假设
    </footer>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif; background: #efe9da; color: #3a3428; }
</style>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; padding: 10px 14px; }
header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
h1 { font-size: 18px; margin: 0; color: #4a4030; }
h1 small { font-size: 12px; color: #8a7a55; font-weight: normal; margin-left: 8px; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.toolbar button {
  font-size: 12px; padding: 5px 12px; border-radius: 5px; cursor: pointer;
  border: 1px solid #8a7a55; background: #f7f0dd; color: #4a4030;
}
.toolbar button:hover { background: #ece0c0; }
.toolbar button.danger { border-color: #b0483a; color: #8a2a20; background: #f6e6e2; }
.toggle { display: flex; border: 1px solid #8a7a55; border-radius: 5px; overflow: hidden; }
.toggle button { border: none; border-radius: 0; }
.toggle button.on { background: #8a7a55; color: #fff; }
.notice {
  margin-top: 6px; font-size: 12px; color: #5a4a20;
  background: #f8efce; border: 1px solid #e0d0a0; border-radius: 5px; padding: 4px 10px;
}
main {
  flex: 1; display: grid; gap: 12px; margin-top: 8px; min-height: 0;
  grid-template-columns: 300px 1fr 340px;
}
.left, .right { overflow-y: auto; min-height: 0; }
.center { min-height: 0; }
.tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.tabs button {
  flex: 1; font-size: 12px; padding: 4px 0; border-radius: 5px; cursor: pointer;
  border: 1px solid #b0a480; background: #f4ecd6; color: #5a4f38;
}
.tabs button.on { background: #8a7a55; color: #fff; border-color: #8a7a55; }
footer { font-size: 12px; color: #8a7a55; padding-top: 6px; }
</style>

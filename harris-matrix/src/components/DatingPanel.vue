<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  addDatingEvidence,
  locusName,
  removeDatingEvidence,
  state,
} from '../store'
import { evaluateChronology, fmtDating, fmtInterval } from '../graph/dating'

// 底稿（不含任何假设）的年代传播结果：补入新证据后立即自动反映
const baseEval = computed(() =>
  evaluateChronology({
    relations: state.relations,
    loci: state.loci,
    dating: state.dating,
    links: [],
  }),
)

const locusId = ref('')
const bpEarly = ref<number | null>(null)
const bpLate = ref<number | null>(null)
const source = ref('')
const note = ref('')
const error = ref('')

const locusOptions = computed(() =>
  [...state.loci].sort((a, b) => a.id.localeCompare(b.id)),
)

const byLocus = computed(() => {
  const map = new Map<string, typeof state.dating>()
  for (const d of state.dating) {
    if (!map.has(d.locusId)) map.set(d.locusId, [])
    map.get(d.locusId)!.push(d)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})

async function submit() {
  error.value = ''
  if (!locusId.value) {
    error.value = '请选择层位'
    return
  }
  if (!source.value.trim()) {
    error.value = '请填写来源（实验室编号 / 样品号 / 文献）'
    return
  }
  try {
    await addDatingEvidence({
      locusId: locusId.value,
      bpEarly: bpEarly.value,
      bpLate: bpLate.value,
      source: source.value.trim(),
      note: note.value.trim() || undefined,
    })
    bpEarly.value = null
    bpLate.value = null
    source.value = ''
    note.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <section class="panel">
    <h3>测年证据</h3>
    <p class="tip">
      统一数值年代轴 cal BP；未知端点留空（不会以 0 代替）。证据全库唯一一份，假设只引用、不复制。
    </p>
    <select v-model="locusId">
      <option value="" disabled>选择层位</option>
      <option v-for="l in locusOptions" :key="l.id" :value="l.id">
        {{ l.trench }}·{{ l.code }} {{ l.label }}
      </option>
    </select>
    <div class="row">
      <input
        v-model.number="bpEarly"
        type="number"
        placeholder="最早端 BP（大值，可空）"
      />
      <input
        v-model.number="bpLate"
        type="number"
        placeholder="最晚端 BP（小值，可空）"
      />
    </div>
    <input v-model="source" placeholder="来源（如 BETA-5501）" />
    <input v-model="note" placeholder="备注（可空）" />
    <button @click="submit">补入测年证据</button>
    <div v-if="error" class="error">{{ error }}</div>

    <div v-for="[lid, list] in byLocus" :key="lid" class="locus-block">
      <div class="locus-head">
        <span class="name">{{ locusName(lid) }}</span>
        <span class="derived">
          底稿导出区间：{{ fmtInterval(baseEval.intervals.get(lid) ?? { lo: null, hi: null }) }}
        </span>
      </div>
      <div v-for="d in list" :key="d.id" class="dating">
        <span class="src">📎 {{ d.source }}</span>
        <span class="range">{{ fmtDating(d) }}</span>
        <span v-if="d.note" class="note">{{ d.note }}</span>
        <button class="mini" @click="removeDatingEvidence(d.id)">删除</button>
      </div>
    </div>
    <div v-if="!state.dating.length" class="empty">尚无测年证据</div>
  </section>
</template>

<style scoped>
.panel { background: #fffdf6; border: 1px solid #e2d8bd; border-radius: 8px; padding: 10px 12px; }
h3 { margin: 0 0 6px; font-size: 14px; color: #5a4f38; }
.tip { font-size: 11px; color: #8a7a55; margin: 0 0 8px; }
input, select { font-size: 13px; padding: 4px 6px; border: 1px solid #d5c9a8; border-radius: 4px; background: #fff; margin-bottom: 6px; width: 100%; box-sizing: border-box; }
.row { display: flex; gap: 6px; }
button { font-size: 13px; padding: 5px 12px; border-radius: 5px; cursor: pointer; border: 1px solid #8a7a55; background: #efe6cc; color: #4a4030; }
button:hover { background: #e4d6b2; }
.error { color: #a03024; font-size: 12px; margin-top: 6px; }
.locus-block { margin-top: 10px; border-top: 1px dashed #e0d5b5; padding-top: 6px; }
.locus-head { display: flex; justify-content: space-between; font-size: 12px; }
.name { font-weight: bold; color: #5a4f38; }
.derived { color: #4a6a8a; }
.dating { display: flex; gap: 6px; align-items: baseline; font-size: 12px; padding: 2px 0 2px 8px; flex-wrap: wrap; }
.src { color: #5a6a7a; }
.range { color: #3a5a3a; }
.note { color: #8a8578; }
.empty { font-size: 12px; color: #a89f88; margin-top: 8px; }
button.mini { font-size: 11px; padding: 1px 8px; border-radius: 4px; border: 1px solid #b0a480; background: #f4ecd6; }
</style>

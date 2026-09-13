<script setup lang="ts">
import { computed, ref } from 'vue'
import { addRelation, addLocus, locusName, state } from '../store'
import type { RelationKind, RelationLayer } from '../types'
import { KIND_LABEL } from '../types'

const emit = defineEmits<{ cycle: [ids: string[]] }>()

// ---- 新增关系 ----
const kind = ref<RelationKind>('stratigraphic')
const layer = ref<RelationLayer>('observation')
const from = ref('')
const to = ref('')
const basis = ref('')
const evidenceText = ref('')
const error = ref('')
const cyclePath = ref<string[] | null>(null)
const saved = ref('')

const locusOptions = computed(() =>
  [...state.loci].sort((a, b) => a.id.localeCompare(b.id)),
)

async function submit(allowConflict = false) {
  error.value = ''
  saved.value = ''
  cyclePath.value = null
  if (!from.value || !to.value) {
    error.value = '请选择两个层位'
    return
  }
  if (kind.value === 'stratigraphic' && from.value === to.value) {
    error.value = '层位不能与自身构成先后关系'
    return
  }
  const res = await addRelation({
    kind: kind.value,
    from: from.value,
    to: to.value,
    layer: layer.value,
    basis: basis.value || undefined,
    evidenceTexts: evidenceText.value ? [evidenceText.value] : [],
    allowConflict,
  })
  if (!res.ok && res.cycle) {
    cyclePath.value = res.cycle
    error.value = '该关系会闭合有向环，已拒绝写入。环路径如下：'
    emit('cycle', res.cycle)
    return
  }
  if (res.cycle) {
    cyclePath.value = res.cycle
    saved.value = '已作为「矛盾记录」留档（不参与构图），可在右侧面板撤销任一方。'
    emit('cycle', res.cycle)
  } else {
    saved.value =
      kind.value === 'association'
        ? '同期关联已保存（不进入有向图）。'
        : '关系已保存。'
  }
  basis.value = ''
  evidenceText.value = ''
}

const cycleText = computed(() =>
  cyclePath.value ? cyclePath.value.map(locusName).join(' → ') : '',
)

// ---- 新增层位 ----
const newTrench = ref('TG1')
const newCode = ref('')
const newLabel = ref('')
const newKind = ref<keyof typeof KIND_LABEL>('layer')
const locusError = ref('')

async function submitLocus() {
  locusError.value = ''
  try {
    await addLocus({
      trench: newTrench.value.trim() || 'TG1',
      code: newCode.value.trim(),
      label: newLabel.value.trim() || newCode.value.trim(),
      kind: newKind.value,
    })
    newCode.value = ''
    newLabel.value = ''
  } catch (e) {
    locusError.value = (e as Error).message
  }
}
</script>

<template>
  <section class="panel">
    <h3>新增关系</h3>
    <div class="row">
      <label>类型</label>
      <select v-model="kind">
        <option value="stratigraphic">先后（叠压/切割/填充）</option>
        <option value="association">同期关联（无方向）</option>
      </select>
      <label>来源</label>
      <select v-model="layer">
        <option value="observation">原始观察</option>
        <option value="inference">推断</option>
      </select>
    </div>
    <div class="row">
      <select v-model="from">
        <option value="" disabled>晚的一方</option>
        <option v-for="l in locusOptions" :key="l.id" :value="l.id">
          {{ l.trench }}·{{ l.code }} {{ l.label }}
        </option>
      </select>
      <span class="arrow">{{ kind === 'association' ? '≈' : '→' }}</span>
      <select v-model="to">
        <option value="" disabled>早的一方</option>
        <option v-for="l in locusOptions" :key="l.id" :value="l.id">
          {{ l.trench }}·{{ l.code }} {{ l.label }}
        </option>
      </select>
    </div>
    <input v-model="basis" placeholder="判断依据（如：东壁剖面直接叠压）" />
    <input v-model="evidenceText" placeholder="证据（记录号 / 照片号，可空）" />
    <button @click="submit(false)">保存关系</button>

    <div v-if="error" class="error">
      {{ error }}
      <div v-if="cyclePath" class="cycle-path">{{ cycleText }}</div>
      <button v-if="cyclePath" class="danger" @click="submit(true)">
        两条观察都要留档：存为矛盾记录
      </button>
    </div>
    <div v-if="saved" class="ok">
      {{ saved }}
      <div v-if="cyclePath" class="cycle-path">{{ cycleText }}</div>
    </div>
  </section>

  <section class="panel">
    <h3>新增层位</h3>
    <div class="row">
      <input v-model="newTrench" placeholder="探方" class="narrow" />
      <input v-model="newCode" placeholder="编号（如 113）" class="narrow" />
      <input v-model="newLabel" placeholder="名称" />
      <select v-model="newKind">
        <option v-for="(label, k) in KIND_LABEL" :key="k" :value="k">
          {{ label }}
        </option>
      </select>
    </div>
    <button @click="submitLocus">保存层位</button>
    <div class="tip">编号体系按探方独立：{{ newTrench || 'TG1' }}·{{ newCode || '…' }} 与其他探方同号层位互不相同。</div>
    <div v-if="locusError" class="error">{{ locusError }}</div>
  </section>
</template>

<style scoped>
.panel { background: #fffdf6; border: 1px solid #e2d8bd; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
h3 { margin: 0 0 8px; font-size: 14px; color: #5a4f38; }
.row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
label { font-size: 12px; color: #7a6c50; }
input, select { font-size: 13px; padding: 4px 6px; border: 1px solid #d5c9a8; border-radius: 4px; background: #fff; margin-bottom: 6px; }
input { width: 100%; box-sizing: border-box; }
input.narrow { width: 90px; }
select { flex: 1; }
.arrow { color: #8a7a55; }
button {
  font-size: 13px; padding: 5px 12px; border-radius: 5px; cursor: pointer;
  border: 1px solid #8a7a55; background: #efe6cc; color: #4a4030;
}
button:hover { background: #e4d6b2; }
button.danger { border-color: #b0483a; background: #f6e0dc; color: #8a2a20; margin-top: 6px; }
.error { color: #a03024; font-size: 12px; margin-top: 8px; }
.ok { color: #3f6a34; font-size: 12px; margin-top: 8px; }
.cycle-path {
  font-family: ui-monospace, monospace; font-size: 12px; margin-top: 4px;
  background: #fbeee6; border: 1px solid #e0b8a8; border-radius: 4px; padding: 4px 6px;
}
.tip { font-size: 11px; color: #8a7a55; margin-top: 4px; }
</style>

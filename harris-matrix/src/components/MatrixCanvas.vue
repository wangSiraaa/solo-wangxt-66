<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import cytoscape from 'cytoscape'
import { state, savePosition, locusLabel } from '../store'
import {
  buildGraph,
  layeredPositions,
  transitiveEdgeKeys,
} from '../graph/stratigraphy'

const props = defineProps<{ mode: 'raw' | 'simplified' }>()

const el = ref<HTMLDivElement>()
let cy: cytoscape.Core | null = null

function render() {
  if (!cy || !state.loaded) return
  const g = buildGraph(state.relations)
  const ids = state.loci.map((l) => l.id)
  const layered = layeredPositions(g, ids)
  const posOf = (id: string) => {
    const stored = state.positions.find((p) => p.id === id)
    if (stored) return { x: stored.x, y: stored.y }
    const p = layered.get(id) ?? { x: 0, y: 0 }
    void savePosition(id, p.x, p.y) // 首次布局后落库，之后位置与身份一样稳定
    return p
  }

  const hidden =
    props.mode === 'simplified' ? transitiveEdgeKeys(g) : new Set<string>()

  // 探方配色（编号体系独立 → 用颜色区分身份来源）
  const palette = ['#8a7a55', '#4a6a8a', '#7a4a6a', '#4a7a5a', '#8a5a2a']
  const trenches = [...new Set(state.loci.map((l) => l.trench))].sort()
  const tcolor = (t: string) => palette[trenches.indexOf(t) % palette.length]

  const elements: cytoscape.ElementDefinition[] = []

  for (const locus of state.loci) {
    const degree = g.hasNode(locus.id) ? g.degree(locus.id) : 0
    elements.push({
      data: {
        id: locus.id,
        label: `${locus.trench}·${locus.code} ${locus.label}`,
        tcolor: tcolor(locus.trench),
      },
      position: posOf(locus.id),
      classes: [`k-${locus.kind}`, degree === 0 ? 'isolated' : ''].join(' '),
    })
  }

  for (const r of state.relations) {
    if (r.status !== 'active') continue
    if (r.kind === 'association') {
      // 同期关联：仅原始视图以无向虚线呈现，永不作为有向边
      if (props.mode === 'raw') {
        elements.push({
          data: { id: r.id, source: r.from, target: r.to, label: '同期' },
          classes: 'association',
        })
      }
      continue
    }
    if (hidden.has(`${r.from}→${r.to}`)) continue // 简化视图只隐藏传递边
    elements.push({
      data: {
        id: r.id,
        source: r.from,
        target: r.to,
        label: r.layer === 'inference' ? '推断' : '',
      },
      classes: r.layer === 'inference' ? 'inference' : 'observation',
    })
  }

  cy.elements().remove()
  cy.add(elements)
  cy.layout({ name: 'preset' }).run()
  cy.fit(undefined, 40)
}

/** 成环路径高亮：节点与路径上的边一起标红。 */
function highlightCycle(ids: string[]) {
  if (!cy) return
  cy.elements().removeClass('cycle')
  for (let i = 0; i < ids.length; i++) {
    cy.getElementById(ids[i]).addClass('cycle')
    const next = ids[(i + 1) % ids.length]
    if (i < ids.length - 1 || ids.length > 2) {
      cy.edges().forEach((e) => {
        if (e.source().id() === ids[i] && e.target().id() === next)
          e.addClass('cycle')
      })
    }
  }
  // 复合 id（含冒号）不走选择器，直接按 id 取元素拼集合
  let col = cy.collection()
  for (const id of ids) col = col.union(cy.getElementById(id))
  if (col.length) cy.fit(col, 60)
}

defineExpose({ highlightCycle })

onMounted(() => {
  cy = cytoscape({
    container: el.value!,
    wheelSensitivity: 0.2,
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'font-size': 11,
          'text-valign': 'bottom',
          'text-margin-y': 6,
          color: '#3a3126',
          'background-color': '#d8c9a3',
          'border-width': 2,
          'border-color': 'data(tcolor)',
          width: 34,
          height: 34,
        },
      },
      { selector: '.k-cut', style: { shape: 'diamond', 'background-color': '#e0a458', 'border-color': '#a05a1e' } },
      { selector: '.k-fill', style: { shape: 'round-rectangle', 'background-color': '#c9d4a8' } },
      { selector: '.k-interface', style: { shape: 'barrel', 'background-color': '#b8c7d8' } },
      { selector: '.isolated', style: { 'border-style': 'dashed', 'border-color': '#b0483a', 'border-width': 3 } },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': '#7a6c50',
          'target-arrow-color': '#7a6c50',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: 'data(label)',
          'font-size': 9,
          color: '#9a8a68',
        },
      },
      { selector: '.inference', style: { 'line-style': 'dashed', 'line-color': '#5a7a9a', 'target-arrow-color': '#5a7a9a' } },
      {
        selector: '.association',
        style: {
          'line-style': 'dotted',
          'line-color': '#8a6a9a',
          'target-arrow-shape': 'none',
          'curve-style': 'unbundled-bezier',
          'control-point-distances': [40],
          'control-point-weights': [0.5],
        },
      },
      { selector: '.cycle', style: { 'line-color': '#c03028', 'target-arrow-color': '#c03028', 'border-color': '#c03028', 'border-width': 4, width: 4 } },
    ],
  })
  cy.on('dragfree', 'node', (evt) => {
    const n = evt.target
    void savePosition(n.id(), n.position('x'), n.position('y'))
  })
  render()
})

watch(
  [() => state.relations, () => state.loci, () => state.loaded, () => props.mode],
  render,
  { deep: true },
)
</script>

<template>
  <div class="canvas-wrap">
    <div ref="el" class="canvas"></div>
    <div class="legend">
      <span><i class="sw obs"></i>观察（有向：晚→早）</span>
      <span><i class="sw inf"></i>推断</span>
      <span v-if="mode === 'raw'"><i class="sw assoc"></i>同期关联（非有向边）</span>
      <span><i class="sw iso"></i>孤立层位</span>
      <span v-if="mode === 'simplified'" class="hint">简化视图：传递边已隐藏，原证据未动</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap { position: relative; height: 100%; display: flex; flex-direction: column; }
.canvas { flex: 1; background: #f7f2e7; border-radius: 8px; border: 1px solid #ddd2b8; }
.legend {
  display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
  padding: 6px 4px 0; font-size: 12px; color: #6a5f48;
}
.sw { display: inline-block; width: 18px; height: 0; border-top: 3px solid #7a6c50; vertical-align: middle; margin-right: 4px; }
.sw.inf { border-top-style: dashed; border-color: #5a7a9a; }
.sw.assoc { border-top-style: dotted; border-color: #8a6a9a; }
.sw.iso { border-top: 3px dashed #b0483a; }
.hint { margin-left: auto; color: #8a6a2a; }
</style>

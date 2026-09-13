import 'fake-indexeddb/auto'
import { db } from '../src/db'
import {
  addDatingEvidence,
  addHypothesisLink,
  clearAll,
  createHypothesis,
  deleteHypothesis,
  linksOfHypothesis,
  reload,
  state,
  undoLastBatch,
} from '../src/store'
import { loadSample } from '../src/sample'
import { evaluateChronology } from '../src/graph/dating'
import { exportProject, importProject } from '../src/io'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const evalOf = (hypothesisId: string | null) =>
  evaluateChronology({
    relations: state.relations,
    loci: state.loci,
    dating: state.dating,
    links: hypothesisId ? linksOfHypothesis(hypothesisId) : [],
  })

async function main() {
  console.log('1. 载入示例工程')
  await clearAll()
  await loadSample()
  check('双探方层位', state.loci.length === 18, `实际 ${state.loci.length}`)
  check('同号不同层位：两个 105 身份独立', (() => {
    const same = state.loci.filter((l) => l.code === '105')
    return same.length === 2 && same[0].id !== same[1].id
  })())
  check('测年 4 条、假设 2 个、关联项 4 条',
    state.dating.length === 4 && state.hypotheses.length === 2 &&
    state.hypothesisLinks.length === 4)
  const relationCount = state.relations.length

  console.log('2. 后来补入的新测年证据')
  const h1 = state.hypotheses.find((h) => h.name.startsWith('甲'))!
  const before = evalOf(h1.id)
  check('补入前甲方案自洽', before.ok)
  await addDatingEvidence({
    locusId: 'TG1:106', bpEarly: 2900, bpLate: null, source: 'BETA-5600', note: '补测',
  })
  check('测年变为 5 条', state.dating.length === 5)
  const after = evalOf(h1.id)
  check('新证据自动参与传播并暴露矛盾',
    after.contradictions.some((c) => c.type === 'interval'))
  await undoLastBatch()
  check('撤销补入后回到 4 条', state.dating.length === 4)
  check('撤销后甲方案恢复自洽', evalOf(h1.id).ok)

  console.log('3. 假设删除不污染底稿，证据不被复制')
  const h = await createHypothesis('丙方案：测试用')
  await addHypothesisLink(h!.id, ['TG1:102', 'TG2:102'], '测试关联')
  check('假设与关联项已建', state.hypotheses.length === 3 &&
    linksOfHypothesis(h!.id).length === 1)
  await deleteHypothesis(h!.id)
  check('删除后假设消失', state.hypotheses.length === 2 &&
    linksOfHypothesis(h!.id).length === 0)
  check('底稿关系未变', state.relations.length === relationCount)
  check('测年证据未受影响', state.dating.length === 4)
  check('关联项只存层位 id 引用（无证据副本）',
    state.hypothesisLinks.every((l) =>
      l.members.every((m) => typeof m === 'string')) &&
    (await db.dating.count()) === 4)
  await undoLastBatch()
  check('撤销删除：假设与关联项一起恢复',
    state.hypotheses.length === 3 && linksOfHypothesis(h!.id).length === 1)
  await undoLastBatch() // 撤销 addLink
  await undoLastBatch() // 撤销 createHypothesis
  check('继续撤销可整体回退', state.hypotheses.length === 2)

  console.log('4. 导出再导入偏序不变')
  const json = await exportProject()
  await clearAll()
  check('清空后为空', state.loci.length === 0)
  const res = await importProject(json)
  check('导入成功', res.ok)
  check('偏序校验通过', res.orderPreserved === true)
  check('层位/关系/测年/假设全数恢复',
    state.loci.length === 18 && state.relations.length === relationCount &&
    state.dating.length === 4 && state.hypotheses.length === 2)
  check('导入后甲方案评估结论一致（自洽）', (() => {
    const h1again = state.hypotheses.find((x) => x.name.startsWith('甲'))!
    return evalOf(h1again.id).ok
  })())

  console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

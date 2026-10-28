import assert from 'node:assert/strict'
import test from 'node:test'
import { MODELS, ROUTE, ROUTE_LABEL, catalogRows, parseModelId, resolveModelInfo } from '../src/catalog.js'

test('catalog mirrors the SiliconFlow provider models', () => {
  assert.equal(ROUTE, 'siliconflow-pool')
  assert.equal(ROUTE_LABEL, 'SiliconFlow · Key Pool')
  assert.deepEqual(MODELS.map(model => model.id), [
    'deepseek-ai/DeepSeek-V4.1-Flash',
    'deepseek-ai/DeepSeek-V4-Flash',
  ])
})

test('the picker never expands key aliases into model rows', () => {
  const rows = catalogRows(ROUTE)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(row => row.id), [
    'deepseek-ai/DeepSeek-V4.1-Flash',
    'deepseek-ai/DeepSeek-V4-Flash',
  ])
  assert.equal(rows.some(row => row.id.includes('@') || row.name.includes('key k')), false)
})

test('model ids with slashes still parse the trailing key alias', () => {
  assert.deepEqual(parseModelId('deepseek-ai/DeepSeek-V4.1-Flash@k2'), {
    modelId: 'deepseek-ai/DeepSeek-V4.1-Flash',
    alias: 'k2',
  })
  const info = resolveModelInfo(ROUTE, 'deepseek-ai/DeepSeek-V4.1-Flash')
  assert.equal(info.context.contextWindow, 1048576)
  assert.equal(info.defaultMaxTokens, 384000)
})

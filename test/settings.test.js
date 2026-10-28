import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadSettings } from '../src/settings.js'

function tempSettings(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siliconflow-settings-'))
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, JSON.stringify(contents, null, 2))
  return file
}

test('settings.json is the only key source', () => {
  const settings = loadSettings({
    path: '/nonexistent/settings.json',
    env: {
      SILICONFLOW_API_KEY: 'sk-env',
      SILICONFLOW_KEYS: 'sk-env-1,sk-env-2',
      SILICONFLOW_KEY_REFS: 'SILICONFLOW_API_KEY',
    },
  })
  assert.deepEqual(settings.keys, [])
  assert.equal(settings.keyRefs, undefined)
})

test('keys in settings.json are normalized and masked', () => {
  const file = tempSettings({
    baseURL: 'https://example.test/v1',
    keys: [{ alias: 'work', key: 'sk-work' }, { alias: 'k2', key: 'sk-two' }],
  })
  const settings = loadSettings({ path: file, env: {} })
  assert.deepEqual(settings.keys.map(entry => entry.alias), ['work', 'k2'])
  assert.equal(settings.keys[0].masked, 'sk…rk')
  assert.equal(settings.keys[0].masked.includes('sk-work'), false)
})

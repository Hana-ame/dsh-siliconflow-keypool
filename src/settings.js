/**
 * Settings loader for the SiliconFlow key-pool plugin.
 *
 * Precedence, lowest to highest:
 *   1. built-in defaults
 *   2. `settings.json` next to the plugin (or `$DSH_SILICONFLOW_KEYPOOL_SETTINGS`)
 *   3. environment overrides
 *
 * Keys never appear in a log. The normalized pool retains aliases (`k1`, ...)
 * and secret values; callers use `maskKey()` before printing.
 *
 * @module src/settings
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isKeyAlias, maskKey } from './catalog.js'

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.join(PKG_DIR, '..')

/** Default settings path. */
export const SETTINGS_PATH = path.join(PLUGIN_DIR, 'settings.json')

/** Built-in defaults. */
export const DEFAULTS = Object.freeze({
  baseURL: 'https://api.siliconflow.cn/v1',
  chatPath: '/chat/completions',
  mode: 'auto',
  defaultKey: 'k1',
  keys: [],
  timeoutMs: 120_000,
  maxRetries: 3_000,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 6_000,
  retryableCodes: Object.freeze(['RATE_LIMIT', 'TIMEOUT', 'SERVER', 'TRANSPORT']),
  maxRequestImageBytes: 20_971_520,
  defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash',
  models: Object.freeze([
    Object.freeze({
      id: 'deepseek-ai/DeepSeek-V4.1-Flash',
      name: 'DeepSeek V4.1 Flash (SiliconFlow)',
      description: 'DeepSeek V4.1 Flash served by SiliconFlow',
      contextWindow: 1_048_576,
      maxOutput: 384_000,
      reasoning: false,
      inputModalities: Object.freeze(['text']),
    }),
    Object.freeze({
      id: 'deepseek-ai/DeepSeek-V4-Flash',
      name: 'DeepSeek V4 Flash (SiliconFlow)',
      description: 'DeepSeek V4 Flash served by SiliconFlow',
      contextWindow: 1_048_576,
      maxOutput: 384_000,
      reasoning: false,
      inputModalities: Object.freeze(['text']),
    }),
  ]),
  statePath: path.join(os.homedir(), '.dsh', 'siliconflow-keypool-state.json'),
  gateway: {
    enabled: true,
    path: '/api/siliconflow-keypool/v1',
    token: '',
  },
})

/**
 * Normalize one key entry. Accepts:
 *   "sk-..."                         → positional alias
 *   { "alias": "work", "key": "..." } → explicit alias
 *
 * @param {unknown} entry
 * @param {number} index
 * @returns {{alias: string, key: string, masked: string, enabled: boolean} | null}
 */
export function normalizeKeyEntry(entry, index) {
  let alias = ''
  let key = ''
  let enabled = true
  if (typeof entry === 'string') {
    key = entry.trim()
  } else if (entry !== null && typeof entry === 'object') {
    alias = String(entry.alias ?? '').trim()
    key = String(entry.key ?? entry.token ?? entry.value ?? '').trim()
    enabled = entry.enabled !== false
  }
  if (key === '') return null
  if (alias === '') alias = `k${index + 1}`
  if (!isKeyAlias(alias)) return null
  return { alias, key, masked: maskKey(key), enabled }
}

/**
 * Normalize the key list, preserving order and dropping duplicate aliases as
 * well as duplicate secret values.
 *
 * @param {unknown} entries
 * @returns {Array<{alias: string, key: string, masked: string, enabled: boolean}>}
 */
export function normalizeKeys(entries) {
  if (!Array.isArray(entries)) return []
  const seenAliases = new Set()
  const seenKeys = new Set()
  const result = []
  for (let i = 0; i < entries.length; i += 1) {
    const normalized = normalizeKeyEntry(entries[i], i)
    if (normalized === null) continue
    if (seenAliases.has(normalized.alias) || seenKeys.has(normalized.key)) continue
    seenAliases.add(normalized.alias)
    seenKeys.add(normalized.key)
    result.push(normalized)
  }
  return result
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * Normalize the retry scope: a list of harness failure codes. Accepts an array
 * or a comma-separated string; trims, upper-cases and de-duplicates entries.
 * An empty result falls back to the built-in list so a typo cannot silently
 * turn retries off.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeRetryableCodes(value) {
  const input = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const codes = []
  for (const entry of input) {
    const code = String(entry ?? '').trim().toUpperCase()
    if (code === '' || codes.includes(code)) continue
    codes.push(code)
  }
  return codes.length > 0 ? codes : [...DEFAULTS.retryableCodes]
}

/**
 * Normalize the editable model catalog. Deduplicated ids, positive context
 * and output ceilings, and a modality list that always contains `text` and
 * optionally `image`. Invalid/empty input falls back to the built-in list.
 *
 * @param {unknown} value
 * @returns {Array<{id: string, name: string, description: string, contextWindow: number, maxOutput: number, reasoning: boolean, inputModalities: string[]}>}
 */
export function normalizeModels(value) {
  if (!Array.isArray(value)) return [...DEFAULTS.models]
  const result = []
  const seen = new Set()
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const id = String(entry.id ?? '').trim()
    if (id === '' || seen.has(id)) continue
    const contextWindow = Number(entry.contextWindow)
    const maxOutput = Number(entry.maxOutput)
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 1) continue
    if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) continue
    const modal = Array.isArray(entry.inputModalities) ? entry.inputModalities : []
    const inputModalities = ['text']
    if (modal.includes('image')) inputModalities.push('image')
    seen.add(id)
    result.push({
      id,
      name: String(entry.name ?? id),
      description: String(entry.description ?? ''),
      contextWindow,
      maxOutput,
      reasoning: entry.reasoning !== false,
      inputModalities,
    })
  }
  return result.length > 0 ? result : [...DEFAULTS.models]
}

function normalizePath(value, fallback) {
  const text = String(value ?? '').trim()
  if (text === '') return fallback
  return text.startsWith('/') ? text : `/${text}`
}

/**
 * Load settings merged over defaults with environment overrides.
 *
 * @param {{ path?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {object}
 */
export function loadSettings(options = {}) {
  const env = options.env ?? process.env
  const settingsPath =
    options.path ||
    env.DSH_SILICONFLOW_KEYPOOL_SETTINGS ||
    SETTINGS_PATH

  let file = {}
  let fileProblem = ''
  try {
    if (fs.existsSync(settingsPath)) {
      const text = fs.readFileSync(settingsPath, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) file = parsed
      else fileProblem = 'settings.json must contain a JSON object'
    }
  } catch (error) {
    fileProblem = `settings.json is unreadable or invalid JSON: ${error?.message ?? error}`
  }

  const settings = {
    ...DEFAULTS,
    ...file,
    gateway: { ...DEFAULTS.gateway, ...(file.gateway ?? {}) },
    settingsPath,
    fileProblem,
  }

  // Environment overrides.
  if (env.SILICONFLOW_BASE_URL) settings.baseURL = env.SILICONFLOW_BASE_URL
  if (env.SILICONFLOW_CHAT_PATH) settings.chatPath = env.SILICONFLOW_CHAT_PATH
  if (env.SILICONFLOW_TIMEOUT) settings.timeoutMs = positiveNumber(env.SILICONFLOW_TIMEOUT, settings.timeoutMs)
  if (env.SILICONFLOW_MAX_RETRIES !== undefined) {
    const value = Number(env.SILICONFLOW_MAX_RETRIES)
    if (Number.isInteger(value) && value >= 0) settings.maxRetries = value
  }
  if (env.SILICONFLOW_RETRY_CODES !== undefined) settings.retryableCodes = env.SILICONFLOW_RETRY_CODES
  if (env.SILICONFLOW_STATE_PATH) settings.statePath = env.SILICONFLOW_STATE_PATH
  if (env.SILICONFLOW_GATEWAY_PATH) settings.gateway.path = env.SILICONFLOW_GATEWAY_PATH
  if (env.SILICONFLOW_GATEWAY_TOKEN) settings.gateway.token = env.SILICONFLOW_GATEWAY_TOKEN
  if (env.SILICONFLOW_GATEWAY_ENABLED !== undefined) {
    settings.gateway.enabled = env.SILICONFLOW_GATEWAY_ENABLED === '1' || env.SILICONFLOW_GATEWAY_ENABLED === 'true'
  }

  settings.baseURL = String(settings.baseURL ?? DEFAULTS.baseURL).trim().replace(/\/+$/, '')
  settings.chatPath = normalizePath(settings.chatPath, DEFAULTS.chatPath)
  settings.mode = settings.mode === 'manual' ? 'manual' : 'auto'
  settings.defaultModel = String(settings.defaultModel ?? DEFAULTS.defaultModel)
  settings.defaultKey = String(settings.defaultKey ?? DEFAULTS.defaultKey)
  settings.statePath = String(settings.statePath ?? DEFAULTS.statePath)
  settings.timeoutMs = positiveNumber(settings.timeoutMs, DEFAULTS.timeoutMs)
  settings.maxRetries = Number.isInteger(settings.maxRetries) && settings.maxRetries >= 0
    ? settings.maxRetries
    : DEFAULTS.maxRetries
  settings.retryBaseDelayMs = positiveNumber(settings.retryBaseDelayMs, DEFAULTS.retryBaseDelayMs)
  settings.retryMaxDelayMs = positiveNumber(settings.retryMaxDelayMs, DEFAULTS.retryMaxDelayMs)
  if (settings.retryMaxDelayMs < settings.retryBaseDelayMs) {
    settings.retryMaxDelayMs = settings.retryBaseDelayMs
  }
  settings.retryableCodes = normalizeRetryableCodes(settings.retryableCodes)
  settings.maxRequestImageBytes = positiveNumber(settings.maxRequestImageBytes, DEFAULTS.maxRequestImageBytes)
  settings.models = normalizeModels(settings.models)
  settings.keys = normalizeKeys(settings.keys)
  settings.gateway.path = normalizePath(settings.gateway.path, DEFAULTS.gateway.path).replace(/\/+$/, '')
  settings.gateway.token = String(settings.gateway.token ?? '')
  settings.gateway.enabled = settings.gateway.enabled !== false

  const enabledKeys = settings.keys.filter(entry => entry.enabled !== false)
  if (enabledKeys.length > 0 && !enabledKeys.some(entry => entry.alias === settings.defaultKey)) {
    settings.defaultKey = enabledKeys[0].alias
  }

  return settings
}

/**
 * Return human-readable configuration problems.
 *
 * @param {object} settings
 * @returns {string[]}
 */
export function validateSettings(settings) {
  const problems = []
  if (!settings.baseURL) problems.push('baseURL is empty')
  if (settings.keys.length === 0) problems.push('no API keys configured')
  const enabledKeys = settings.keys.filter(entry => entry.enabled !== false)
  if (settings.keys.length > 0 && enabledKeys.length === 0) problems.push('all API keys are disabled')
  if (settings.mode === 'manual' && !enabledKeys.some(entry => entry.alias === settings.defaultKey)) {
    problems.push(`manual mode defaultKey "${settings.defaultKey}" is not in the pool`)
  }
  if (settings.fileProblem) problems.push(settings.fileProblem)
  return problems
}

/**
 * A settings source that re-reads the file when its mtime changes. This keeps
 * key/alias edits live without a restart while avoiding a stat+read on every
 * request in the common case.
 *
 * @param {{ path?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ current: () => object, reload: () => object }}
 */
export function createSettingsSource(options = {}) {
  let cached = loadSettings(options)
  let mtimeMs = -1
  try {
    mtimeMs = fs.statSync(cached.settingsPath).mtimeMs
  } catch {
    mtimeMs = -1
  }

  function current() {
    try {
      const stat = fs.statSync(cached.settingsPath)
      if (stat.mtimeMs !== mtimeMs) {
        mtimeMs = stat.mtimeMs
        cached = loadSettings(options)
      }
    } catch {
      // A removed settings file keeps the last good snapshot.
    }
    return cached
  }

  return {
    current,
    reload: () => {
      cached = loadSettings(options)
      try {
        mtimeMs = fs.statSync(cached.settingsPath).mtimeMs
      } catch {
        mtimeMs = -1
      }
      return cached
    },
  }
}

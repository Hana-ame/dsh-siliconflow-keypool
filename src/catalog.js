/**
 * Static SiliconFlow model catalog and the key-alias grammar.
 *
 * SiliconFlow's gateway speaks OpenAI Chat Completions. Model ids below match
 * the ids the existing `siliconflow` provider in this profile advertises, so a
 * session can switch between the single-key route and this pooled route
 * without changing anything else.
 *
 * The `@k<N>` suffix is the manual key selector:
 *   deepseek-ai/DeepSeek-V4.1-Flash@k2 → model ..., key k2
 *   deepseek-ai/DeepSeek-V4.1-Flash    → model ..., session key
 *
 * @module src/catalog
 */

/** Provider route published by this plugin. */
export const ROUTE = 'siliconflow-pool'

/** Display label used by the model picker. */
export const ROUTE_LABEL = 'SiliconFlow · Key Pool'

/** Default model when a caller omits one. */
export const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash'

/** Default context window for an unknown model id. */
export const DEFAULT_CONTEXT_WINDOW = 1_048_576

/** Default output ceiling for an unknown model id. */
export const DEFAULT_MAX_OUTPUT = 384_000

/**
 * Models advertised by the route. Values mirror the `siliconflow` provider in
 * this profile (cordis.patch.yml at 2026-10-27), except that image input is
 * not advertised: this adapter sends text only until an attachment resolver
 * is wired in.
 */
export const MODELS = Object.freeze([
  Object.freeze({
    id: 'deepseek-ai/DeepSeek-V4.1-Flash',
    name: 'DeepSeek V4.1 Flash (SiliconFlow)',
    description: 'DeepSeek V4.1 Flash served by SiliconFlow',
    contextWindow: 1_048_576,
    maxOutput: 384_000,
    reasoning: false,
  }),
  Object.freeze({
    id: 'deepseek-ai/DeepSeek-V4-Flash',
    name: 'DeepSeek V4 Flash (SiliconFlow)',
    description: 'DeepSeek V4 Flash served by SiliconFlow',
    contextWindow: 1_048_576,
    maxOutput: 384_000,
    reasoning: false,
  }),
])

/** Look up a catalog row by base model id. */
export function findModel(id, models = MODELS) {
  return models.find(row => row.id === id) ?? null
}

/**
 * Split a model id into its base id and optional key alias.
 *
 * The alias is everything after the last `@`. Empty or absent means "no
 * explicit key": the session's assigned key is used.
 *
 * @param {string} model
 * @returns {{modelId: string, alias: string | null}}
 */
export function parseModelId(model) {
  const text = String(model ?? '')
  const at = text.lastIndexOf('@')
  if (at < 0) return { modelId: text, alias: null }
  const modelId = text.slice(0, at)
  const alias = text.slice(at + 1)
  return { modelId, alias: alias === '' ? null : alias }
}

/** Whether a string looks like a key alias (`k1`, `work`, ...). */
export function isKeyAlias(value) {
  const text = String(value ?? '').trim()
  // Aliases are user-facing names (often Chinese, e.g. 主号/备用). Keep them
  // permissive: non-empty, <=64 chars, no `@` (the model-id key suffix
  // separator) and no control characters.
  return text.length > 0 && text.length <= 64 && !text.includes('@') && !/[\r\n\t]/.test(text)
}

/** Mask a secret for logs/status: first 4 and last 4 characters. */
export function maskKey(key) {
  const text = String(key ?? '')
  if (text === '') return '(empty)'
  if (text.length <= 10) return `${text.slice(0, 2)}…${text.slice(-2)}`
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

/**
 * Build the picker catalog.
 *
 * Every model appears once. Key aliases are deliberately not expanded into
 * `model · key k2` rows: keys are managed on the Settings page and selected by
 * the session store, not by the model picker.
 *
 * @param {string} provider
 * @param {readonly object[]} [models] - effective settings.models list
 * @returns {object[]}
 */
export function catalogRows(provider, models = MODELS) {
  return models.map(model => ({
    provider,
    id: model.id,
    name: model.name,
    description: model.description,
    inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : ['text'],
  }))
}

/**
 * Resolve exact model metadata for one model id (alias included).
 *
 * Unknown ids still return a usable shape: the harness accepts unlisted model
 * ids and a user may know a newer SiliconFlow id before this catalog does.
 *
 * @param {string} provider
 * @param {string} model
 * @param {readonly object[]} [models] - effective settings.models list
 * @returns {object}
 */
export function resolveModelInfo(provider, model, models = MODELS) {
  const { modelId, alias } = parseModelId(model)
  const known = findModel(modelId, models)
  const base = known ?? {
    id: modelId,
    name: modelId,
    description: 'unlisted SiliconFlow model id',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutput: DEFAULT_MAX_OUTPUT,
    reasoning: false,
  }
  return {
    provider,
    id: model,
    name: alias === null ? base.name : `${base.name} · key ${alias}`,
    description: base.description,
    inputModalities: Array.isArray(base.inputModalities) ? base.inputModalities : ['text'],
    context: { contextWindow: base.contextWindow },
    defaultMaxTokens: base.maxOutput,
  }
}

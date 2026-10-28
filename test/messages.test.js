import test from 'node:test'
import assert from 'node:assert/strict'
import { toChatRequest } from '../src/messages.js'

test('projects system, user, reasoning, tool calls and tool results', async () => {
  const { body, modelId, alias } = await toChatRequest({
    provider: 'siliconflow-pool',
    model: 'deepseek-ai/DeepSeek-V4.1-Flash@k2',
    system: 'global system',
    maxTokens: 512,
    temperature: 0.2,
    stop: ['END'],
    reasoningEffort: 'high',
    tools: [
      {
        name: 'read_file',
        description: 'read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ],
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'session system' }] },
      { role: 'developer', content: [{ type: 'tool-removal', toolName: 'old' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image', attachment: {} }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: 'call_1', name: 'read_file', arguments: '{"path":"a"}' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'file body' }] },
    ],
  })

  assert.equal(modelId, 'deepseek-ai/DeepSeek-V4.1-Flash')
  assert.equal(alias, 'k2')
  assert.equal(body.model, 'deepseek-ai/DeepSeek-V4.1-Flash')
  assert.equal(body.stream, true)
  assert.equal(body.max_tokens, 512)
  assert.equal(body.temperature, 0.2)
  assert.deepEqual(body.stop, ['END'])
  assert.equal(body.reasoning_effort, 'high')
  assert.equal(body.tools[0].function.name, 'read_file')

  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[0].content, /global system/)
  assert.match(body.messages[0].content, /session system/)
  assert.equal(body.messages[1].role, 'user')
  assert.match(body.messages[1].content, /hello/)
  assert.match(body.messages[1].content, /image omitted/)
  assert.equal(body.messages[2].role, 'assistant')
  assert.equal(body.messages[2].reasoning_content, 'think')
  assert.equal(body.messages[2].content, 'calling')
  assert.equal(body.messages[2].tool_calls[0].id, 'call_1')
  assert.equal(body.messages[3].role, 'tool')
  assert.equal(body.messages[3].tool_call_id, 'call_1')
  assert.equal(body.messages[3].content, 'file body')
})

test('assistant tool call without text sends null content', async () => {
  const { body } = await toChatRequest({
    model: 'deepseek-ai/DeepSeek-V4.1-Flash',
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c', name: 'x', arguments: '{}' }],
      },
    ],
  })
  assert.equal(body.messages[0].content, null)
  assert.equal(body.messages[0].tool_calls.length, 1)
})

test('unknown model ids are passed through unchanged', async () => {
  const { body, modelId } = await toChatRequest({
    model: 'some-new-model',
    messages: [{ role: 'user', content: 'x' }],
  })
  assert.equal(modelId, 'some-new-model')
  assert.equal(body.model, 'some-new-model')
})

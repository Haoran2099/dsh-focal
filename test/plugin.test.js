import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, inject, name } from '../index.js'

function mockContext() {
  const registrations = { sections: [], contexts: [], tools: [], commands: [], listeners: new Map(), effects: [] }
  const prompt = {
    section(value) { registrations.sections.push(value); return () => {} },
    context(value) { registrations.contexts.push(value); return () => {} },
  }
  const ctx = {
    agents: { list: () => [] },
    commands: { register: value => { registrations.commands.push(value); return () => {} } },
    systemPrompt: prompt,
    tools: { register: value => { registrations.tools.push(value); return () => {} } },
    on(event, handler) { registrations.listeners.set(event, handler); return () => {} },
    effect(factory) { registrations.effects.push(factory); return () => {} },
  }
  return { ctx, prompt, registrations }
}

test('exports one installable host plugin', () => {
  assert.equal(name, 'dsh-focal')
  assert.deepEqual(inject, ['agents', 'commands', 'systemPrompt', 'tools'])
})

test('registers policy, lifecycle listeners, commands and model tools', () => {
  const { ctx, registrations } = mockContext()
  apply(ctx, { dshHome: '/tmp/dsh-focal-plugin-test' })
  assert.equal(registrations.sections.length, 1)
  assert.deepEqual(registrations.tools.map(tool => tool.name).sort(), ['focal_recall', 'focal_status'])
  assert.deepEqual(registrations.commands.map(command => command.name), ['focal'])
  assert.ok(registrations.listeners.has('session/event'))
  assert.ok(registrations.listeners.has('agent/created'))
})

test('publishes closed tool schemas and rejects invalid recall arguments', () => {
  const { ctx, registrations } = mockContext()
  apply(ctx, { dshHome: '/tmp/dsh-focal-plugin-schema-test' })
  const recall = registrations.tools.find(tool => tool.name === 'focal_recall')
  assert.equal(recall.parameters.additionalProperties, false)
  assert.equal(recall.parameters.properties.max_tasks.type, 'integer')
  assert.throws(
    () => recall.execute({ max_tasks: 0 }, { agent: { session: { id: 'schema-test', events: [] } } }),
    /between 1 and 5/,
  )
})

test('desktop observation and model sharing are independent explicit opt-ins', async () => {
  const localOnly = mockContext()
  apply(localOnly.ctx, {
    dshHome: '/tmp/dsh-focal-local-desktop-test',
    observeDesktop: true,
  })
  assert.deepEqual(localOnly.registrations.tools.map(tool => tool.name).sort(), ['focal_recall', 'focal_status'])

  const shared = mockContext()
  apply(shared.ctx, {
    dshHome: '/tmp/dsh-focal-shared-desktop-test',
    observeDesktop: true,
    shareDesktopMetadataWithModel: true,
  })
  assert.deepEqual(shared.registrations.tools.map(tool => tool.name).sort(), [
    'focal_desktop_recall', 'focal_recall', 'focal_status',
  ])
  const desktop = shared.registrations.tools.find(tool => tool.name === 'focal_desktop_recall')
  const result = await desktop.execute({ limit: 5 })
  assert.deepEqual(result.observations, [])
  assert.equal(JSON.stringify(result).includes('screenshot'), false)
  assert.equal(shared.registrations.tools.some(tool => /image|screenshot/i.test(tool.name)), false)
})

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
    effect(factory) { registrations.effects.push(factory()); return () => {} },
  }
  return { ctx, prompt, registrations }
}

test('exports one installable host plugin', () => {
  assert.equal(name, 'focal-dsh')
  assert.deepEqual(inject, ['agents', 'commands', 'systemPrompt', 'tools'])
})

test('registers policy, lifecycle listeners, commands and model tools', () => {
  const { ctx, registrations } = mockContext()
  apply(ctx, { dshHome: '/tmp/focal-dsh-plugin-test' })
  assert.equal(registrations.sections.length, 1)
  assert.deepEqual(registrations.tools.map(tool => tool.name).sort(), ['focal_recall', 'focal_status'])
  assert.deepEqual(registrations.commands.map(command => command.name), ['focal'])
  assert.ok(registrations.listeners.has('session/event'))
  assert.ok(registrations.listeners.has('agent/created'))
})

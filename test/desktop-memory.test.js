import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DesktopActivityMemory } from '../src/desktop-memory.js'
import { DesktopObservationStore } from '../src/storage.js'

class MemoryStore {
  constructor(value) { this.value = value }
  load() { return this.value }
  queue(value) { this.value = structuredClone(value); return Promise.resolve() }
  close() { return Promise.resolve() }
}

test('bounds desktop observations and keeps visual summaries separately gated', () => {
  const store = new MemoryStore()
  const memory = new DesktopActivityMemory({ maxObservations: 2 }, store)
  memory.record({ id: '1', at: 1, app: 'Editor', durationMs: 0 })
  memory.record({ id: '2', at: 2, app: 'Browser', durationMs: 0 })
  memory.recordVisual({ id: '2', visualSummary: 'A documentation page is visible.', localSnapshotStored: false })
  memory.record({ id: '3', at: 3, app: 'Terminal', durationMs: 0 })
  assert.deepEqual(memory.recall(10).map(item => item.app), ['Browser', 'Terminal'])
  assert.equal(JSON.stringify(memory.recall(10)).includes('documentation'), false)
  assert.equal(memory.recall(10, { includeVisual: true })[0].visualSummary, 'A documentation page is visible.')
  assert.equal(memory.renderContext().includes('local_visual_summary'), false)
  assert.equal(memory.renderContext({ includeVisual: true }).includes('local_visual_summary'), true)
})

test('never returns local screenshot retention metadata or paths', () => {
  const memory = new DesktopActivityMemory({ maxObservations: 10 }, new MemoryStore())
  memory.record({ id: '1', at: 1, app: 'Editor', durationMs: 0 })
  memory.recordVisual({ id: '1', visualSummary: 'Code editor.', localSnapshotStored: true })
  const serialized = JSON.stringify(memory.recall(10, { includeVisual: true }))
  assert.equal(serialized.includes('localSnapshotStored'), false)
  assert.equal(serialized.includes('.png'), false)
})

test('persists desktop memory atomically with owner-only permissions', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-focal-desktop-store-'))
  const root = join(parent, 'state')
  const store = new DesktopObservationStore(root)
  await store.queue({ version: 1, updatedAt: 10, observations: [] })
  await store.close()
  assert.deepEqual(new DesktopObservationStore(root).load(), {
    version: 1,
    updatedAt: 10,
    observations: [],
  })
  if (process.platform !== 'win32') {
    assert.equal((await stat(root)).mode & 0o777, 0o700)
    assert.equal((await stat(join(root, 'desktop.json'))).mode & 0o777, 0o600)
  }
})

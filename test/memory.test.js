import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FocalMemoryRuntime, extractPathHints, sanitizeText } from '../src/memory.js'
import { LocalMemoryStore } from '../src/storage.js'

function session(id = 'session-1', cwd = '/work/project') {
  return { id, header: { cwd }, events: [] }
}

function event(type, seq, data) {
  return { type, seq, time: Date.now(), data }
}

test('redacts common credentials and email addresses', () => {
  const fakeGitHubToken = ['ghp', 'abcdefghijklmnopqrstuvwxyz'].join('_')
  const text = sanitizeText(`email a@b.com token=secret-value ${fakeGitHubToken}`)
  assert.equal(text.includes('a@b.com'), false)
  assert.equal(text.includes('secret-value'), false)
  assert.equal(text.includes('ghp_'), false)
})

test('extracts only path-like arguments and makes them workspace-relative', () => {
  const paths = extractPathHints(JSON.stringify({ path: '/work/project/src/a.js', token: 'do-not-store', nested: { file_path: '/etc/passwd' } }), '/work/project')
  assert.deepEqual(paths, ['src/a.js', '<external>/passwd'])
})

test('keeps task memories isolated and ignores raw tool results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'focal-test-'))
  const store = new LocalMemoryStore(root)
  const runtime = new FocalMemoryRuntime({ maxContextChars: 2000 }, store)
  const current = session()
  runtime.adopt(current)
  runtime.observe(current, event('user/message', 0, {
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Fix authentication tests' }],
  }))
  runtime.observe(current, event('tool/call', 1, {
    callId: 'c1', name: 'read', arguments: JSON.stringify({ path: '/work/project/test/auth.test.js', api_key: 'never-store-me' }),
  }))
  runtime.observe(current, event('tool/result', 2, {
    message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', isError: false, content: [{ type: 'text', text: 'PRIVATE RESULT' }] }] },
  }))
  runtime.observe(current, event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }))
  const first = runtime.status(current).activeTaskId
  runtime.observe(current, event('user/message', 4, {
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Prepare release documentation' }],
  }))
  const status = runtime.status(current)
  assert.equal(status.taskCount, 2)
  assert.notEqual(status.activeTaskId, first)
  const recalled = runtime.recall(current, { taskId: first })
  const serialized = JSON.stringify(recalled)
  assert.match(serialized, /auth\.test\.js/)
  assert.equal(serialized.includes('PRIVATE RESULT'), false)
  assert.equal(serialized.includes('never-store-me'), false)
  await runtime.close()
  const files = await import('node:fs/promises').then(fs => fs.readdir(root))
  assert.equal(files.length, 1)
  const persisted = await readFile(join(root, files[0]), 'utf8')
  assert.equal(persisted.includes('PRIVATE RESULT'), false)
  assert.equal(persisted.includes('/work/project'), false)
  if (process.platform !== 'win32') {
    assert.equal((await stat(root)).mode & 0o777, 0o700)
    assert.equal((await stat(join(root, files[0]))).mode & 0o777, 0o600)
  }
})

test('bounds injected context and supports human deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'focal-test-'))
  const runtime = new FocalMemoryRuntime({ maxContextChars: 180, maxContextObservations: 2 }, new LocalMemoryStore(root))
  const current = session('s2')
  runtime.observe(current, event('user/message', 0, {
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Investigate a very long build failure and prepare a minimal correction' }],
  }))
  const rendered = runtime.renderContext(current)
  assert.ok(rendered.length <= 180)
  assert.match(rendered, /\n/)
  assert.equal(runtime.forget(current, 'all').ok, true)
  assert.equal(runtime.status(current).taskCount, 0)
  await runtime.close()
})

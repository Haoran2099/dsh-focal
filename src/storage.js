import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalizeStoredState } from './memory.js'

function storageName(sessionId, cwd) {
  return `${createHash('sha256').update(`${sessionId}\0${cwd ?? ''}`).digest('hex')}.json`
}

function serializableState(state) {
  return {
    version: 1,
    sessionId: state.sessionId,
    updatedAt: state.updatedAt,
    lastSeq: state.lastSeq,
    nextTaskNumber: state.nextTaskNumber,
    ...(state.activeTaskId ? { activeTaskId: state.activeTaskId } : {}),
    tasks: state.tasks,
  }
}

export class LocalMemoryStore {
  constructor(root, logger = console) {
    this.root = resolve(root)
    this.logger = logger
    this.pending = new Map()
  }

  pathFor(stateOrSession) {
    const sessionId = String(stateOrSession.sessionId ?? stateOrSession.id)
    const cwd = stateOrSession.cwd ?? stateOrSession.header?.cwd
    return join(this.root, storageName(sessionId, cwd))
  }

  load(session) {
    const filename = this.pathFor(session)
    try {
      const raw = JSON.parse(readFileSync(filename, 'utf8'))
      return normalizeStoredState(raw, session)
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger.warn(`dsh-focal: ignoring unreadable memory file ${filename}: ${error.message}`)
      return normalizeStoredState(undefined, session)
    }
  }

  queue(state) {
    const filename = this.pathFor(state)
    const payload = `${JSON.stringify(serializableState(state), null, 2)}\n`
    const previous = this.pending.get(filename) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.#writeAtomic(filename, payload))
    this.pending.set(filename, next)
    next.catch(error => this.logger.warn(`dsh-focal: failed to persist ${filename}: ${error.message}`))
    return next
  }

  async #writeAtomic(filename, payload) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await chmod(this.root, 0o700).catch(() => undefined)
    const temporary = join(this.root, `.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, filename)
  }

  async close() {
    await Promise.allSettled(this.pending.values())
  }
}

export class DesktopObservationStore {
  constructor(root, logger = console) {
    this.root = resolve(root)
    this.filename = join(this.root, 'desktop.json')
    this.logger = logger
    this.pending = Promise.resolve()
  }

  load() {
    try {
      return JSON.parse(readFileSync(this.filename, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(`dsh-focal: ignoring unreadable desktop memory ${this.filename}: ${error.message}`)
      }
      return undefined
    }
  }

  queue(state) {
    const payload = `${JSON.stringify({
      version: 1,
      updatedAt: state.updatedAt,
      observations: state.observations,
    }, null, 2)}\n`
    this.pending = this.pending.catch(() => undefined).then(() => this.#writeAtomic(payload))
    this.pending.catch(error => this.logger.warn(`dsh-focal: failed to persist desktop memory: ${error.message}`))
    return this.pending
  }

  async #writeAtomic(payload) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await chmod(this.root, 0o700).catch(() => undefined)
    const temporary = join(this.root, `.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, this.filename)
    await chmod(this.filename, 0o600).catch(() => undefined)
  }

  close() {
    return this.pending.catch(() => undefined)
  }
}

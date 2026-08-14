import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { sanitizeText } from './memory.js'

const execFile = promisify(execFileCallback)

const DEFAULT_BLOCKED_APPS = [
  '1password',
  'bitwarden',
  'dashlane',
  'keychain access',
  'keeper',
  'lastpass',
  'loginwindow',
]

const SENSITIVE_TITLE = /\b(?:password|passcode|sign[ -]?in|log[ -]?in|private browsing|incognito|authentication|one[- ]?time code|2fa|verification code)\b/i

const MACOS_WINDOW_SCRIPT = String.raw`global frontApp, windowTitle, winPos, winSize, delimiter
set delimiter to ASCII character 30
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
  try
    tell process frontApp
      set windowTitle to value of attribute "AXTitle" of window 1
      set winPos to value of attribute "AXPosition" of window 1
      set winSize to value of attribute "AXSize" of window 1
    end tell
  on error
    set windowTitle to ""
    set winPos to {0, 0}
    set winSize to {0, 0}
  end try
end tell
return frontApp & delimiter & windowTitle & delimiter & (item 1 of winPos) & delimiter & (item 2 of winPos) & delimiter & (item 1 of winSize) & delimiter & (item 2 of winSize)`

function positiveInteger(value, fallback, name, upper) {
  const resolvedValue = value ?? fallback
  if (!Number.isSafeInteger(resolvedValue) || resolvedValue < 1 || resolvedValue > upper) {
    throw new TypeError(`${name} must be an integer between 1 and ${upper}`)
  }
  return resolvedValue
}

function parseBlockedApps(value) {
  const entries = String(value ?? DEFAULT_BLOCKED_APPS.join(','))
    .split(',')
    .map(item => sanitizeText(item, 80).toLowerCase())
    .filter(Boolean)
  return [...new Set(entries)]
}

function localOllamaUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('localVisionBaseUrl must be a valid loopback URL')
  }
  const host = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new TypeError('localVisionBaseUrl must use HTTP on localhost, 127.0.0.1, or ::1')
  }
  parsed.pathname = '/'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

export function normalizeDesktopConfig(config = {}) {
  const normalized = {
    enabled: config.observeDesktop ?? false,
    captureWindowTitles: config.captureWindowTitles ?? false,
    shareMetadataWithModel: config.shareDesktopMetadataWithModel ?? false,
    shareVisualSummariesWithModel: config.shareLocalVisualSummariesWithModel ?? false,
    captureScreenshots: config.captureScreenshots ?? false,
    analyzeScreenshotsLocally: config.analyzeScreenshotsLocally ?? false,
    retainScreenshots: config.retainScreenshots ?? false,
    sampleIntervalMs: positiveInteger(config.desktopSampleIntervalMs, 5000, 'desktopSampleIntervalMs', 300000),
    maxSampleIntervalMs: positiveInteger(config.desktopMaxSampleIntervalMs, 60000, 'desktopMaxSampleIntervalMs', 600000),
    heartbeatMs: positiveInteger(config.desktopHeartbeatMs, 60000, 'desktopHeartbeatMs', 3600000),
    sensorTimeoutMs: positiveInteger(config.desktopSensorTimeoutMs, 3000, 'desktopSensorTimeoutMs', 60000),
    screenshotCooldownMs: positiveInteger(config.screenshotCooldownMs, 60000, 'screenshotCooldownMs', 3600000),
    localVisionTimeoutMs: positiveInteger(config.localVisionTimeoutMs, 45000, 'localVisionTimeoutMs', 300000),
    maxObservations: positiveInteger(config.maxDesktopObservations, 120, 'maxDesktopObservations', 2000),
    maxScreenshots: positiveInteger(config.maxLocalScreenshots, 24, 'maxLocalScreenshots', 500),
    blockedApps: parseBlockedApps(config.blockedDesktopApps),
    localVisionBaseUrl: localOllamaUrl(config.localVisionBaseUrl ?? 'http://127.0.0.1:11434'),
    localVisionModel: sanitizeText(config.localVisionModel ?? 'qwen3-vl:8b', 120),
  }
  if (normalized.maxSampleIntervalMs < normalized.sampleIntervalMs) {
    throw new TypeError('desktopMaxSampleIntervalMs must be greater than or equal to desktopSampleIntervalMs')
  }
  if (normalized.shareMetadataWithModel && !normalized.enabled) {
    throw new TypeError('shareDesktopMetadataWithModel requires observeDesktop')
  }
  if (normalized.shareVisualSummariesWithModel && !normalized.analyzeScreenshotsLocally) {
    throw new TypeError('shareLocalVisualSummariesWithModel requires analyzeScreenshotsLocally')
  }
  if (normalized.shareVisualSummariesWithModel && !normalized.shareMetadataWithModel) {
    throw new TypeError('shareLocalVisualSummariesWithModel requires shareDesktopMetadataWithModel')
  }
  if (normalized.analyzeScreenshotsLocally && !normalized.captureScreenshots) {
    throw new TypeError('analyzeScreenshotsLocally requires captureScreenshots')
  }
  if (normalized.captureScreenshots && !normalized.analyzeScreenshotsLocally && !normalized.retainScreenshots) {
    throw new TypeError('captureScreenshots requires local analysis or explicit local retention')
  }
  return Object.freeze(normalized)
}

export function parseMacOSWindow(output) {
  const [app = '', title = '', x = '0', y = '0', width = '0', height = '0'] = String(output).trim().split('\x1e')
  const numbers = [x, y, width, height].map(value => Number.parseInt(value, 10))
  const region = numbers.every(Number.isFinite) && numbers[2] > 200 && numbers[3] > 100
    ? { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] }
    : undefined
  return {
    app: sanitizeText(app, 120),
    title: sanitizeText(title, 240),
    ...(region ? { region } : {}),
  }
}

export class MacOSDesktopSensor {
  constructor({ platform = process.platform, timeoutMs = 3000, run = execFile } = {}) {
    this.platform = platform
    this.timeoutMs = timeoutMs
    this.run = run
  }

  supported() {
    return this.platform === 'darwin'
  }

  async sample(signal) {
    if (!this.supported()) throw new Error(`desktop observation is unsupported on ${this.platform}`)
    const result = await this.run('/usr/bin/osascript', ['-e', MACOS_WINDOW_SCRIPT], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: this.timeoutMs,
      signal,
    })
    const observation = parseMacOSWindow(result.stdout)
    if (!observation.app) throw new Error('active application was unavailable')
    return observation
  }

  async capture(filename, region, signal) {
    if (!this.supported()) throw new Error(`screen capture is unsupported on ${this.platform}`)
    if (!region || region.width <= 200 || region.height <= 100) {
      throw new Error('active window bounds were unavailable; refusing a full-desktop capture')
    }
    const args = ['-x', '-t', 'png', '-R', `${region.x},${region.y},${region.width},${region.height}`]
    args.push(filename)
    await this.run('/usr/sbin/screencapture', args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: Math.max(this.timeoutMs, 10000),
      signal,
    })
    await chmod(filename, 0o600).catch(() => undefined)
  }
}

export class LocalOllamaVision {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = config.localVisionBaseUrl
    this.model = config.localVisionModel
    this.timeoutMs = config.localVisionTimeoutMs
    this.fetchImpl = fetchImpl
  }

  async analyze(filename, observation, signal) {
    const info = await stat(filename)
    if (info.size > 12 * 1024 * 1024) throw new Error('local screenshot exceeds the 12 MiB analysis limit')
    const image = await readFile(filename, { signal })
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
    const response = await this.fetchImpl(new URL('/api/generate', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `Describe the visible desktop activity in one short factual sentence. Application: ${observation.app}. Do not transcribe credentials, personal identifiers, messages, or access tokens.`,
        images: [image.toString('base64')],
        stream: false,
        options: { temperature: 0.1, num_predict: 96 },
      }),
      signal: requestSignal,
    })
    if (!response.ok) throw new Error(`local Ollama returned HTTP ${response.status}`)
    const payload = await response.json()
    const summary = sanitizeText(payload?.response, 500)
    if (!summary) throw new Error('local Ollama returned an empty visual summary')
    return summary
  }
}

function screenshotName(observation) {
  const digest = createHash('sha256').update(observation.id).digest('hex').slice(0, 12)
  return `${observation.at}-${digest}.png`
}

function callContained(callback, value, logger, label) {
  try {
    Promise.resolve(callback(value)).catch(error => logger.warn(`dsh-focal: ${label} failed: ${error.message}`))
  } catch (error) {
    logger.warn(`dsh-focal: ${label} failed: ${error.message}`)
  }
}

export class AdaptiveDesktopObserver {
  constructor({
    config,
    sensor,
    screenshotRoot,
    vision,
    onObservation = () => {},
    onVisualObservation = () => {},
    logger = console,
    clock = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.config = normalizeDesktopConfig(config)
    this.sensor = sensor
    this.screenshotRoot = resolve(screenshotRoot)
    this.vision = vision
    this.onObservation = onObservation
    this.onVisualObservation = onVisualObservation
    this.logger = logger
    this.clock = clock
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.running = false
    this.generation = 0
    this.currentDelayMs = this.config.sampleIntervalMs
    this.timer = undefined
    this.abortController = undefined
    this.samplePromise = undefined
    this.snapshotWorkerPromise = undefined
    this.pendingSnapshot = undefined
    this.lastSignature = undefined
    this.focusStartedAt = undefined
    this.lastPublishedAt = 0
    this.lastScreenshotAt = 0
    this.lastApp = undefined
    this.lastError = undefined
    this.consecutiveErrors = 0
    this.droppedSamples = 0
    this.droppedSnapshots = 0
    this.skippedSensitive = 0
  }

  status() {
    return {
      configured: this.config.enabled,
      supported: this.sensor.supported(),
      running: this.running,
      currentDelayMs: this.currentDelayMs,
      ...(this.lastApp ? { lastApp: this.lastApp } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      consecutiveErrors: this.consecutiveErrors,
      droppedSamples: this.droppedSamples,
      droppedSnapshots: this.droppedSnapshots,
      skippedSensitive: this.skippedSensitive,
      captureWindowTitles: this.config.captureWindowTitles,
      captureScreenshots: this.config.captureScreenshots,
      analyzeScreenshotsLocally: this.config.analyzeScreenshotsLocally,
      retainScreenshots: this.config.retainScreenshots,
      shareMetadataWithModel: this.config.shareMetadataWithModel,
      shareVisualSummariesWithModel: this.config.shareVisualSummariesWithModel,
    }
  }

  start({ immediate = true } = {}) {
    if (!this.config.enabled || this.running) return this.status()
    if (!this.sensor.supported()) {
      this.lastError = `desktop observation is unsupported on ${this.sensor.platform ?? process.platform}`
      return this.status()
    }
    this.running = true
    this.generation += 1
    this.abortController = new AbortController()
    this.currentDelayMs = this.config.sampleIntervalMs
    this.#schedule(immediate ? 0 : this.currentDelayMs)
    return this.status()
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.generation += 1
    this.abortController?.abort()
    this.abortController = undefined
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
    this.pendingSnapshot = undefined
  }

  async sampleNow() {
    if (!this.running) throw new Error('desktop observer is not running')
    await this.#tick(true)
  }

  #schedule(delay) {
    if (!this.running) return
    this.timer = this.setTimer(() => {
      this.timer = undefined
      void this.#tick(false)
    }, delay)
    this.timer?.unref?.()
  }

  async #tick(manual) {
    if (!this.running) return
    if (this.samplePromise) {
      this.droppedSamples += 1
      if (!manual) this.#schedule(this.currentDelayMs)
      return
    }
    const generation = this.generation
    const task = this.#performSample(generation)
    this.samplePromise = task
    try {
      await task
    } finally {
      if (this.samplePromise === task) this.samplePromise = undefined
      if (!manual && this.running && generation === this.generation) this.#schedule(this.currentDelayMs)
    }
  }

  async #performSample(generation) {
    try {
      const raw = await this.sensor.sample(this.abortController.signal)
      if (!this.running || generation !== this.generation) return
      const app = sanitizeText(raw.app, 120)
      const normalizedApp = app.toLowerCase()
      if (this.config.blockedApps.some(item => normalizedApp.includes(item))) {
        this.skippedSensitive += 1
        this.lastApp = '[sensitive application]'
        this.lastSignature = '[sensitive]'
        this.currentDelayMs = Math.min(this.config.maxSampleIntervalMs, Math.ceil(this.currentDelayMs * 1.5))
        return
      }

      let title
      if (this.config.captureWindowTitles && raw.title) {
        title = SENSITIVE_TITLE.test(raw.title) ? '[redacted sensitive title]' : sanitizeText(raw.title, 240)
      }
      const signature = `${app}\0${title ?? ''}`
      const now = this.clock()
      const changed = signature !== this.lastSignature
      if (changed) this.focusStartedAt = now
      const dueHeartbeat = now - this.lastPublishedAt >= this.config.heartbeatMs
      this.lastSignature = signature
      this.lastApp = app
      this.lastError = undefined
      this.consecutiveErrors = 0
      this.currentDelayMs = changed
        ? this.config.sampleIntervalMs
        : Math.min(this.config.maxSampleIntervalMs, Math.ceil(this.currentDelayMs * 1.5))

      if (!changed && !dueHeartbeat) return
      const observation = {
        id: `${now}-${createHash('sha256').update(signature).digest('hex').slice(0, 12)}`,
        at: now,
        kind: changed ? 'focus' : 'heartbeat',
        app,
        ...(title ? { title } : {}),
        durationMs: Math.max(0, now - (this.focusStartedAt ?? now)),
        ...(raw.region ? { region: raw.region } : {}),
      }
      this.lastPublishedAt = now
      callContained(this.onObservation, observation, this.logger, 'desktop observation consumer')
      if (this.config.captureScreenshots && now - this.lastScreenshotAt >= this.config.screenshotCooldownMs) {
        this.#queueSnapshot(observation, generation)
      }
    } catch (error) {
      if (error?.name === 'AbortError' || !this.running || generation !== this.generation) return
      this.consecutiveErrors += 1
      this.lastError = sanitizeText(error?.message ?? error, 240)
      const multiplier = Math.min(16, 2 ** this.consecutiveErrors)
      this.currentDelayMs = Math.min(this.config.maxSampleIntervalMs, this.config.sampleIntervalMs * multiplier)
    }
  }

  #queueSnapshot(observation, generation) {
    this.lastScreenshotAt = observation.at
    if (this.pendingSnapshot) this.droppedSnapshots += 1
    this.pendingSnapshot = { observation, generation }
    this.#ensureSnapshotWorker()
  }

  #ensureSnapshotWorker() {
    if (!this.running || this.snapshotWorkerPromise || !this.pendingSnapshot) return
    const worker = this.#drainSnapshots()
    this.snapshotWorkerPromise = worker
    worker.catch(error => this.logger.warn(`dsh-focal: snapshot worker failed: ${error.message}`)).finally(() => {
      if (this.snapshotWorkerPromise === worker) this.snapshotWorkerPromise = undefined
      this.#ensureSnapshotWorker()
    })
  }

  async #drainSnapshots() {
    while (this.running && this.pendingSnapshot) {
      const job = this.pendingSnapshot
      this.pendingSnapshot = undefined
      if (job.generation !== this.generation) continue
      await mkdir(this.screenshotRoot, { recursive: true, mode: 0o700 })
      await chmod(this.screenshotRoot, 0o700).catch(() => undefined)
      const filename = join(this.screenshotRoot, screenshotName(job.observation))
      try {
        await this.sensor.capture(filename, job.observation.region, this.abortController.signal)
        if (!this.running || job.generation !== this.generation) {
          await unlink(filename).catch(() => undefined)
          continue
        }
        let visualSummary
        if (this.config.analyzeScreenshotsLocally) {
          visualSummary = await this.vision.analyze(filename, job.observation, this.abortController.signal)
        }
        callContained(this.onVisualObservation, {
          id: job.observation.id,
          ...(visualSummary ? { visualSummary } : {}),
          localSnapshotStored: this.config.retainScreenshots,
        }, this.logger, 'visual observation consumer')
        if (!this.config.retainScreenshots) await unlink(filename).catch(() => undefined)
        else await this.#trimScreenshots()
      } catch (error) {
        await unlink(filename).catch(() => undefined)
        if (error?.name !== 'AbortError') {
          this.lastError = sanitizeText(`snapshot: ${error?.message ?? error}`, 240)
        }
      }
    }
  }

  async #trimScreenshots() {
    const names = (await readdir(this.screenshotRoot)).filter(name => /^\d+-[a-f0-9]{12}\.png$/.test(name)).sort()
    const remove = names.slice(0, Math.max(0, names.length - this.config.maxScreenshots))
    await Promise.allSettled(remove.map(name => unlink(join(this.screenshotRoot, name))))
  }

  async clearScreenshots() {
    let names = []
    try {
      names = (await readdir(this.screenshotRoot)).filter(name => /^\d+-[a-f0-9]{12}\.png$/.test(name))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await Promise.allSettled(names.map(name => unlink(join(this.screenshotRoot, name))))
    return names.length
  }

  async whenIdle() {
    await Promise.allSettled([this.samplePromise, this.snapshotWorkerPromise].filter(Boolean))
  }

  async close() {
    this.stop()
    await this.whenIdle()
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { AdaptiveDesktopObserver, MacOSDesktopSensor, normalizeDesktopConfig, parseMacOSWindow } from '../src/desktop-observer.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function observerFixture({ sensor, config = {}, clock = () => 1000, onObservation, onVisualObservation } = {}) {
  return new AdaptiveDesktopObserver({
    config: {
      observeDesktop: true,
      desktopSampleIntervalMs: 10,
      desktopMaxSampleIntervalMs: 1000,
      desktopHeartbeatMs: 1000,
      screenshotCooldownMs: 1,
      ...config,
    },
    sensor: sensor ?? {
      supported: () => true,
      sample: async () => ({ app: 'Editor', title: 'Document' }),
    },
    screenshotRoot: '/tmp/dsh-focal-observer-fixture',
    clock,
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
    onObservation,
    onVisualObservation,
    logger: { warn() {} },
  })
}

test('parses the macOS accessibility record and validates the local-only vision boundary', () => {
  assert.deepEqual(parseMacOSWindow('Safari\x1eDocs\x1e10\x1e20\x1e1200\x1e800\n'), {
    app: 'Safari',
    title: 'Docs',
    region: { x: 10, y: 20, width: 1200, height: 800 },
  })
  assert.throws(() => normalizeDesktopConfig({ localVisionBaseUrl: 'https://api.example.com' }), /loopback|localhost/)
  assert.throws(() => normalizeDesktopConfig({ captureScreenshots: true }), /local analysis|retention/)
  assert.throws(() => normalizeDesktopConfig({
    observeDesktop: true,
    captureScreenshots: true,
    analyzeScreenshotsLocally: true,
    shareLocalVisualSummariesWithModel: true,
  }), /shareDesktopMetadataWithModel/)
})

test('refuses to capture the full desktop when active-window bounds are unavailable', async () => {
  const sensor = new MacOSDesktopSensor({ platform: 'darwin', run: async () => ({ stdout: '' }) })
  await assert.rejects(() => sensor.capture('/tmp/never-created.png', undefined), /refusing a full-desktop capture/)
})

test('omits titles by default and skips configured sensitive applications', async () => {
  const observations = []
  let sample = { app: '1Password', title: 'Secret vault' }
  const observer = observerFixture({
    sensor: { supported: () => true, sample: async () => sample },
    onObservation: value => observations.push(value),
  })
  observer.start({ immediate: false })
  await observer.sampleNow()
  sample = { app: 'Safari', title: 'Private customer page' }
  await observer.sampleNow()
  assert.equal(observer.status().skippedSensitive, 1)
  assert.equal(observations.length, 1)
  assert.equal('title' in observations[0], false)
  await observer.close()
})

test('redacts sensitive titles when title capture is explicitly enabled', async () => {
  const observations = []
  const observer = observerFixture({
    config: { captureWindowTitles: true },
    sensor: { supported: () => true, sample: async () => ({ app: 'Safari', title: 'Sign in — verification code' }) },
    onObservation: value => observations.push(value),
  })
  observer.start({ immediate: false })
  await observer.sampleNow()
  assert.equal(observations[0].title, '[redacted sensitive title]')
  await observer.close()
})

test('adapts sampling delay, resets on activity change, and backs off after errors', async () => {
  let value = { app: 'Editor' }
  let failure
  const observer = observerFixture({
    sensor: {
      supported: () => true,
      async sample() {
        if (failure) throw failure
        return value
      },
    },
  })
  observer.start({ immediate: false })
  await observer.sampleNow()
  assert.equal(observer.status().currentDelayMs, 10)
  await observer.sampleNow()
  assert.equal(observer.status().currentDelayMs, 15)
  value = { app: 'Browser' }
  await observer.sampleNow()
  assert.equal(observer.status().currentDelayMs, 10)
  failure = new Error('sensor stalled')
  await observer.sampleNow()
  assert.equal(observer.status().currentDelayMs, 20)
  await observer.sampleNow()
  assert.equal(observer.status().currentDelayMs, 40)
  await observer.close()
})

test('uses single-flight sampling and drops stale callbacks after stop', async () => {
  const gate = deferred()
  const observations = []
  const observer = observerFixture({
    sensor: { supported: () => true, sample: () => gate.promise },
    onObservation: value => observations.push(value),
  })
  observer.start({ immediate: false })
  const first = observer.sampleNow()
  await observer.sampleNow()
  assert.equal(observer.status().droppedSamples, 1)
  observer.stop()
  gate.resolve({ app: 'Late application' })
  await first
  assert.deepEqual(observations, [])
  await observer.close()
})

test('keeps a capacity-one latest-wins screenshot queue', async () => {
  let now = 100
  let appNumber = 0
  const firstCapture = deferred()
  const captured = []
  const visual = []
  const sensor = {
    supported: () => true,
    sample: async () => {
      appNumber += 1
      return { app: `App ${appNumber}`, region: { x: appNumber, y: 0, width: 800, height: 600 } }
    },
    async capture(_filename, region, _signal) {
      captured.push(region.x)
      if (captured.length === 1) await firstCapture.promise
    },
  }
  const observer = observerFixture({
    sensor,
    clock: () => now,
    config: { captureScreenshots: true, retainScreenshots: true, maxLocalScreenshots: 2 },
    onVisualObservation: value => visual.push(value),
  })
  observer.start({ immediate: false })
  await observer.sampleNow()
  now += 10
  await observer.sampleNow()
  now += 10
  await observer.sampleNow()
  assert.equal(observer.status().droppedSnapshots, 1)
  firstCapture.resolve()
  await observer.whenIdle()
  assert.deepEqual(captured, [1, 3])
  assert.equal(visual.length, 2)
  assert.equal(visual.every(item => item.localSnapshotStored), true)
  await observer.close()
})

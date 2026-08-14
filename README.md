# dsh-focal

`dsh-focal` is a privacy-first task-memory and optional desktop-observation
plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
It keeps DSH agent trajectories in bounded task-isolated memory and can observe
real desktop focus changes without placing screenshots in the DSH model route.

The task model is adapted from
[FOCAL](https://arxiv.org/abs/2604.19541). The real-time observer uses the
adaptive anti-stall engineering developed for
[Major Tom Demo](https://github.com/Haoran2099/major-tom-demo). This plugin is
not the paper's offline reproduction pipeline; that code remains in
[`Haoran2099/focal`](https://github.com/Haoran2099/focal).

## Status

- Plugin version: `v0.2.0`
- DSH compatibility: `0.1.0-rc.6`
- Verified against official DSH commit
  [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a)
- Desktop sensor: macOS; other platforms degrade to task-memory-only mode
- Desktop observation, title capture, screenshot capture, and every model-share
  boundary are disabled by default

DeepSeek Harness is a developer preview and may make compatibility-breaking
changes.

## Install

```bash
dsh plugin --profile web add github:Haoran2099/dsh-focal#v0.2.0
dsh --profile web --dump-config
dsh --profile web
```

Use `--profile headless` for one-shot CLI runs. Remove the plugin with:

```bash
dsh plugin --profile web remove dsh-focal
```

Existing `focal-dsh` users should remove the old plugin row and install
`dsh-focal`. Version 0.2 stores new state under `$DSH_HOME/dsh-focal/v2`; it
does not silently import the old `$DSH_HOME/focal-dsh/v1` directory.

## What works without desktop access

- Observes committed DSH `session/event` records.
- Separates direct user requests into bounded task memories.
- Records filtered tool names, outcomes, and safe path hints, not raw tool
  results or assistant token streams.
- Redacts common credentials and email addresses.
- Injects only the active task's bounded, explicitly untrusted context.
- Provides human deletion and read-only model recall.

## Desktop observation

The observer is independent from DSH's `read_image` tool. DSH `read_image`
stores an image attachment and passes an image block to the routed model; it
requires that model to support image input. The official DeepSeek adapter is
text-only. `dsh-focal` instead converts optional local desktop perception into
bounded text records before any explicitly enabled model sharing.

Metadata-only local observation:

```yaml
- id: dsh-focal
  config:
    captureUserText: true
    captureToolPaths: true
    injectContext: true
    maxTasks: 32
    maxObservationsPerTask: 40
    maxContextObservations: 8
    maxContextChars: 4000
    observeDesktop: true
    captureWindowTitles: false
    shareDesktopMetadataWithModel: false
    shareLocalVisualSummariesWithModel: false
    captureScreenshots: false
    analyzeScreenshotsLocally: false
    retainScreenshots: false
    desktopSampleIntervalMs: 5000
    desktopMaxSampleIntervalMs: 60000
    desktopHeartbeatMs: 60000
    desktopSensorTimeoutMs: 3000
    screenshotCooldownMs: 60000
    localVisionTimeoutMs: 45000
    maxDesktopObservations: 120
    maxLocalScreenshots: 24
    blockedDesktopApps: 1password,bitwarden,dashlane,keychain access,keeper,lastpass,loginwindow
    localVisionBaseUrl: http://127.0.0.1:11434
    localVisionModel: qwen3-vl:8b
```

This records the foreground application locally. Window titles remain off.
`shareDesktopMetadataWithModel: false` means even this metadata is not included
in DSH prompts or model tools.

To let the routed text model see application-level activity, separately set:

```yaml
shareDesktopMetadataWithModel: true
```

That adds bounded text context and the read-only `focal_desktop_recall` tool.
The tool schema contains no screenshot bytes, image blocks, or local paths.

### Optional local screenshot analysis

General screenshot semantics still require a vision component. `dsh-focal` can
use a loopback Ollama vision model while keeping the DSH provider text-only:

```bash
ollama pull qwen3-vl:8b
```

```yaml
observeDesktop: true
captureScreenshots: true
analyzeScreenshotsLocally: true
retainScreenshots: false
localVisionBaseUrl: http://127.0.0.1:11434
localVisionModel: qwen3-vl:8b
shareDesktopMetadataWithModel: false
shareLocalVisualSummariesWithModel: false
```

The base URL must resolve to HTTP loopback (`localhost`, `127.0.0.1`, or
`::1`). A remote URL is rejected during configuration. Only the active window
region is captured; unavailable window bounds cause a privacy-preserving
refusal rather than a full-desktop capture. With retention off, a capture is
deleted after local analysis. The resulting short text summary is
also local unless both model-share switches are explicitly enabled:

```yaml
shareDesktopMetadataWithModel: true
shareLocalVisualSummariesWithModel: true
```

No setting causes this plugin to attach screenshots to a DSH model request.

## Adaptive anti-stall behavior

The observer follows Major Tom Demo's real-time operating pattern:

- recursive non-overlapping scheduling instead of a fixed `setInterval`;
- single-flight sensor work and generation tokens that discard stale callbacks;
- fast sampling after focus changes, gradual slowdown while stable, and
  exponential error backoff;
- screenshot cooldown plus a capacity-one, latest-wins analysis queue;
- bounded observations and optional bounded screenshot retention;
- abort-and-drain shutdown.

Slow local vision inference therefore cannot create an unbounded screenshot
backlog or block DSH's agent loop.

## Permissions and commands

On macOS, enable Accessibility permission for the terminal or application that
runs DSH. Screen Recording permission is required only when screenshots are
explicitly enabled. Password managers and `loginwindow` are skipped by default;
extend `blockedDesktopApps` for your environment.

Human commands:

```text
/focal status
/focal tasks
/focal desktop
/focal desktop clear
/focal forget task-1
/focal forget all
```

Model-facing tools always available:

- `focal_status`
- `focal_recall`

`focal_desktop_recall` appears only when
`shareDesktopMetadataWithModel: true`. Deletion remains human-only.

## Privacy boundary

Task memory and desktop observations are stored with owner-only permissions
under `$DSH_HOME/dsh-focal/v2`. Desktop titles, screenshots, and model sharing
are independent opt-ins. Screenshot analysis can contact only the configured
loopback Ollama service. There is no telemetry.

When task context or desktop sharing is enabled, the resulting filtered text is
sent to the model provider selected in DSH. Filtering is defense in depth, not
a guarantee that every sensitive value can be recognized. Keep credentials out
of prompts and tool arguments.

## Development

```bash
npm install
npm test
npm pack --dry-run
```

Requires Node.js `^22.19.0 || >=24.0.0`. See
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[`CITATION.cff`](CITATION.cff).

## License and citation

The plugin code is MIT licensed. If you use it in research, cite
[FOCAL: Filtered On-device Continuous Activity Logging for Efficient Personal
Desktop Summarization](https://arxiv.org/abs/2604.19541).

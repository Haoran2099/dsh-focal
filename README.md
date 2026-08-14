# FOCAL for DeepSeek Harness

FOCAL is an experimental, privacy-first memory plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It filters an
agent session into task-isolated memories and injects only the active task's
bounded context into later model requests.

This is the DSH adaptation of
[FOCAL: Filtered On-device Continuous Activity Logging for Efficient Personal
Desktop Summarization](https://arxiv.org/abs/2604.19541). The paper reproduction
code remains in [`Haoran2099/focal`](https://github.com/Haoran2099/focal).

## Status

- Plugin version: `v0.1.1`
- DSH compatibility: `0.1.0-rc.6`
- Verified against official commit
  [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a)
- Clean-install and Host-load tested with the official `0.1.0-rc.6` CLI
- Host plugin only; no Web UI extension yet

DeepSeek Harness is currently a developer preview and warns that compatibility-
breaking changes will occur. This package pins the supported DSH interfaces
intentionally.

## Install

Install directly from the tagged GitHub source. The package is plain ESM and has
no install-time build script.

```bash
dsh plugin --profile web add github:Haoran2099/focal-dsh#v0.1.1
dsh --profile web --dump-config
dsh --profile web
```

Use `--profile headless` instead to add FOCAL to one-shot CLI runs.

Remove it with:

```bash
dsh plugin --profile web remove focal-dsh
```

## What it does

- Observes committed `session/event` records.
- Routes direct user messages into task-isolated memories using a small,
  deterministic similarity filter.
- Selectively records tool name, success/failure, and path-like arguments.
- Never records assistant token streams, raw tool arguments, or raw tool-result
  content.
- Redacts common credentials and email addresses; direct user text is captured
  by default and can be replaced with a generic marker through configuration.
- Stores one bounded JSON document per session under
  `$DSH_HOME/focal-dsh/v1` (normally `~/.dsh/focal-dsh/v1`).
- Contributes an active-task runtime-context snapshot and an anti-injection
  policy section.

## Commands and tools

Human command:

```text
/focal status
/focal tasks
/focal forget task-1
/focal forget all
```

Model-facing read-only tools:

- `focal_status`
- `focal_recall`

Deletion is deliberately available only through the human command.

## Configuration

Override the inserted row in the profile's `cordis.patch.yml`. A DSH patch
replaces the row's whole config, so keep every setting you still need:

```yaml
- id: focal-memory
  config:
    captureUserText: false
    captureToolPaths: true
    injectContext: true
    maxTasks: 32
    maxObservationsPerTask: 40
    maxContextObservations: 8
    maxContextChars: 4000
```

`captureUserText: false` replaces stored request text with a generic marker.
`injectContext: false` keeps collection and explicit recall available but adds
nothing automatically to model requests.

## Privacy and trust boundary

FOCAL performs no network requests and has no telemetry. Stored text is local,
bounded, and passed through token, credential, and email redaction. Absolute
paths outside the workspace are reduced to their basename, and the workspace's
absolute path is not written into the memory document.

When `injectContext` is enabled, the filtered active-task snapshot becomes part
of the next model request and is therefore sent to the model provider selected
in DSH. Use a local provider or disable injection if that boundary is not
acceptable. Memory is explicitly marked as untrusted data; it is never treated
as instructions.

This filtering is defense in depth, not a guarantee that all sensitive values
can be recognized. Do not place credentials in prompts or tool arguments.

## Development

Requires the Node.js range supported by DSH (`^22.19.0 || >=24.0.0`).

```bash
npm install
npm test
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License and citation

The plugin code is MIT licensed. Cite the FOCAL paper using
[`CITATION.cff`](CITATION.cff).

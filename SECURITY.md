# Security Policy

`dsh-focal` is a same-process DSH Host plugin. Installing it grants the package
code the permissions of the DSH process. Review and pin the source before use.

## Data handling

- There is no telemetry or automatic external network request.
- Task and desktop memory live under `$DSH_HOME/dsh-focal/v2`, with directory
  mode `0700` and JSON file mode `0600` where POSIX permissions are available.
- Desktop observation, window titles, screenshots, screenshot retention,
  desktop-metadata sharing, and local-visual-summary sharing are separate
  opt-ins and are all disabled by default.
- Password managers and `loginwindow` are skipped by default. Titles matching
  common authentication or private-browsing terms are redacted.
- Optional screenshot analysis accepts only an HTTP loopback Ollama base URL.
  It never uses the DSH provider route.
- Screen capture requires valid active-window bounds; missing bounds cause a
  refusal rather than falling back to a full-desktop capture.
- No model-facing tool returns screenshot bytes, image blocks, screenshot
  paths, or local-retention metadata.
- With `retainScreenshots: false`, captures are deleted after local analysis.
  Retention, when explicitly enabled, is bounded and stored owner-only.
- Raw tool arguments and raw tool-result content are not persisted.
- Direct user text is captured by default; set `captureUserText: false` to
  store only a generic request marker.
- Model-visible memory is marked as untrusted historical data.
- `/focal forget` and `/focal desktop clear` are human-only.

When any model-share option is enabled, the corresponding filtered text enters
the DSH model request and crosses the selected provider boundary. Redaction is
best effort. Users remain responsible for keeping credentials and sensitive
content out of model-visible inputs.

## Reporting

Report vulnerabilities privately through GitHub Security Advisories for
`Haoran2099/dsh-focal`. Do not include real secrets, screenshots, or private
sessions in public issues.

# Security Policy

FOCAL is a same-process DSH Host plugin. Installing it grants the package code
the permissions of the DSH process. Review and pin the source before installing.

## Data handling

- No telemetry or network requests.
- Local memory lives under `$DSH_HOME/focal-dsh/v1` with directory mode `0700`
  and file mode `0600` where the platform supports POSIX permissions.
- Raw tool arguments and raw tool-result content are not persisted.
- Direct user text is captured by default; set `captureUserText: false` to
  store only a generic request marker.
- The workspace's absolute path helps derive the local filename but is not
  written into the memory document.
- Model-visible memory is marked as untrusted historical data.
- `/focal forget` is human-only; the model has no deletion tool.

Redaction is best effort. Users remain responsible for keeping credentials out
of prompts and tool arguments and for selecting an acceptable model provider.

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories for
`Haoran2099/focal-dsh`. Do not include real secrets or private session data in a
public issue.

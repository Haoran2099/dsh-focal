# Contributing

Issues and pull requests are welcome. Keep the plugin offline by default,
preserve task isolation, and add tests for every change to capture, redaction,
storage, or model-context behavior.

```bash
npm install
npm test
npm pack --dry-run
```

Never commit real DSH sessions, `$DSH_HOME`, credentials, screenshots, tool
outputs, or generated memory files.

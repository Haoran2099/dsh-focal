# Contributing

Issues and pull requests are welcome. Keep desktop observation and every
model-share boundary off by default, preserve task isolation, and add tests for
changes to capture, redaction, adaptive scheduling, storage, or model context.

```bash
npm install
npm test
npm pack --dry-run
```

Tests must not contact a live desktop, external model provider, or Ollama.
Never commit real DSH sessions, `$DSH_HOME`, credentials, screenshots, tool
outputs, or generated memory files. Model-facing tools must never expose image
bytes, screenshot paths, or local-retention state.

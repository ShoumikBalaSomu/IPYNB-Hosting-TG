# TeleBook CLI (`telebook`)

Developer command-line interface for TeleBook — zero-knowledge, sovereign Jupyter Notebook hosting and syncing.

## Installation

```bash
pip install -e packages/cli
```

## Features

- **`telebook login`**: Instant desktop authorization via 120s ephemeral magic token.
- **`telebook push <file.ipynb>`**: Client-side AES-256-GCM chunked encryption (`TELEBOOK_V1`) and upload.
- **`telebook pull <notebook-id>`**: Download encrypted chunks, verify hashes, and decrypt to local disk.
- **`telebook list`**: Rich terminal view of stored notebooks, versions, and sizes.
- **`telebook search <query>`**: Search notebooks by title, tag, or description.
- **`telebook watch <dir>`**: Live daemon monitoring local folder for `.ipynb` modifications, auto-encrypting and syncing.
- **`telebook export-all`**: Zero lock-in batch decryption and export of all stored notebooks.
- **`telebook revoke`**: Invalidate all active sessions globally via atomic epoch increment.

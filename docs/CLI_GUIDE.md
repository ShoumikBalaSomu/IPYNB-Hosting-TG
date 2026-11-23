# TeleBook CLI Manual

The `telebook` command-line utility enables direct interaction with TeleBook servers from a terminal.

## Installation

```bash
pip install ./packages/cli
```

## Commands

### `telebook login`
Authenticates the CLI session with a server instance using an ephemeral 120-second token provided by your Telegram bot.

### `telebook push <path>`
Encrypts a local `.ipynb` notebook file using `TELEBOOK_V1` AES-256-GCM and streams chunks to the server.
```bash
telebook push notebook.ipynb --title "Model Training"
```

### `telebook pull <notebook-id>`
Downloads all encrypted chunks, verifies SHA-256 hashes, decrypts payloads, and writes the plaintext `.ipynb` to disk.
```bash
telebook pull nb_abc123 --output exported.ipynb
```

### `telebook list`
Displays a formatted list of all stored notebooks, versions, chunk counts, and modification dates.

### `telebook search <query>`
Searches notebook titles and descriptions matching the query string.

### `telebook watch <directory>`
Monitors a local directory for notebook changes, automatically encrypting and uploading new versions upon file save.

### `telebook export-all <target-dir>`
Bulk decrypts every notebook in your storage and writes clean `.ipynb` files to the designated directory with an index manifest.

# TeleBook: Innovation Blueprint & Advanced Capabilities

---

## 1. Architectural Innovation Overview

TeleBook transcends basic static document viewers by transforming raw Telegram object storage and serverless edge functions into a dynamic, interactive research environment.

```
+-----------------------------------------------------------------------------+
|                            Client Runtime (Browser / TMA)                    |
|                                                                             |
|  +------------------------+  +---------------------+  +------------------+  |
|  |   Notebook X-Ray       |  |  Pyodide / WASM     |  | Cell Version     |  |
|  | - Table of Contents    |  |  Live Execution     |  | Diff Engine      |  |
|  | - Import Dependency Map|  | - Web Worker Isolate|  | - Stable Cell ID |  |
|  | - Cell Runtime Heatmap |  | - Virtual FS (MEMFS)|  | - Visual Out Diff|  |
|  +------------------------+  +---------------------+  +------------------+  |
|                                         |                                    |
|                      Zero-Knowledge TELEBOOK_V1 Engine                       |
|           (Client-Side AES-256-GCM Slicing & AAD Verification)               |
+-----------------------------------------------------------------------------+
                                     |
               Encrypted 15 MB Chunks & Zero-Knowledge Routing
                                     v
+------------------------------------+----------------------------------------+
|      Cloudflare Worker API         |         Cloudflare D1 SQLite           |
|   (Sub-10ms CPU HMAC & Routing)    |   (Indexed Metadata & Version Manifest)|
+------------------------------------+----------------------------------------+
                                     |
                         Direct Storage Forwarding
                                     v
+-----------------------------------------------------------------------------+
|                       Telegram Bot API Infrastructure                        |
|                     (Sovereign Replicated File Storage)                      |
+-----------------------------------------------------------------------------+
```

---

## 2. In-Browser Live Execution Sandbox: JupyterLite & Pyodide

Traditional notebook platforms require expensive remote cloud compute (EC2 instances, Kubernetes pods, Docker containers) costing $20-$100/month per active user. TeleBook achieves **$0 operating cost** by offloading execution directly to the user's browser via WebAssembly.

### 2.1 Pyodide WebAssembly Execution Pipeline

1. **Dedicated Web Worker Isolation**:
   - Code execution is never run on the main UI thread. A dedicated `ExecutionWorker` encapsulates the WebAssembly runtime.
   - The UI remains completely responsive (60 FPS scrolling and typing) even while calculating intensive scientific matrix operations.

2. **Supported Scientific Python Stack**:
   - Standard Pyodide packages pre-compiled to WebAssembly:
     - `numpy`, `scipy`, `pandas`, `matplotlib`, `scikit-learn`, `sympy`, `micropip`.
   - Packages are loaded on demand via Pyodide's dynamic wheel loader (`micropip.install()`).

3. **Virtual File System & State Capture**:
   - Pyodide mounts a transient in-memory virtual filesystem (`MEMFS`).
   - Standard output (`stdout`) and standard error (`stderr`) are hooked via Python's `sys.stdout` redirection to stream real-time logs to the cell's `output` array.
   - Visual outputs from Matplotlib/Seaborn are intercepted via custom Python display hooks, serializing PNG/SVG charts directly into the notebook's MIME bundle.

### 2.2 Versioned Mutation & Save-Back as `v(N+1)`

When an author executes or edits code in the browser, TeleBook preserves an immutable audit trail:

```
[ Version v1 ] ---> User modifies Cell 3 & executes Cell 4 ---> [ Version v2 ]
  (Immutable)                                                     (New Encrypted Chunks)
  Chunk 1, v1                                                     Chunk 1, v2
  Chunk 2, v1                                                     Chunk 2, v2
```

#### Save-Back Protocol:
1. **Schema Validation**: The modified notebook document is validated client-side against the `nbformat` v4.5 Zod schema.
2. **Version Increment**: The client requests the current version $N$ from D1 and assigns target version $N+1$.
3. **Partition & Encryption**:
   - Slices the serialized JSON into 15 MB chunks.
   - Generates fresh 96-bit random IVs for each chunk.
   - Computes AAD: `notebook_id + ":" + (N+1) + ":" + chunk_index + ":" + total_chunks`.
   - Encrypts via `crypto.subtle.encrypt("AES-GCM", key, payload)`.
4. **Push & Commit**:
   - Uploads new chunks to Telegram storage via Worker proxy.
   - Issues atomic D1 batch transaction inserting new chunk records and updating `notebook_versions`.
   - The previous version $vN$ remains intact, enabling instant time-travel rollback.

### 2.3 Memory Safeguards & Watchdogs
- **Memory Ceiling**: Mobile browsers (especially iOS Safari WebKit) terminate tabs that exceed 1.5 GB memory.
- **Worker Watchdog**: If the execution worker exceeds a 500 MB memory threshold or runs continuously for > 15 seconds without yielding, the main thread prompts the user to terminate the execution isolate safely.

---

## 3. Notebook X-Ray Sidebar

Notebooks often suffer from "notebook rot": hidden state, out-of-order execution, and invisible memory bloat. The **Notebook X-Ray Sidebar** provides deep structural diagnostics:

### 3.1 Hierarchical Table of Contents (TOC) with Scroll-Spy
- Recursively parses Markdown heading tokens (`# H1`, `## H2`, `### H3`).
- Constructs a dynamic navigation tree in a collapsible side drawer.
- **Scroll-Spy**: Intersects document scroll positions to highlight the currently active section in real-time.
- One-click jump instantly scrolls the target cell into view.

### 3.2 Automated Dependency & Import Scanner
- Analyzes all code cells with a lightweight Python AST tokenizer.
- Extracts all `import <pkg>` and `from <pkg> import <func>` statements.
- Categorizes dependencies:
  - **Standard Library**: `os`, `sys`, `math`, `json`, `pathlib` (always available).
  - **Core Scientific Stack**: `numpy`, `pandas`, `scipy`, `matplotlib` (instantly available in Pyodide).
  - **Machine Learning / GPU**: `torch`, `tensorflow`, `jax`, `transformers` (flags to user that GPU/heavy cloud environment is required for live run).
  - **External / Third-Party**: Identifies modules installable via `micropip`.

### 3.3 Cell Metrics & Runtime Heatmap
- **Lines of Code (LOC)**: Calculates code density per cell.
- **Execution Duration Profiling**: Inspects `metadata.jupyter.execution` to highlight long-running cells with an execution heatmap (color-coding cells from green `<100ms` to orange `1-5s` to red `>10s`).
- **Asset Size Audit**: Detects bloated base64 images or oversized JSON tables embedded in outputs, warning the author if a single cell output exceeds 2 MB.

---

## 4. Cell Version Diff Engine

Traditional git diffs on `.ipynb` files are notoriously unreadable because Jupyter JSON interleaves cell source, raw multiline arrays, execution numbers, and massive base64 image strings. TeleBook introduces a semantic **Cell Version Diff Engine**:

```
+-------------------------------------------------------------------------+
| Cell #4 [Modified] - ID: c89f2a                                         |
+-------------------------------------------------------------------------+
| Source Code Diff:                                                       |
| - lr = 0.01                                                             |
| + lr = 0.001 # Reduced learning rate for AdamW                          |
|                                                                         |
| Output Diff: [Toggle: Side-by-Side | Unified | Visual Swipe]            |
| (Displays visual comparison of Matplotlib loss curve v1 vs v2)          |
+-------------------------------------------------------------------------+
```

### 4.1 Diff Algorithm Specification
1. **Stable Cell Matching**: Uses nbformat v4.5 cell `id` to map cells between versions $vA$ and $vB$. If cell IDs match, mark for modification analysis. If an ID exists only in $vB$, mark as `Added`. If only in $vA$, mark as `Deleted`.
2. **Source Code Line Diffing**: Runs Myers diff algorithm on `cell.source`, generating syntax-highlighted additions (`+ green`) and deletions (`- red`).
3. **MIME Output Comparison**:
   - **Text Outputs (`text/plain`, `stream`)**: Line-by-line diff.
   - **Image Outputs (`image/png`, `image/svg+xml`)**: Provides a visual slider overlay comparing before/after graphs side-by-side.

---

## 5. Zero-Lock-In Export (`telebook export-all`)

Data sovereignty is a core tenet of TeleBook. Users must never be trapped in a proprietary walled garden.

### 5.1 CLI Batch Export Protocol
```bash
$ telebook export-all --output ~/my-exported-notebooks/
[TeleBook] Authenticating with sovereign cluster... OK
[TeleBook] Found 42 notebooks (118 versions, 312 MB total ciphertext)
[TeleBook] Decrypting with local master passkey...
  [1/42] Transformer_Interpretability.ipynb (v3) -> OK (14.2 MB)
  [2/42] Portfolio_Risk_Model.ipynb (v1)         -> OK (3.8 MB)
  ...
[TeleBook] Successfully exported 42 notebooks to ~/my-exported-notebooks/
[TeleBook] 0 bytes left locked. 100% standard nbformat v4.5 compliant.
```

### 5.2 Technical Export Guarantees
- **Pure Standard JSON**: Exported notebooks contain zero TeleBook-specific wrapper tags or proprietary headers. They can be opened immediately in standard JupyterLab, VS Code, Google Colab, or Kaggle.
- **Web Browser One-Click Export**: The Telegram Mini App and desktop web client include a one-click "Download Raw Archive" button. All chunks are retrieved, decrypted in client RAM using Web Crypto, bundled using client-side ZIP streaming (`JSZip`), and delivered directly to the user's local downloads folder without unencrypted server exposure.

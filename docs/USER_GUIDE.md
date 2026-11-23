# TeleBook User Guide

## Web Interface & Telegram Mini App

TeleBook provides a responsive reading and editing environment tailored for research notebooks.

### Key Workflows

1. **Notebook Ingestion**:
   - Send any `.ipynb` document directly to your Telegram bot.
   - The bot responds with confirmation and an interactive Mini App launch button.
   - Alternatively, drag and drop an `.ipynb` file into the desktop web browser.

2. **Reading Modes**:
   - **Report Mode (`r`)**: Hides code inputs and displays rendered markdown, diagrams, and numerical metrics.
   - **Code Mode**: Shows inputs, outputs, cell execution indices, and line numbers.

3. **Notebook X-Ray Sidebar (`x`)**:
   - Outlines the document structure with heading scroll-spy.
   - Analyzes Python import statements to highlight standard modules, Pyodide-compatible scientific packages, and external libraries.
   - Summarizes execution durations and output sizes per cell.

4. **In-Browser Execution**:
   - Click the live run button on any code cell to execute Python code via Pyodide in a dedicated browser Web Worker.
   - Save modifications to Telegram storage as an immutable new version.

5. **Cell Version Diff (`d`)**:
   - Compare any two notebook versions side-by-side with line-level diff highlighting.

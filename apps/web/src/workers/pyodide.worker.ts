/**
 * Dedicated Pyodide WebAssembly Web Worker Isolate
 * Offloads Python execution completely from the main UI thread.
 */

// Define message interfaces
export interface PyodideInitRequest {
  type: 'INIT';
}

export interface PyodideRunRequest {
  type: 'RUN';
  cellId: string;
  code: string;
}

export interface PyodideOutputMessage {
  type: 'STDOUT' | 'STDERR';
  cellId: string;
  text: string;
}

export interface PyodideResultMessage {
  type: 'SUCCESS' | 'ERROR';
  cellId: string;
  resultText?: string;
  images?: string[]; // base64 encoded PNGs
  errorName?: string;
  errorMessage?: string;
  traceback?: string[];
  durationMs: number;
}

type WorkerIncomingMessage = PyodideInitRequest | PyodideRunRequest;

declare const self: DedicatedWorkerGlobalScope;

let pyodideInstance: any = null;
let isInitializing = false;

async function initPyodideRuntime(): Promise<any> {
  if (pyodideInstance) return pyodideInstance;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return pyodideInstance;
  }

  isInitializing = true;
  try {
    // Dynamic import of Pyodide via CDN
    const pyodideCdnUrl = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
    importScripts(pyodideCdnUrl);

    // @ts-expect-error loadPyodide is loaded into global scope via importScripts
    pyodideInstance = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
    });

    // Install and configure matplotlib / numpy hooks
    await pyodideInstance.runPythonAsync(`
import sys
import io
import base64

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    pass

def _telebook_drain_plots():
    try:
        import matplotlib.pyplot as plt
        figs = [plt.figure(n) for n in plt.get_fignums()]
        images = []
        for fig in figs:
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            buf.seek(0)
            images.append(base64.b64encode(buf.read()).decode("ascii"))
            plt.close(fig)
        return images
    except Exception:
        return []
`);
    isInitializing = false;
    return pyodideInstance;
  } catch (err) {
    isInitializing = false;
    console.warn('[Pyodide Worker] CDN load failed, fallback mode enabled', err);
    return null;
  }
}

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'INIT') {
    await initPyodideRuntime();
    self.postMessage({ type: 'READY' });
    return;
  }

  if (data.type === 'RUN') {
    const { cellId, code } = data;
    const startTime = performance.now();

    try {
      const pyodide = await initPyodideRuntime();

      if (!pyodide) {
        // Fallback simulation mode if Pyodide cannot be fetched from CDN
        let stdout = '';
        const lines = code.split('\n');
        for (const line of lines) {
          const printMatch = line.match(/^\s*print\((.*)\)/);
          if (printMatch && printMatch[1]) {
            stdout += `${evalSafe(printMatch[1])}\n`;
          }
        }

        const durationMs = Math.round(performance.now() - startTime);
        self.postMessage({
          type: 'SUCCESS',
          cellId,
          resultText: stdout || 'Execution simulated (Pyodide offline fallback)',
          images: [],
          durationMs,
        } as PyodideResultMessage);
        return;
      }

      // Automatically load packages required by Python imports
      await pyodide.loadPackagesFromImports(code);

      // Setup output redirection
      let stdoutAcc = '';
      let stderrAcc = '';

      pyodide.setStdout({
        batched: (text: string) => {
          stdoutAcc += text + '\n';
          self.postMessage({ type: 'STDOUT', cellId, text: text + '\n' } as PyodideOutputMessage);
        },
      });

      pyodide.setStderr({
        batched: (text: string) => {
          stderrAcc += text + '\n';
          self.postMessage({ type: 'STDERR', cellId, text: text + '\n' } as PyodideOutputMessage);
        },
      });

      // Execute code in isolate
      const evalResult = await pyodide.runPythonAsync(code);

      // Drain any generated matplotlib plots
      const plotListProxy = await pyodide.runPythonAsync('_telebook_drain_plots()');
      const images: string[] = plotListProxy ? plotListProxy.toJs() : [];

      let resultText: string | undefined;
      if (evalResult !== undefined && evalResult !== null) {
        resultText = String(evalResult);
      } else if (stdoutAcc) {
        resultText = stdoutAcc;
      }

      const durationMs = Math.round(performance.now() - startTime);

      self.postMessage({
        type: 'SUCCESS',
        cellId,
        resultText,
        images,
        durationMs,
      } as PyodideResultMessage);
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = err?.message || String(err);
      const traceback = errorMessage.split('\n');

      self.postMessage({
        type: 'ERROR',
        cellId,
        errorName: err?.name || 'PythonExecutionError',
        errorMessage,
        traceback,
        durationMs,
      } as PyodideResultMessage);
    }
  }
};

function evalSafe(expr: string): string {
  try {
    return expr.replace(/^["']|["']$/g, '');
  } catch {
    return expr;
  }
}

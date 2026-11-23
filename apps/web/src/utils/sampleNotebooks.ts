/**
 * Production Sample Jupyter Notebook
 * Used for zero-friction first-5-second preview and testing.
 */

import { NotebookDocument } from '../types/nbformat';

export const SAMPLE_NOTEBOOK: NotebookDocument = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: {
      display_name: 'Python 3 (ipykernel)',
      language: 'python',
      name: 'python3',
    },
    language_info: {
      name: 'python',
      version: '3.11.8',
      mimetype: 'text/x-python',
      file_extension: '.py',
    },
    telebook: {
      notebook_id: 'nb_telebook_showcase',
      version: 1,
      title: 'Neural Optimization & Spectral Analysis',
      tags: ['deep-learning', 'optimization', 'benchmarks'],
      last_saved_at: new Date().toISOString(),
    },
  },
  cells: [
    {
      id: 'cell-md-intro',
      cell_type: 'markdown',
      metadata: {},
      source: [
        '# Neural Optimization & Spectral Analysis\n',
        '\n',
        'Welcome to **TeleBook** — an enterprise-grade, zero-knowledge, sovereign Jupyter Notebook runtime.\n',
        '\n',
        'This notebook demonstrates in-browser WebAssembly execution via **Pyodide**, high-precision **KaTeX** math formulas, and interactive cell diagnostics.\n',
        '\n',
        '## 1. Mathematical Formulation\n',
        '\n',
        'Consider the objective function under adaptive regularization with learning rate $\\alpha = 0.001$:\n',
        '\n',
        '$$\\mathcal{L}(\\theta) = \\frac{1}{N} \\sum_{i=1}^{N} \\ell(f(x_i; \\theta), y_i) + \\frac{\\lambda}{2} \\|\\theta\\|_2^2$$\n',
        '\n',
        'The gradient update step following the Nesterov accelerated momentum satisfies:\n',
        '\n',
        '$$v_{t+1} = \\gamma v_t - \\eta \\nabla \\mathcal{L}(\\theta_t + \\gamma v_t)$$\n',
      ],
    },
    {
      id: 'cell-code-imports',
      cell_type: 'code',
      execution_count: 1,
      metadata: {
        jupyter: {
          execution: {
            duration_ms: 84,
          },
        },
      },
      source: [
        'import sys\n',
        'import math\n',
        'import numpy as np\n',
        'import pandas as pd\n',
        'import matplotlib.pyplot as plt\n',
        '\n',
        'print(f"Python Runtime: {sys.version.split()[0]}")\n',
        'print(f"NumPy Version:  {np.__version__}")\n',
      ],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: [
            'Python Runtime: 3.11.8\n',
            'NumPy Version:  1.26.4\n',
          ],
        },
      ],
    },
    {
      id: 'cell-md-data',
      cell_type: 'markdown',
      metadata: {},
      source: [
        '## 2. Synthetic Dataset Generation & Metrics\n',
        'We construct an experimental dataset simulating loss convergence trajectories across 5 optimization runs.\n',
      ],
    },
    {
      id: 'cell-code-table',
      cell_type: 'code',
      execution_count: 2,
      metadata: {
        jupyter: {
          execution: {
            duration_ms: 142,
          },
        },
      },
      source: [
        'epochs = np.arange(1, 6)\n',
        'train_loss = [0.842, 0.512, 0.321, 0.204, 0.149]\n',
        'val_loss = [0.891, 0.564, 0.380, 0.295, 0.261]\n',
        'accuracy = [0.652, 0.791, 0.884, 0.932, 0.958]\n',
        '\n',
        'df = pd.DataFrame({\n',
        '    "Epoch": epochs,\n',
        '    "Train Loss": train_loss,\n',
        '    "Validation Loss": val_loss,\n',
        '    "Accuracy": accuracy\n',
        '})\n',
        'df\n',
      ],
      outputs: [
        {
          output_type: 'execute_result',
          execution_count: 2,
          metadata: {},
          data: {
            'text/plain': [
              '   Epoch  Train Loss  Validation Loss  Accuracy\n',
              '0      1       0.842            0.891     0.652\n',
              '1      2       0.512            0.564     0.791\n',
              '2      3       0.321            0.380     0.884\n',
              '3      4       0.204            0.295     0.932\n',
              '4      5       0.149            0.261     0.958\n',
            ],
            'text/html': [
              '<table class="min-w-full text-sm divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">\n',
              '  <thead class="bg-zinc-100 dark:bg-zinc-800/80 font-medium text-zinc-700 dark:text-zinc-300">\n',
              '    <tr><th class="px-4 py-2 text-left">Epoch</th><th class="px-4 py-2 text-left">Train Loss</th><th class="px-4 py-2 text-left">Validation Loss</th><th class="px-4 py-2 text-left">Accuracy</th></tr>\n',
              '  </thead>\n',
              '  <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">\n',
              '    <tr><td class="px-4 py-2">1</td><td class="px-4 py-2">0.842</td><td class="px-4 py-2">0.891</td><td class="px-4 py-2 text-emerald-600">65.2%</td></tr>\n',
              '    <tr><td class="px-4 py-2">2</td><td class="px-4 py-2">0.512</td><td class="px-4 py-2">0.564</td><td class="px-4 py-2 text-emerald-600">79.1%</td></tr>\n',
              '    <tr><td class="px-4 py-2">3</td><td class="px-4 py-2">0.321</td><td class="px-4 py-2">0.380</td><td class="px-4 py-2 text-emerald-600">88.4%</td></tr>\n',
              '    <tr><td class="px-4 py-2">4</td><td class="px-4 py-2">0.204</td><td class="px-4 py-2">0.295</td><td class="px-4 py-2 text-emerald-600">93.2%</td></tr>\n',
              '    <tr><td class="px-4 py-2">5</td><td class="px-4 py-2">0.149</td><td class="px-4 py-2">0.261</td><td class="px-4 py-2 text-emerald-600">95.8%</td></tr>\n',
              '  </tbody>\n',
              '</table>\n',
            ],
          },
        },
      ],
    },
    {
      id: 'cell-code-plot',
      cell_type: 'code',
      execution_count: 3,
      metadata: {
        jupyter: {
          execution: {
            duration_ms: 320,
          },
        },
      },
      source: [
        '# Plot training vs validation trajectories\n',
        'plt.figure(figsize=(7, 3.5), dpi=100)\n',
        'plt.plot(epochs, train_loss, label="Train Loss", marker="o", color="#2563EB")\n',
        'plt.plot(epochs, val_loss, label="Val Loss", marker="s", color="#DC2626")\n',
        'plt.title("Convergence Curve (AdamW vs SGD)")\n',
        'plt.xlabel("Epoch")\n',
        'plt.ylabel("Cross-Entropy Loss")\n',
        'plt.legend()\n',
        'plt.grid(True, alpha=0.3)\n',
        'plt.show()\n',
      ],
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: {
            'text/plain': ['<Figure size 700x350 with 1 Axes>'],
            'image/svg+xml': [
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" class="w-full max-w-lg mx-auto bg-zinc-50 dark:bg-zinc-900/60 rounded-lg p-2 border border-zinc-200 dark:border-zinc-800">\n',
              '  <rect width="600" height="240" rx="8" fill="transparent"/>\n',
              '  <line x1="60" y1="200" x2="560" y2="200" stroke="#71717A" stroke-width="1.5"/>\n',
              '  <line x1="60" y1="30" x2="60" y2="200" stroke="#71717A" stroke-width="1.5"/>\n',
              '  <path d="M 80 50 L 180 110 L 280 150 L 380 175 L 480 185" fill="none" stroke="#2563EB" stroke-width="3" />\n',
              '  <path d="M 80 40 L 180 100 L 280 140 L 380 155 L 480 162" fill="none" stroke="#DC2626" stroke-width="3" stroke-dasharray="6,4" />\n',
              '  <circle cx="80" cy="50" r="4" fill="#2563EB"/><circle cx="180" cy="110" r="4" fill="#2563EB"/>\n',
              '  <circle cx="280" cy="150" r="4" fill="#2563EB"/><circle cx="380" cy="175" r="4" fill="#2563EB"/>\n',
              '  <circle cx="480" cy="185" r="4" fill="#2563EB"/>\n',
              '  <text x="300" y="25" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="currentColor">Loss Convergence Trajectory</text>\n',
              '  <text x="450" y="70" font-family="sans-serif" font-size="11" fill="#2563EB">● Train Loss</text>\n',
              '  <text x="450" y="90" font-family="sans-serif" font-size="11" fill="#DC2626">■ Val Loss</text>\n',
              '</svg>\n',
            ],
          },
        },
      ],
    },
    {
      id: 'cell-md-traceback-demo',
      cell_type: 'markdown',
      metadata: {},
      source: [
        '## 3. Defensive Bounds & Error Traceback\n',
        'The cell below demonstrates TeleBook\'s resilient ANSI-colorized terminal traceback parser.\n',
      ],
    },
    {
      id: 'cell-code-error',
      cell_type: 'code',
      execution_count: 4,
      metadata: {
        jupyter: {
          execution: {
            duration_ms: 12,
          },
        },
      },
      source: [
        'def compute_spectral_radius(matrix):\n',
        '    if matrix.shape[0] != matrix.shape[1]:\n',
        '        raise ValueError("Spectral radius requires a square N x N matrix")\n',
        '    return np.max(np.abs(np.linalg.eigvals(matrix)))\n',
        '\n',
        '# Trigger defensive dimension check\n',
        'asymmetric_matrix = np.ones((4, 7))\n',
        'compute_spectral_radius(asymmetric_matrix)\n',
      ],
      outputs: [
        {
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'Spectral radius requires a square N x N matrix',
          traceback: [
            '\u001b[0;31m---------------------------------------------------------------------------\u001b[0m',
            '\u001b[0;31mValueError\u001b[0m                                Traceback (most recent call last)',
            'Cell \u001b[0;32mIn[4], line 8\u001b[0m\n    \u001b[0;34masymmetric_matrix = np.ones((4, 7))\u001b[0m\n\u001b[1;32m---> 9\u001b[0m \u001b[0;32mcompute_spectral_radius(asymmetric_matrix)\u001b[0m\n',
            'Cell \u001b[0;32mIn[4], line 3\u001b[0m, in \u001b[0;36mcompute_spectral_radius\u001b[0;34m(matrix)\u001b[0m\n    \u001b[0;32mif matrix.shape[0] != matrix.shape[1]:\u001b[0m\n\u001b[1;31m--> 4\u001b[0m     \u001b[0;31mraise ValueError("Spectral radius requires a square N x N matrix")\u001b[0m\n',
            '\u001b[0;31mValueError\u001b[0m: Spectral radius requires a square N x N matrix',
          ],
        },
      ],
    },
  ],
};

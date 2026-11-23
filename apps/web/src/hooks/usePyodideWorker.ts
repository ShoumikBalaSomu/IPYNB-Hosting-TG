/**
 * Pyodide Worker Manager Hook
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { PyodideOutputMessage, PyodideResultMessage } from '../workers/pyodide.worker';
import { CellOutput } from '../types/nbformat';

export interface CellExecutionState {
  status: 'idle' | 'running' | 'completed' | 'error';
  durationMs?: number;
  liveOutput?: string;
}

export function usePyodideWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [runningCellId, setRunningCellId] = useState<string | null>(null);
  const [executionStates, setExecutionStates] = useState<Record<string, CellExecutionState>>({});

  // Callbacks for completion
  const resolversRef = useRef<
    Map<
      string,
      {
        resolve: (outputs: CellOutput[]) => void;
        reject: (err: any) => void;
        collectedOutputs: CellOutput[];
      }
    >
  >(new Map());

  const initWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<any>) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'READY') {
        setIsReady(true);
        return;
      }

      if (data.type === 'STDOUT' || data.type === 'STDERR') {
        const msg = data as PyodideOutputMessage;
        setExecutionStates((prev) => ({
          ...prev,
          [msg.cellId]: {
            ...prev[msg.cellId],
            status: 'running',
            liveOutput: (prev[msg.cellId]?.liveOutput || '') + msg.text,
          },
        }));

        const resolver = resolversRef.current.get(msg.cellId);
        if (resolver) {
          resolver.collectedOutputs.push({
            output_type: 'stream',
            name: msg.type === 'STDOUT' ? 'stdout' : 'stderr',
            text: msg.text,
          });
        }
        return;
      }

      if (data.type === 'SUCCESS' || data.type === 'ERROR') {
        const msg = data as PyodideResultMessage;
        setRunningCellId(null);
        setExecutionStates((prev) => ({
          ...prev,
          [msg.cellId]: {
            status: msg.type === 'SUCCESS' ? 'completed' : 'error',
            durationMs: msg.durationMs,
          },
        }));

        const resolver = resolversRef.current.get(msg.cellId);
        if (resolver) {
          if (msg.type === 'SUCCESS') {
            if (msg.resultText && !resolver.collectedOutputs.some(o => o.output_type === 'stream')) {
              resolver.collectedOutputs.push({
                output_type: 'execute_result',
                execution_count: 1,
                data: { 'text/plain': msg.resultText },
              });
            }
            if (msg.images && msg.images.length > 0) {
              msg.images.forEach((b64) => {
                resolver.collectedOutputs.push({
                  output_type: 'display_data',
                  data: { 'image/png': b64 },
                });
              });
            }
            resolver.resolve(resolver.collectedOutputs);
          } else {
            resolver.collectedOutputs.push({
              output_type: 'error',
              ename: msg.errorName || 'Error',
              evalue: msg.errorMessage || 'Execution Error',
              traceback: msg.traceback || [msg.errorMessage || 'Unknown execution failure'],
            });
            resolver.resolve(resolver.collectedOutputs);
          }
          resolversRef.current.delete(msg.cellId);
        }
      }
    };

    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const runCode = useCallback(
    (cellId: string, code: string): Promise<CellOutput[]> => {
      const worker = initWorker();
      setRunningCellId(cellId);
      setExecutionStates((prev) => ({
        ...prev,
        [cellId]: { status: 'running', liveOutput: '' },
      }));

      return new Promise((resolve, reject) => {
        resolversRef.current.set(cellId, {
          resolve,
          reject,
          collectedOutputs: [],
        });

        worker.postMessage({
          type: 'RUN',
          cellId,
          code,
        });
      });
    },
    [initWorker]
  );

  return {
    isReady,
    runningCellId,
    executionStates,
    runCode,
  };
}

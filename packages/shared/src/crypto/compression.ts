/**
 * Isomorphic Gzip Compression & Decompression
 * Uses standard CompressionStream / DecompressionStream with node:zlib fallback.
 */

/**
 * Compress a byte buffer using gzip.
 */
export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  if (data.byteLength === 0) {
    return new Uint8Array(0);
  }

  if (typeof CompressionStream !== 'undefined') {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });

    const compressedStream = (stream as ReadableStream).pipeThrough(
      new CompressionStream('gzip') as unknown as TransformStream<unknown, Uint8Array>
    );
    const response = new Response(compressedStream);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  // Fallback for Node.js environments lacking global CompressionStream
  try {
    const zlib = await import('node:zlib');
    const { promisify } = await import('node:util');
    const gzip = promisify(zlib.gzip);
    const buffer = await gzip(data);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch {
    throw new Error('CompressionStream is not supported in this runtime environment.');
  }
}

/**
 * Decompress a gzip byte buffer.
 */
export async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (data.byteLength === 0) {
    return new Uint8Array(0);
  }

  if (typeof DecompressionStream !== 'undefined') {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });

    const decompressedStream = (stream as ReadableStream).pipeThrough(
      new DecompressionStream('gzip') as unknown as TransformStream<unknown, Uint8Array>
    );
    const response = new Response(decompressedStream);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  // Fallback for Node.js environments lacking global DecompressionStream
  try {
    const zlib = await import('node:zlib');
    const { promisify } = await import('node:util');
    const gunzip = promisify(zlib.gunzip);
    const buffer = await gunzip(data);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch {
    throw new Error('DecompressionStream is not supported in this runtime environment.');
  }
}

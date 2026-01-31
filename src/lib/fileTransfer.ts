export interface FileMeta {
  type: "meta";
  id: string;
  name: string;
  size: number;
}

export interface FileChunk {
  type: "chunk";
  id: string;
  chunk: ArrayBuffer;
}

export interface FileDone {
  type: "done";
  id: string;
}

const DEFAULT_CHUNK = 32 * 1024; // 32KB

/**
 * Send a file over a PeerJS DataConnection with simple backpressure handling.
 * Returns a stable ID for the transfer.
 */
export const sendFile = async (
  file: File,
  conn: { send: (data: any) => void; bufferSize?: number },
  onProgress?: (percent: number, bytesPerSec?: number) => void,
  chunkSize = DEFAULT_CHUNK,
): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const total = buffer.byteLength;
  let sent = 0;
  const start = Date.now();
  const id = `${start}-${Math.random().toString(36).slice(2, 8)}`;

  const waitForDrain = async () => {
    // If PeerJS buffer grows too large, yield until it drains a bit.
    while (conn.bufferSize && conn.bufferSize > 16 * 1024 * 50) {
      // 50KB threshold — tune as needed
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  // send metadata
  const meta: FileMeta = { type: "meta", id, name: file.name, size: file.size };
  conn.send(meta);

  for (let offset = 0; offset < total; offset += chunkSize) {
    const chunk = buffer.slice(offset, offset + chunkSize);
    const payload: FileChunk = { type: "chunk", id, chunk };

    await waitForDrain();
    conn.send(payload);

    sent += (chunk as ArrayBuffer).byteLength;
    const elapsed = Math.max((Date.now() - start) / 1000, 0.001);
    const bps = sent / elapsed;
    onProgress?.(Math.floor((sent / total) * 100), bps);
  }

  const done: FileDone = { type: "done", id };
  conn.send(done);
  return id;
};

/**
 * Set up file receive handlers on a DataConnection. Calls `onFile` when a full file is reassembled.
 */
export const setupFileReceiver = (
  conn: { on: (ev: string, cb: (data: any) => void) => void },
  onFile: (file: {
    id: string;
    name: string;
    size: number;
    blob: Blob;
  }) => void,
  onProgress?: (percent: number) => void,
) => {
  // For large files, stream to a WritableStream if available, else fallback to array
  const files = new Map<
    string,
    {
      name?: string;
      size?: number;
      received: number;
      chunks?: ArrayBuffer[];
      streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
      streamChunks?: number;
      streamBlobParts?: BlobPart[];
    }
  >();

  conn.on("data", async (data: any) => {
    if (!data || typeof data !== "object") return;

    if (data.type === "meta") {
      const meta = data as FileMeta;
      // Try to use a WritableStream (if supported)
      let streamWriter: WritableStreamDefaultWriter<Uint8Array> | undefined =
        undefined;
      let streamBlobParts: BlobPart[] | undefined = undefined;
      if (typeof window !== "undefined" && (window as any).WritableStream) {
        // Use BlobPart[] for streaming assembly (works in all browsers)
        streamBlobParts = [];
      }
      files.set(meta.id, {
        name: meta.name,
        size: meta.size,
        received: 0,
        chunks: streamBlobParts ? undefined : [],
        streamWriter,
        streamChunks: 0,
        streamBlobParts,
      });
      return;
    }

    if (data.type === "chunk") {
      const c = data as FileChunk;
      const entry = files.get(c.id);
      if (!entry) return;
      // Integrity: check chunk is ArrayBuffer
      if (!(c.chunk instanceof ArrayBuffer)) return;
      entry.received += c.chunk.byteLength;
      if (entry.streamBlobParts) {
        entry.streamBlobParts.push(new Uint8Array(c.chunk));
      } else if (entry.chunks) {
        entry.chunks.push(c.chunk);
      }
      entry.streamChunks = (entry.streamChunks || 0) + 1;
      if (entry.size && onProgress) {
        onProgress(Math.floor((entry.received / entry.size) * 100));
      }
      files.set(c.id, entry);
      return;
    }

    if (data.type === "done") {
      const d = data as FileDone;
      const entry = files.get(d.id);
      if (!entry) return;
      let blob: Blob;
      if (entry.streamBlobParts) {
        blob = new Blob(entry.streamBlobParts);
      } else if (entry.chunks) {
        blob = new Blob(entry.chunks);
      } else {
        // Should not happen
        return;
      }
      onFile({
        id: d.id,
        name: entry.name ?? "file",
        size: entry.size ?? blob.size,
        blob,
      });
      files.delete(d.id);
      return;
    }
  });
};

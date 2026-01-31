// src/lib/peer.ts
import Peer, { DataConnection } from "peerjs";

export const createPeer = (id: string): Peer => {
  return new Peer(id, {
    host: "0.peerjs.com",
    port: 443,
    secure: true,
  });
};

export const sendFile = async (
  file: File,
  conn: DataConnection,
  onProgress?: (percent: number, speed?: number) => void,
): Promise<string> => {
  const CHUNK_SIZE = 32 * 1024; // 32KB chunks
  const buffer = await file.arrayBuffer();
  const total = buffer.byteLength;
  let sent = 0;
  const start = Date.now();
  const id = `${start}-${Math.random().toString(36).slice(2, 8)}`;

  // send metadata with stable id
  conn.send({
    type: "meta",
    id,
    name: file.name,
    size: file.size,
  });

  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
    // send chunk along with id so receiver can map chunks to files reliably
    conn.send({ type: "chunk", id, chunk });
    sent += (chunk as ArrayBuffer).byteLength;

    const elapsed = (Date.now() - start) / 1000 || 1;
    const bytesPerSec = sent / elapsed; // bytes per second
    const percent = Math.floor((sent / total) * 100);
    onProgress?.(percent, bytesPerSec);
  }

  // finalise
  conn.send({ type: "done", id });
  return id;
};

// src/lib/peer.ts
import Peer, { DataConnection } from "peerjs";

/**
 * Create a PeerJS Peer with sensible ICE defaults and runtime logging.
 *
 * To provide TURN servers for restrictive networks, set the environment
 * variable `NEXT_PUBLIC_TURN_SERVERS` to a JSON array of RTCIceServer objects
 * (e.g. `[ { "urls": "turn:turn.example.com:3478", "username": "user", "credential": "pass" } ]`).
 */
export const createPeer = (
  id: string,
  extraIceServers?: RTCIceServer[],
): Peer => {
  const defaultIce: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

  // Read TURN servers from NEXT_PUBLIC_TURN_SERVERS (build-time replacement in Next.js).
  let envTurnServers: RTCIceServer[] | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (process as any)?.env?.NEXT_PUBLIC_TURN_SERVERS;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) envTurnServers = parsed;
    }
  } catch (e) {
    // ignore parse errors; fall back to defaults
    // console.warn is intentionally omitted to avoid noisy logs if not used
  }

  const peer = new Peer(id, {
    host: "0.peerjs.com",
    port: 443,
    secure: true,
    config: {
      iceServers: [
        // STUN (free, always add this)
        {
          urls: "stun:stun.l.google.com:19302",
        },

        // TURN (ExpressTurn - your credentials)
        {
          urls: "turn:free.expressturn.com:3478",
          username: "efPU52K4SLOQ34W2QY",
          credential: "1TJPNFxHKXrZfelz",
        },

        // TURN over TCP (helps on strict networks / mobile)
        {
          urls: "turn:free.expressturn.com:3478?transport=tcp",
          username: "efPU52K4SLOQ34W2QY",
          credential: "1TJPNFxHKXrZfelz",
        },
      ],
    },
  });

  // Attach lightweight runtime logging to help diagnose connectivity issues
  peer.on("open", (openId) => console.info("Peer open:", openId));
  peer.on("error", (err) => console.error("Peer error:", err));
  peer.on("disconnected", () => console.warn("Peer disconnected"));
  peer.on("close", () => console.warn("Peer closed"));

  peer.on("connection", (conn: DataConnection) => {
    console.info("Incoming connection from:", conn.peer);
    conn.on("open", () => console.info("DataConnection open:", conn.peer));
    conn.on("close", () => console.warn("DataConnection closed:", conn.peer));
    conn.on("error", (err) => console.error("DataConnection error:", err));
  });

  return peer;
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

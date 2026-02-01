// src/app/room/[roomId]/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "react-qr-code";
import { createPeer, sendFile } from "@/lib/peer";
import { FileTransfer } from "@/types";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, getDoc, setDoc } from "firebase/firestore";

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const receivedChunks = useRef<Record<string, (ArrayBuffer | Uint8Array)[]>>(
    {},
  );
  const pendingQueue = useRef<File[]>([]);

  const [peerId, setPeerId] = useState("");
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [origin, setOrigin] = useState("");
  const [sendFiles, setSendFiles] = useState<FileTransfer[]>([]);
  const [receiveFiles, setReceiveFiles] = useState<FileTransfer[]>([]);

  useEffect(() => {
    setOrigin(window.location.origin);
    const id = `peer-${Math.random().toString(36).slice(2, 9)}`;
    setPeerId(id);

    const peer = createPeer(id);
    peerRef.current = peer;

    peer.on("open", async () => {
      console.log("Peer ready:", id);

      // Try to claim host slot if none set in Firestore
      try {
        const roomRef = doc(db, "rooms", roomId!);
        const snap = await getDoc(roomRef);
        const data = snap.exists() ? snap.data() : null;
        if (!data || !data.hostPeerId) {
          await setDoc(roomRef, { hostPeerId: id }, { merge: true });
          setHostPeerId(id);
        } else {
          setHostPeerId(data.hostPeerId || null);
        }
      } catch (err) {
        console.warn("Failed to claim host or read room:", err);
      }
    });

    peer.on("connection", (conn: any) => {
      connRef.current = conn;
      // set up handlers; wait for open event to mark as connected
      conn.on("open", () => {
        setConnected(true);
        // flush any pending files
        if (pendingQueue.current.length > 0) {
          const files = [...pendingQueue.current];
          pendingQueue.current = [];
          files.forEach((f) => sendFileWrapper(f));
        }
      });
      conn.on("data", handleReceive);
    });
  }, []);

  const handleReceive = (data: any) => {
    // Robust handling: support structured messages with type field
    if (data && typeof data === "object" && "type" in data) {
      if (data.type === "meta") {
        const file: FileTransfer = {
          id: data.id,
          name: data.name,
          size: data.size,
          progress: 0,
          speed: 0,
          receivedBytes: 0,
        };
        setReceiveFiles((prev) => [...prev, file]);
        receivedChunks.current[data.id] = [];
      } else if (data.type === "chunk") {
        const id = data.id;
        const chunk = data.chunk as ArrayBuffer | Uint8Array;
        if (!receivedChunks.current[id]) receivedChunks.current[id] = [];
        receivedChunks.current[id].push(chunk);
        const chunksSnapshot = receivedChunks.current[id] || [];

        setReceiveFiles((prev) =>
          prev.map((f) => {
            if (f.id === id && !f.done) {
              const received = chunksSnapshot.reduce(
                (a, b) => a + (b as ArrayBuffer).byteLength,
                0,
              );
              const progress = Math.floor((received / f.size) * 100);
              const startTs = parseInt(id.split("-")[0]) || Date.now();
              const elapsed = (Date.now() - startTs) / 1000 || 1;
              const bytesPerSec = Math.floor(received / elapsed);
              return {
                ...f,
                progress,
                speed: bytesPerSec,
                receivedBytes: received,
              };
            }
            return f;
          }),
        );
      } else if (data.type === "done") {
        const id = data.id;
        const chunks = receivedChunks.current[id] || [];
        const blob = buildBlobFromChunks(chunks);
        setReceiveFiles((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, blob, progress: 100, done: true } : f,
          ),
        );
        delete receivedChunks.current[id];
      }
    } else {
      // fallback for raw ArrayBuffer chunks (older implementations)
      const ids = Object.keys(receivedChunks.current);
      if (ids.length === 0) return;
      const id = ids[ids.length - 1];
      const chunk = data as ArrayBuffer | Uint8Array;
      // normalize to ArrayBuffer or Uint8Array
      const normalized =
        chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (!receivedChunks.current[id]) receivedChunks.current[id] = [];
      receivedChunks.current[id].push(normalized);
      const chunksSnapshot = receivedChunks.current[id] || [];
      setReceiveFiles((prev) =>
        prev.map((f) => {
          if (f.id === id && !f.done) {
            const received = chunksSnapshot.reduce(
              (a, b) => a + (b as ArrayBuffer).byteLength,
              0,
            );
            const progress = Math.floor((received / f.size) * 100);
            return { ...f, progress, receivedBytes: received };
          }
          return f;
        }),
      );
    }
  };

  const formatSpeed = (bytesPerSec?: number) => {
    if (!bytesPerSec || bytesPerSec <= 0) return "—";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let i = 0;
    let val = bytesPerSec;
    while (val >= 1024 && i < units.length - 1) {
      val = val / 1024;
      i++;
    }
    return `${val.toFixed(val < 10 ? 2 : val < 100 ? 1 : 0)} ${units[i]}`;
  };

  const buildBlobFromChunks = (chunks: (ArrayBuffer | Uint8Array)[]) => {
    if (!chunks || chunks.length === 0) return new Blob([]);
    const total = chunks.reduce(
      (a, c) =>
        a +
        (c instanceof Uint8Array
          ? c.byteLength
          : (c as ArrayBuffer).byteLength),
      0,
    );
    const tmp = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      const view =
        c instanceof Uint8Array ? c : new Uint8Array(c as ArrayBuffer);
      tmp.set(view, offset);
      offset += view.byteLength;
    }
    return new Blob([tmp]);
  };

  // Watch room doc for host peer id changes
  useEffect(() => {
    const roomRef = doc(db, "rooms", roomId!);
    const unsub = onSnapshot(roomRef, (snap) => {
      const data = snap.exists() ? (snap.data() as any) : null;
      const host = data?.hostPeerId ?? null;
      setHostPeerId(host);

      // auto-connect to host if available and not self
      if (host && peerRef.current && host !== peerId && !connected) {
        tryConnect(host);
      }
    });

    return () => unsub();
  }, [roomId, peerId]);

  const connectToPeer = () => {
    const remoteId = prompt("Enter peer ID");
    if (!remoteId || !peerRef.current) return;
    const conn = peerRef.current.connect(remoteId);
    connRef.current = conn;
    setConnected(true);
    conn.on("data", handleReceive);
  };

  const tryConnect = (remoteId: string) => {
    if (!peerRef.current) return;
    try {
      const conn = peerRef.current.connect(remoteId);
      connRef.current = conn;
      conn.on("open", () => {
        setConnected(true);
        // flush pending
        if (pendingQueue.current.length > 0) {
          const files = [...pendingQueue.current];
          pendingQueue.current = [];
          files.forEach((f) => sendFileWrapper(f));
        }
      });
      conn.on("data", handleReceive);
    } catch (err) {
      console.warn("Failed to connect to host:", err);
    }
  };

  const sendFileWrapper = async (file: File) => {
    const conn = connRef.current;
    // create a UI entry for this file
    const uiId = `${file.name}-${Date.now()}`;
    setSendFiles((prev) => [
      ...prev,
      { name: file.name, size: file.size, progress: 0, speed: 0, id: uiId },
    ]);

    try {
      const id = await sendFile(file, conn, (percent, speed) => {
        setSendFiles((prev) =>
          prev.map((f) =>
            f.id === uiId ? { ...f, progress: percent, speed: speed ?? 0 } : f,
          ),
        );
      });
      // mark done
      setSendFiles((prev) =>
        prev.map((f) =>
          f.id === uiId ? { ...f, progress: 100, done: true } : f,
        ),
      );
      return id;
    } catch (err) {
      console.error("send failed", err);
      setSendFiles((prev) =>
        prev.map((f) => (f.id === uiId ? { ...f, progress: 0 } : f)),
      );
      return null;
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // if connection is ready, send immediately; otherwise queue
      if (connRef.current && connRef.current.open) {
        void sendFileWrapper(file);
      } else {
        pendingQueue.current.push(file);
      }
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto bg-gradient-to-br from-blue-900 to-blue-700 text-white rounded-lg shadow-lg">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Room</h1>
          <p className="text-sm text-blue-200">ID: {roomId}</p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-right">
            <div className="text-xs text-blue-200">Your Peer ID</div>
            <div className="font-mono text-sm">{peerId}</div>
          </div>

          <div className="flex flex-col space-y-2">
            <button
              onClick={() => navigator.clipboard?.writeText(roomId!)}
              className="px-3 py-1 bg-white/10 rounded text-sm"
            >
              Copy ID
            </button>
            <button
              onClick={() =>
                navigator.clipboard?.writeText(`${origin}/room/${roomId}`)
              }
              className="px-3 py-1 bg-white/10 rounded text-sm"
            >
              Copy Link
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: actions + sending queue */}
        <section className="bg-white/5 p-4 rounded">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Send Files</h2>
            <div className="text-sm">
              {connected ? (
                <span className="text-green-300">Connected</span>
              ) : (
                <span className="text-yellow-200">Not connected</span>
              )}
            </div>
          </div>

          <input
            type="file"
            multiple
            onChange={onFileSelect}
            className="w-full p-2 rounded bg-white/10"
          />

          <div className="mt-4 space-y-2 max-h-60 overflow-auto">
            {sendFiles.length === 0 && (
              <div className="text-sm text-blue-200">No outgoing transfers</div>
            )}
            {sendFiles.map((f) => (
              <div key={f.id} className="p-3 bg-white/2 rounded">
                <div className="flex items-center justify-between">
                  <div className="text-sm">{f.name}</div>
                  <div className="text-xs text-blue-200">{f.progress}%</div>
                </div>
                <div className="w-full bg-gray-800 h-2 rounded mt-2 ring-1 ring-blue-800/40">
                  <div
                    className="bg-gradient-to-r from-blue-600 to-blue-400 h-2 rounded shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                    style={{ width: `${f.progress}%` }}
                  />
                </div>
                <div className="text-xs text-blue-200 mt-1">
                  {formatSpeed(f.speed)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right: receive list + QR/link */}
        <section className="bg-white/5 p-4 rounded">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Receive</h2>
            <div className="text-sm text-blue-200">
              Host: {hostPeerId ?? "—"}
            </div>
          </div>

          <div className="mb-4 flex items-center space-x-4">
            {origin && (
              <div className="bg-white p-2 rounded">
                {<QRCode value={`${origin}/room/${roomId}`} />}
              </div>
            )}
            <div className="text-sm text-blue-200">
              Share this link or QR to let others join.
            </div>
          </div>

          <div className="space-y-2 max-h-60 overflow-auto">
            {receiveFiles.length === 0 && (
              <div className="text-sm text-blue-200">No incoming transfers</div>
            )}
            {receiveFiles.map((f) => (
              <div key={f.id} className="p-3 bg-white/2 rounded">
                <div className="flex items-center justify-between">
                  <div className="text-sm">{f.name}</div>
                  <div className="text-xs text-blue-200">{f.progress}%</div>
                </div>
                <div className="w-full bg-gray-800 h-2 rounded mt-2 ring-1 ring-blue-800/30">
                  <div
                    className="bg-gradient-to-r from-blue-700 to-blue-400 h-2 rounded shadow-[0_0_8px_rgba(37,99,235,0.6)]"
                    style={{ width: `${f.progress}%` }}
                  />
                </div>
                <div className="text-xs text-blue-200 mt-1">
                  {formatSpeed(f.speed)}
                </div>
                {f.blob && (
                  <a
                    href={URL.createObjectURL(f.blob)}
                    download={f.name}
                    className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-blue-900/60 rounded text-sm ring-1 ring-blue-700/40"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12 3v12"
                        stroke="#93C5FD"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M8 11l4 4 4-4"
                        stroke="#93C5FD"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M21 21H3"
                        stroke="#60A5FA"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

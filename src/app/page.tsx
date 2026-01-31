// src/app/page.tsx
"use client";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, addDoc, doc, getDoc } from "firebase/firestore";
import { useEffect, useState, useRef } from "react";

export default function HomePage() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let detector: any = null;
    let rafId: number;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if ((window as any).BarcodeDetector) {
          detector = new (window as any).BarcodeDetector({
            formats: ["qr_code"],
          });
        }

        const tick = async () => {
          try {
            if (detector && videoRef.current) {
              const detections = await detector.detect(videoRef.current);
              if (detections && detections.length > 0) {
                handleScanResult(detections[0].rawValue);
                return;
              }
            }
          } catch (e) {
            // ignore
          }
          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
      } catch (e) {
        setScanError("Camera access denied or not available.");
      }
    };

    if (scanning) start();

    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (rafId) cancelAnimationFrame(rafId);
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {}
      }
    };
  }, [scanning]);

  const handleScanResult = async (value: string) => {
    setScanning(false);
    try {
      const url = new URL(value);
      if (url.origin !== window.location.origin) {
        setScanError("Invalid QR code origin");
        return;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "room" || !parts[1]) {
        setScanError("QR code not a room link");
        return;
      }
      const rid = parts[1];
      const roomRef = doc(db, "rooms", rid);
      const snap = await getDoc(roomRef);
      if (!snap.exists()) {
        setScanError("Room does not exist");
        return;
      }
      router.push(`/room/${rid}`);
    } catch (e) {
      setScanError("Invalid QR code");
    }
  };

  const createRoom = async () => {
    const docRef = await addDoc(collection(db, "rooms"), {
      createdAt: Date.now(),
    });
    router.push(`/room/${docRef.id}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-blue-900 to-blue-700 text-white">
      <div className="w-full max-w-md bg-white/5 p-6 rounded-xl shadow-lg text-center">
        <h2 className="text-3xl font-extrabold mb-2">Share It</h2>
        <p className="text-blue-200 mb-4">
          Send or receive files directly — mobile friendly.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={createRoom}
            className="w-full px-6 py-3 bg-blue-600 rounded-md text-white font-semibold flex items-center justify-center gap-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 5v14"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 12h14"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Create Room
          </button>

          <div className="flex gap-2">
            <input
              id="room-input"
              type="text"
              placeholder="Enter room ID"
              className="flex-1 px-4 py-2 rounded bg-white/10 text-white placeholder-blue-200"
              onKeyDown={(e) =>
                e.key === "Enter" &&
                router.push(`/room/${(e.target as HTMLInputElement).value}`)
              }
            />
            <button
              onClick={() => {
                const el = document.getElementById(
                  "room-input",
                ) as HTMLInputElement | null;
                if (el && el.value) router.push(`/room/${el.value}`);
              }}
              className="px-4 py-2 bg-white/10 rounded"
            >
              Join
            </button>
          </div>

          <button
            onClick={() => {
              setScanError(null);
              setScanning(true);
            }}
            className="w-full px-4 py-2 bg-white/10 rounded flex items-center justify-center gap-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="3"
                y="3"
                width="6"
                height="6"
                rx="1"
                stroke="#fff"
                strokeWidth="2"
              />
              <rect
                x="15"
                y="3"
                width="6"
                height="6"
                rx="1"
                stroke="#fff"
                strokeWidth="2"
              />
              <rect
                x="3"
                y="15"
                width="6"
                height="6"
                rx="1"
                stroke="#fff"
                strokeWidth="2"
              />
              <rect
                x="15"
                y="15"
                width="6"
                height="6"
                rx="1"
                stroke="#fff"
                strokeWidth="2"
              />
            </svg>
            Scan QR
          </button>

          {scanning && (
            <div className="mt-4">
              <video ref={videoRef} className="w-full rounded" />
              {scanError && (
                <div className="text-sm text-red-300 mt-2">{scanError}</div>
              )}
              <div className="mt-2 flex justify-between">
                <button
                  onClick={() => setScanning(false)}
                  className="px-3 py-2 bg-white/10 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-blue-200 mt-4">
          Tip: Use your phone camera to scan the recipient's QR.
        </p>
      </div>
    </div>
  );
}

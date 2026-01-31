// src/types/index.ts
export interface FileTransfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  speed: number;
  blob?: Blob;
  done?: boolean;
  receivedBytes?: number;
}

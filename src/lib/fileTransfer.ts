export interface FileMeta {
  type: "meta";
  name: string;
  size: number;
}

export const sendFile = async (
  file: File,
  conn: any,
  onProgress?: (percent: number) => void,
): Promise<void> => {
  const chunkSize = 16 * 1024; // 16KB
  const buffer = await file.arrayBuffer();
  const totalSize = buffer.byteLength;
  let sent = 0;

  // send file metadata first
  conn.send({
    type: "meta",
    name: file.name,
    size: file.size,
  });

  // send chunks
  for (let i = 0; i < buffer.byteLength; i += chunkSize) {
    const chunk = buffer.slice(i, i + chunkSize);
    conn.send(chunk);

    sent += chunk.byteLength;
    if (onProgress) {
      onProgress(Math.floor((sent / totalSize) * 100));
    }
  }

  // signal done
  conn.send({ type: "done" });
};

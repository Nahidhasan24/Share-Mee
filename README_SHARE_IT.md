Share It — Usage

Simple peer-to-peer file sharing demo built on PeerJS and Firebase Firestore for minimal signaling.

Quick usage

1. Install dependencies:

```bash
npm install
```

2. Run the dev server:

```bash
npm run dev
```

3. Open the app, click "Create Room" on one device and open the room link on another.

Notes

- This app uses PeerJS for direct P2P transfers and Firestore only to store a `hostPeerId` in the room document for simple discovery.
- Transfers send metadata and numbered chunks so multiple concurrent transfers are handled reliably.
- If connections fail, check browser console for PeerJS logs and ensure both peers can reach the PeerJS signaling server.

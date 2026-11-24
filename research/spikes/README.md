# Spikes (Eraser-like tool research)
Each folder is independent: `cd <dir> && npm i && npm run build|start`. No node_modules committed.
- excalidraw/ tldraw/ : Vite+React embed. `npm run build`, then `npx vite preview --host 127.0.0.1` for a headless browser check.
- dsl/ : hand-written parser -> ELK.js layered layout -> SVG. `npm start` writes out.svg (git-ignored).
- yjs/ : two in-memory Y.Docs, offline edits, convergence check. `npm start`.

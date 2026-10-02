# Build Room local demo

Plays the whole Build Room story in a real browser on your machine, with no AWS
account. The script runs a host, three phones and Claude, where Claude is the real
`src/public/engage-mcp.mjs` speaking MCP over stdio. It writes a screenshot of
each step and a transcript of everything Claude saw.

```bash
cd src && npm run build && cd ..                # the frontend the demo serves
node scripts/build-room-demo/server.js &        # http://localhost:8790
node scripts/build-room-demo/e2e.js /tmp/build-room-shots
```

- `server.js` serves `src/dist`. Its fake API is backed by the **real**
  `lambda-functions/game/build-room.js` over an in-memory table, and it stubs
  the few platform routes a phone needs to join (create, start, join, state).
- `host.js` signs in a fake host. It writes an unsigned ID token into
  localStorage and answers Cognito's `GetUser` call in the browser. The
  browser never verifies the signature; the real API would.
- There is no WebSocket server, so pages show "Offline" and catch up with their
  8–10 second poll. This is expected.

Run the `@playwright/test` scripts from the repo root, so `@playwright/test`
resolves. Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` in the
Claude Code container. Edit `executablePath` in `host.js` and `e2e.js` for your
machine.

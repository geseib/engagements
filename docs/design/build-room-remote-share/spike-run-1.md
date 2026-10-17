# Spike run 1 (owner's MacBook, 16 Oct 2026, 19:56 UTC): summary

The full report was pasted into the session; this keeps what the second run and SPIKE.md need.

- **cloudflared 2026.10.1** (published 2026-10-15). SHA-256 computed on the laptop matched GitHub's digest for all five assets:
  - `cloudflared-darwin-arm64.tgz` 647615df99d49cd179ea5e13ef760b9bbfb33630f6ae62f87e33dfadda60adcc (19807806 bytes)
  - `cloudflared-darwin-amd64.tgz` 3b0dbaf378337e9d7fb6cd235a76d1d6a7dee434c2d8edf9281164fb6a3837ab (21768449)
  - `cloudflared-linux-amd64` 3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586 (40227032)
  - `cloudflared-linux-arm64` 2c65dfabf616c40efc7545d107d7a57ad5e21377e2964b7e88af19a238074a46 (37651992)
  - `cloudflared-windows-amd64.exe` 4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6 (55325120)
- **The address line** is on **stderr**, about 5.2 to 6.2 s after start, inside a box:
  `2026-10-16T19:57:33Z INF |  https://interim-lonely-rate-even.trycloudflare.com    |`
  `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/` finds it. The box's first line says "it may take some time to be reachable".
- **Four at once, reopened three times within ~3.5 min:** 4/4 addresses every round. No refusal, no rate-limit line.
- **Registered** a QUIC connection (`location=den01`) ~5 s after the address; pre-checks all passed (UDP and TCP to `region1/2.v2.argotunnel.com`, `api.cloudflare.com`).
- **But the laptop never reached its own tunnels:** `getaddrinfo ENOTFOUND <name>.trycloudflare.com` for 60 s on the single tunnel and on 12 of 16 in the rounds (2 of 4 answered in rounds 2 and 4). The script asked the laptop's resolver within a second of the address appearing; the likely cause is that a "no such name" answer was given before the name existed and then remembered. Not yet proven. So websocket, headers and the down-origin answer were **not measured**.

Second run: the script now asks Cloudflare's public DNS over https until the name exists, connects to that address directly, and asks the laptop's resolver once afterwards.

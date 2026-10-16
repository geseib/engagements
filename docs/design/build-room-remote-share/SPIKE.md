# Remote share, Task 0: what a quick tunnel really does

Two runs of `spike.mjs` on the owner's MacBook (darwin arm64, Node 22.23), 16 Oct 2026.
Run 1 at 19:56 UTC (summary: `spike-run-1.md`); run 2 at 20:10 UTC, **on airplane Wi-Fi**
(`172.19.1.136` is the plane's network, not a VPN). Plan:
`docs/superpowers/plans/2026-10-16-build-room-remote-share.md`, Task 0.

## The pinned version

`cloudflared` **2026.10.1**, published 2026-10-15. Both runs computed the same SHA-256 for
every asset, and each matched GitHub's own digest:

| Asset | Bytes | SHA-256 |
|---|---|---|
| `cloudflared-darwin-arm64.tgz` | 19807806 | `647615df99d49cd179ea5e13ef760b9bbfb33630f6ae62f87e33dfadda60adcc` |
| `cloudflared-darwin-amd64.tgz` | 21768449 | `3b0dbaf378337e9d7fb6cd235a76d1d6a7dee434c2d8edf9281164fb6a3837ab` |
| `cloudflared-linux-amd64` | 40227032 | `3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586` |
| `cloudflared-linux-arm64` | 37651992 | `2c65dfabf616c40efc7545d107d7a57ad5e21377e2964b7e88af19a238074a46` |
| `cloudflared-windows-amd64.exe` | 55325120 | `4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6` |

The macOS `.tgz` holds one file, `cloudflared`. `--version` prints
`cloudflared version 2026.10.1 (built 2026-10-15-17:08 UTC)`.

## The address line

On **stderr**, 5.2 to 6.2 s after start (all 30 openings), inside a box:

```
2026-10-16T20:12:04Z INF |  https://window-jpg-you-quiet.trycloudflare.com          |
```

`/https:\/\/[a-z0-9-]+\.trycloudflare\.com/` finds it. A refused request prints instead
`quick tunnel provisioning failed with status 429` and the process **exits 1** before
any address.

## The address is not usable when it is printed

| | Run 2, one tunnel | Run 2, rounds of four |
|---|---|---|
| Address printed | 5.8 s | ≤ 5.5 s |
| Name in public DNS (1.1.1.1) | +12.2 s | +6.8 to 7.1 s (slowest of four) |
| Then answered 200 | +2.4 s | all four |

Run 1 asked the **laptop's own resolver** within a second of the address appearing and got
"no such name" for 60 s on almost every tunnel (4 of 16 eventually answered). Run 2 waited
on public DNS first, and afterwards the laptop's resolver answered at once. So run 1's
failures were the early "no such name" being remembered, not a network block.

**Consequence for the build:** the plugin must not report remote as live when the address
is printed. It waits until Cloudflare's public DNS (DNS over https) has the name and one
request through the tunnel answers, and never asks the laptop's resolver first. Only then
does any phone get a link. Expect about **15 to 20 s** from switch-on to live.

## Through a tunnel

- **Websocket upgrade:** 101, passed through (hot reload works).
- **Headers the app receives:** `cdn-loop`, `cf-connecting-ip`, `cf-ew-via`, `cf-ipcountry`,
  `cf-ray`, `cf-visitor`, `cf-warp-tag-id`, `cf-worker`, `x-forwarded-for`,
  `x-forwarded-proto`. None is used to decide anything (spec §5).
- **App down:** the visitor gets Cloudflare's **502** "error code: 502"; `cloudflared` logs
  `Unable to reach the origin service`. In the product the remote gateway is the origin, so
  the visitor gets the gateway's own words instead, as on Wi-Fi.

## How many tunnels Cloudflare allows

| Run | Network | Openings | Result |
|---|---|---|---|
| 1 | home/office | 17 over ~3.5 min | all got an address |
| 2 | airplane Wi-Fi | 13 over ~85 s, then 4 more | the last 4 refused: **429** |

There is a limit on creating quick tunnels. It is not per laptop in an obvious way: run 2
hit it after fewer openings in less time, on a network shared by a whole plane. The likeliest
reading, not proven, is a limit per public address over a short window. A conference or
company network, where a room shares one address, could meet it too.

Four at once was never refused. **Reopening** is what costs.

## What changes in the build

1. **Ready means reachable** (above): public-DNS check plus one request before reporting live.
2. **Never reopen a tunnel without need.** It is opened when remote turns on and closed when
   it turns off or the session ends. A change in what Claude shows does not reopen it.
3. **A 429 is its own failure,** in plain words: "Cloudflare is not giving out new remote
   links from this network right now. Try again in a few minutes." No automatic retry
   faster than once a minute.
4. **Fewer tunnels:** proposed to the owner, 16 Oct (one tunnel per session, pointed at
   the newest thing Claude showed, instead of one per shared address). Pending.

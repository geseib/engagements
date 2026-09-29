// Does a real browser get a WebSocket to the WS API from here?  node ws-probe.js [wssUrl]
// Prints OPEN or ERROR (with the handshake status). Run BEFORE planning a drive.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const WS = process.argv[2] || 'wss://h8ipndmk4d.execute-api.us-east-1.amazonaws.com/dev?gameId=0000&playerName=Probe';
(async () => { const b = await chromium.launch(); const p = await b.newPage(); const c = await p.context().newCDPSession(p);
  await c.send('Network.enable'); c.on('Network.webSocketFrameError', (e) => console.log('handshake:', e.errorMessage));
  await p.goto(process.env.ENGAGE_BASE || 'https://engage.dev.seibtribe.us/join');
  console.log(await p.evaluate((u) => new Promise((res) => { const w = new WebSocket(u); w.onopen = () => { res('OPEN'); w.close(); }; w.onerror = () => res('ERROR'); setTimeout(() => res('TIMEOUT'), 10000); }), WS));
  await b.close(); })();

// Local demo harness (not shipped). See README.md.
const { spawn } = require('child_process');
const path = require('path');
function mcp(key, extraEnv = {}) {
  const child = spawn('node', [path.join(__dirname, '..', '..', 'src/public/engage-mcp.mjs')], { env: { ...process.env, ENGAGE_API: 'http://localhost:8790/api/', ENGAGE_KEY: key, ENGAGE_POLL_MS: '500', ...extraEnv } });
  let buf = ''; const waiting = new Map(); let id = 0;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const req = (method, params) => new Promise((res) => { id += 1; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return {
    init: () => req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'harness', version: '1' } }),
    call: async (name, args) => { const r = await req('tools/call', { name, arguments: args }); return (r.result.content || []).map((c) => c.text).join('\n') + (r.result.isError ? '\n[isError]' : ''); },
    close: () => child.kill(),
  };
}
module.exports = { mcp };

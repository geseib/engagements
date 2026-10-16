// Dev player bot: node bot.js join <gameId> <name> | answer <gameId> <name> <round> <text> | vote <gameId> <name> <round> <a,b,c>
const API = 'https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev/';
const WS = 'wss://h8ipndmk4d.execute-api.us-east-1.amazonaws.com/dev';
const [cmd, gameId, name, round, arg] = process.argv.slice(2);
const clientId = `bot-${name}-cid`;

(async () => {
  if (cmd === 'join') {
    const r = await fetch(`${API}games/${gameId}/players`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, clientId }),
    });
    console.log(r.status, (await r.text()).slice(0, 200));
  } else if (cmd === 'answer') {
    const ws = new WebSocket(`${WS}?gameId=${gameId}&playerName=${encodeURIComponent(name)}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'message', messageType: `ANSWER#${round}`, gameId, playerName: name, answer: arg, answerType: 'text' }));
      setTimeout(() => { ws.close(); console.log('sent'); }, 2500);
    };
    ws.onerror = (e) => { console.error('ws error', e.message); process.exit(1); };
  } else if (cmd === 'vote') {
    const [first, second, third] = arg.split(',').map(Number);
    const r = await fetch(`${API}games/${gameId}/votes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, clientId, questionNumber: round, votes: { [first]: 1, [second]: 2, [third]: 3 } }),
    });
    console.log(r.status, (await r.text()).slice(0, 200));
  } else if (cmd === 'comment') {
    const r = await fetch(`${API}games/${gameId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, clientId, questionNumber: round, anchorKind: 'summary', anchorRef: null, text: arg }),
    });
    console.log(r.status, (await r.text()).slice(0, 300));
  } else if (cmd === 'ask') {
    const [askId, value] = arg.split('|');
    const r = await fetch(`${API}games/${gameId}/followup-play/asks/${askId}/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, clientId, value, round }),
    });
    console.log(r.status, (await r.text()).slice(0, 300));
  } else if (cmd === 'own') {
    const r = await fetch(`${API}games/${gameId}/answers?question=${round}&player=${encodeURIComponent(name)}&clientId=${clientId}`);
    console.log(r.status, await r.text());
  }
})();

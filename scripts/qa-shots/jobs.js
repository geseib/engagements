module.exports = ({ F, HOST_VP, LAPTOP_VP, ROOM_VP, TWO, ONE, hostUrl, playUrl }) => {
  const S = F.scenario;
  const G_HOST = 'Host console: two screens (laptop 1512x945)';
  const G_ONE = 'Host: one screen (the laptop is the room\'s screen, 1512x945)';
  const G_ROOM = 'Room\'s screen /present (1920x1080)';
  const G_PHONE = 'Participant on a phone (iPhone 15, 393x659 viewport)';
  const G_LAP = 'Participant on a laptop (1512x945)';
  const host = (name, caption, scn, extra = {}) => ({ group: G_HOST, name, caption, host: true, url: hostUrl, viewport: HOST_VP, storage: TWO, scn, ...extra });

  const openSessionMenuPeople = async (page) => {
    await page.getByRole('button', { name: /Session menu/ }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole('tab', { name: /People/ }).or(page.getByRole('button', { name: /^People/ })).first().click();
  };

  const jobs = [
    host('host-00-lobby-0-unchosen', 'Lobby, nobody joined, a brand-new host (no screen choice stored, room\'s window not open)', S({ phase: 'lobby', joined: 0, presenting: 0 }), { storage: {} }),
    host('host-01-lobby-0', 'Lobby, nobody joined (two screens chosen, room\'s window open)', S({ phase: 'lobby', joined: 0 })),
    host('host-02-lobby-5', 'Lobby, 5 joined', S({ phase: 'lobby', joined: 5 })),
    host('host-03-answering-5', 'Answering: 5 players, 3 answered', S({ phase: 'ask', joined: 5, answered: 3 })),
    host('host-04-answering-15', 'Answering: 15 players, 9 answered', S({ phase: 'ask', joined: 15, answered: 9 })),
    host('host-05-voting-15', 'Voting: 15 players, 11 answers, 6 voted', S({ phase: 'vote', joined: 15, answered: 11, voted: 6 })),
    host('host-06-results', 'Results: the tally (15 players)', S({ phase: 'results', joined: 15, answered: 11, voted: 15 })),
    host('host-06b-what-we-heard', 'Results: What we heard (Workie\'s read)', S({ phase: 'results', joined: 15, answered: 11, voted: 15, beat: 'field-notes' })),
    host('host-07-session-menu-people', 'Session menu open on People (answering, 15 players)', S({ phase: 'ask', joined: 15, answered: 9 }), { act: openSessionMenuPeople }),

    { group: G_ONE, name: 'host-one-03-answering-5', caption: 'One screen: answering, 5 players, 3 answered', host: true, url: hostUrl, viewport: HOST_VP, storage: ONE, scn: S({ phase: 'ask', joined: 5, answered: 3, presenting: 0 }) },
    { group: G_ONE, name: 'host-one-02-lobby-5', caption: 'One screen: lobby, 5 joined', host: true, url: hostUrl, viewport: HOST_VP, storage: ONE, scn: S({ phase: 'lobby', joined: 5, presenting: 0 }) },
  ];

  for (const [m, cap] of [['lobby', 'Lobby (join code)'], ['answering', 'Answering'], ['voting', 'Voting'], ['tally', 'Results: tally'], ['read', 'Results: What we heard']]) {
    jobs.push({ group: G_ROOM, name: `present-${m}`, caption: `${cap} (existing scripts/skins fixture "${m}"; its code reads "${m}" because the fixture id is the moment)`, present: true, url: `/present?gameId=${m}`, viewport: ROOM_VP, wait: 2000 });
  }
  // The room's screen on THIS scenario, so the long detail and instruction show on the wall too.
  jobs.push({ group: G_ROOM, name: 'present-s-lobby', caption: 'Lobby, this scenario (5 joined)', url: `/present?gameId=${F.GAME}`, viewport: ROOM_VP, scn: S({ phase: 'lobby', joined: 5 }), wait: 2000 });
  jobs.push({ group: G_ROOM, name: 'present-s-voting', caption: 'Voting, this scenario (11 answers, 6 of 15 voted)', url: `/present?gameId=${F.GAME}`, viewport: ROOM_VP, scn: S({ phase: 'vote', joined: 15, answered: 11, voted: 6 }), wait: 2000 });
  jobs.push({ group: G_ROOM, name: 'present-s-results', caption: 'Results tally, this scenario', url: `/present?gameId=${F.GAME}`, viewport: ROOM_VP, scn: S({ phase: 'results', joined: 15, answered: 11, voted: 15 }), wait: 2000 });
  jobs.push({ group: G_ROOM, name: 'present-answering-long', caption: 'Answering, this scenario\'s question (long detail + instruction), 15 players, 9 answered', url: `/present?gameId=${F.GAME}`, viewport: ROOM_VP, scn: S({ phase: 'ask', joined: 15, answered: 9 }), wait: 2000 });

  const player = (dev, group, prefix) => {
    const base = dev ? { device: 'iPhone 15' } : { viewport: LAPTOP_VP };
    const me = 'Alex';
    const typeAnswer = async (page) => {
      const box = page.locator('textarea').first();
      await box.click();
      await box.fill('The Monday status call. Thirty people, an hour, and it repeats what the tracker already says.');
    };
    return [
      { group, name: `${prefix}-01-join`, caption: 'Join form (opened from the QR link)', url: playUrl(null), scn: S({ phase: 'lobby', joined: 5 }), ...base },
      { group, name: `${prefix}-02-lobby`, caption: 'Joined, waiting in the lobby', url: playUrl(me), scn: S({ phase: 'lobby', joined: 6, me }), ...base },
      { group, name: `${prefix}-03-answering`, caption: 'Answering: the question and the composer', url: playUrl(me), scn: S({ phase: 'ask', joined: 15, answered: 9, me }), ...base },
      { group, name: `${prefix}-03b-answering-typed`, caption: 'Answering: an answer typed, not yet sent', url: playUrl(me), scn: S({ phase: 'ask', joined: 15, answered: 9, me }), act: typeAnswer, ...base },
      { group, name: `${prefix}-04-sent`, caption: 'After sending', url: playUrl(me), scn: S({ phase: 'ask', joined: 15, answered: 10, me, myAnswered: true }), ...base },
      { group, name: `${prefix}-05-voting`, caption: 'Voting', url: playUrl(me), scn: S({ phase: 'vote', joined: 15, answered: 11, voted: 6, me, myAnswered: true }), ...base },
      { group, name: `${prefix}-06-results`, caption: 'Results', url: playUrl(me), scn: S({ phase: 'results', joined: 15, answered: 11, voted: 15, me, myAnswered: true, myVoted: true }), ...base },
    ];
  };
  jobs.push(...player(true, G_PHONE, 'player-phone'));
  jobs.push(...player(false, G_LAP, 'player-laptop'));
  return jobs;
};

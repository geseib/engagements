// Local demo harness (not shipped). See README.md.
const btns = async (p) => (await p.getByRole('button').allInnerTexts()).map((s) => s.replace(/\n/g, ' ')).join(' | ');
async function phone(browser, game, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PHONE PAGEERROR', e.message));
  await p.goto(`http://localhost:8790/play?gameId=${game}`);
  await p.waitForTimeout(1500);
  await p.locator('input:not([readonly])').first().fill(name);
  await p.getByRole('button', { name: /join|enter|go/i }).first().click();
  await p.waitForTimeout(2500);
  return p;
}
module.exports = { phone, btns };

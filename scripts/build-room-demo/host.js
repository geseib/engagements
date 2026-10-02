// Local demo harness (not shipped). See README.md.
const { chromium } = require('@playwright/test');
const OUT = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const idToken = `${b64({ alg: 'RS256', kid: 'x' })}.${b64({ sub: 'host-1', 'cognito:username': 'host', 'cognito:groups': ['hosts'], email: 'host@example.com', name: 'George', exp, iat: exp - 3600, token_use: 'id', aud: 'testclient' })}.sig`;
const accessToken = `${b64({ alg: 'RS256' })}.${b64({ sub: 'host-1', username: 'host', exp, iat: exp - 3600, token_use: 'access' })}.sig`;
async function hostPage(browser, w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([id, ac]) => {
    const p = 'CognitoIdentityServiceProvider.testclient';
    localStorage.setItem(`${p}.LastAuthUser`, 'host');
    localStorage.setItem(`${p}.host.idToken`, id);
    localStorage.setItem(`${p}.host.accessToken`, ac);
    localStorage.setItem(`${p}.host.refreshToken`, 'r');
    localStorage.setItem(`${p}.host.clockDrift`, '0');
  }, [idToken, accessToken]);
  await ctx.route(/cognito-idp/, (route) => route.fulfill({ status: 200, contentType: 'application/x-amz-json-1.1', body: JSON.stringify({ Username: 'host', UserAttributes: [{ Name: 'email', Value: 'host@example.com' }, { Name: 'name', Value: 'George' }, { Name: 'sub', Value: 'host-1' }] }) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  return page;
}
module.exports = { hostPage };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await hostPage(browser);
  await page.goto('http://localhost:8790/build');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/h01-create.png`, fullPage: true });
  console.log((await page.innerText('body')).slice(0, 600));
  await browser.close();
})();

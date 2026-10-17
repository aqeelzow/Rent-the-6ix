// Read-only live DB + local production UI acceptance. Existing worker playwright-core only.
// Start the standalone web server with AI_PROVIDER=none; pass SEARCH_BASE_URL if not :3042.
// PLAYWRIGHT_BROWSERS_PATH and LD_LIBRARY_PATH may point to isolated /tmp browser runtimes.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '../../../apps/worker/node_modules/playwright-core/index.mjs';
import postgres from '../../../apps/web/node_modules/postgres/src/index.js';

const base = process.env.SEARCH_BASE_URL ?? 'http://127.0.0.1:3042';
assert.ok(process.env.DATABASE_URL, 'load ignored apps/web/.env.local into the test process');
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice() {} });
const report = { checkedAt: new Date().toISOString(), scope: 'Local production branch, real read-only DB, AI_PROVIDER=none; not deployed acceptance', viewports: [], limitations: ['Map visibility timed out with external maps enabled in an earlier local headless Chromium run. Software WebGL was used; the cause is unresolved. This run aborts only external basemap requests.', 'Building UI remains a placeholder despite the optional API building contract; owner A follow-up remains open.', 'No live Gemini, OTP, deployment rollout, canvas pin interaction or screenshot acceptance is claimed. Resource console errors include expected map aborts and an unattributed 404; no clean-console claim.'] };
let browser;
try {
  const expected = await sql`SELECT id, title, monthly_rent_cad, bedrooms, unit_type FROM listings
    WHERE status='active' AND duplicate_of IS NULL AND monthly_rent_cad=2586
      AND bedrooms=3 AND unit_type='apartment' AND rent_is_per_room=false ORDER BY last_seen_at DESC,id`;
  assert.equal(expected.length, 2, 'narrow public-listing oracle must remain non-vacuous');
  report.oracle = { rent: 2586, bedrooms: 3, unitType: 'apartment', count: expected.length, ids: expected.map(r => r.id) };
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    await context.route(/https:\/\/(?:api\.maptiler\.com|tiles\.openfreemap\.org)\//, route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [], consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().replace(/https?:\/\/\S+/g, '[url]')); });
    page.on('pageerror', error => errors.push(error.message.replace(/https?:\/\/\S+/g, '[url]')));
    const result = { name, viewport, checks: {}, pageErrors: errors, consoleErrors };
    report.viewports.push(result);
    try {
      console.log(`${name}: landing`);
      await page.goto(base);
      await page.getByRole('textbox', { name: "Describe the place you're looking for" }).fill('3 bedroom apartments between $2586 and $2586');
      const initialResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/listings/search' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const initial = await initialResponse;
      assert.equal(initial.status(), 200);
      const initialData = await initial.json();
      assert.equal(initialData.status, 'completed');
      assert.deepEqual(new Set(initialData.results.map(r => r.listing.id)), new Set(expected.map(r => r.id)));
      for (const row of expected) await page.getByRole('link', { name: row.title, exact: true }).waitFor({ state: 'visible' });
      await page.getByText("AI wasn't used for this search.", { exact: false }).waitFor({ state: 'visible' });
      result.checks.landingParseAndLiveCards = true;
      const cards = page.getByRole('article');
      assert.equal(await cards.count(), expected.length);
      for (const row of initialData.results) {
        const card = cards.filter({ has: page.getByRole('link', { name: row.listing.title, exact: true }) });
        assert.ok((await card.innerText()).includes('$2,586'));
        await card.getByRole('img', { name: new RegExp(`${row.matchScore.total}`) }).waitFor({ state: 'visible' });
      }
      await page.getByRole('button', { name: /^Filters/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Filters', exact: true });
      await dialog.waitFor({ state: 'visible' });
      await dialog.getByRole('switch', { name: "Hide listings that don't confirm my must-haves" }).click();
      await dialog.getByRole('spinbutton', { name: 'Maximum Rent per month' }).fill('2585');
      const emptyResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/listings/search' && r.request().method() === 'POST');
      // Lower both ends to keep the numeric range valid and exclude both known matches.
      await dialog.getByRole('spinbutton', { name: 'Minimum Rent per month' }).fill('2585');
      await dialog.getByRole('button', { name: 'Show results', exact: true }).click();
      const empty = await emptyResponse;
      assert.equal(empty.status(), 200);
      assert.equal((await empty.json()).eligibleCount, 0);
      await page.getByText(/No listings match/).waitFor({ state: 'visible' });
      result.checks.filterAppliesAndEmptyState = true;
      await page.getByRole('button', { name: /^Filters/ }).click();
      await dialog.getByRole('spinbutton', { name: 'Minimum Rent per month' }).fill('2586');
      await dialog.getByRole('spinbutton', { name: 'Maximum Rent per month' }).fill('2586');
      await dialog.getByRole('textbox', { name: 'Add a place', exact: true }).fill('UofT');
      await dialog.getByRole('button', { name: 'Find', exact: true }).click();
      const choices = dialog.getByRole('group', { name: /Which one do you mean/ });
      await choices.getByRole('button', { name: /St\. George/ }).waitFor({ state: 'visible' });
      assert.equal(await choices.getByRole('button').count(), 3);
      await choices.getByRole('button', { name: /St\. George/ }).click();
      // A soft destination lets this check exercise missing routing honestly.
      const targetGroup = dialog.getByRole('listitem').filter({ has: page.getByRole('button', { name: /Remove.*St\. George/ }) });
      const targetHard = targetGroup.getByRole('switch', { name: 'Must-have', exact: true });
      if (await targetHard.getAttribute('aria-checked') === 'true') await targetHard.click();
      const restoredResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/listings/search' && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Show results', exact: true }).click();
      const restored = await restoredResponse;
      assert.equal(restored.status(), 200);
      const restoredData = await restored.json();
      assert.deepEqual(new Set(restoredData.results.map(r => r.listing.id)), new Set(expected.map(r => r.id)));
      const sent = restored.request().postDataJSON();
      assert.equal(sent.hideUnconfirmed, true);
      assert.equal(sent.intent.travelTargets.length, 1);
      assert.ok(sent.intent.travelTargets[0].resolved);
      result.checks.destinationChoicesAndSelection = true;
      console.log(`${name}: live cards, filters and campus choice passed`);
      for (const row of expected) await page.getByRole('link', { name: row.title, exact: true }).waitFor({ state: 'visible' });
      result.checks.liveMap = 'unverified; external basemap requests aborted for this run';
      const detailResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/listings/${expected[0].id}`);
      await page.getByRole('link', { name: expected[0].title, exact: true }).click();
      const detailHttp = await detailResponse;
      assert.equal(detailHttp.status(), 200);
      const detail = await detailHttp.json();
      assert.equal(detail.listing.id, expected[0].id);
      assert.ok(detail.areas.length > 0);
      await page.getByRole('heading', { name: expected[0].title, exact: true }).waitFor({ state: 'visible' });
      for (const section of ['Why it ranks here', 'Rent check', 'The home', 'Getting around', 'Building', 'The area', 'Things to check']) {
        await page.getByRole('heading', { name: section, exact: true }).waitFor({ state: 'attached' });
      }
      for (const area of detail.areas) await page.getByText(area.name, { exact: false }).waitFor({ state: 'attached' });
      result.checks.liveDetailAndCivicArea = true;
      console.log(`${name}: detail passed`);
      result.detailBuildingProvided = detail.building != null;
      result.buildingUiPlaceholder = (await page.locator('body').innerText()).includes('No RentSafeTO record');
      result.checks.safetyOptOut = await page.getByRole('heading', { name: 'Safety', exact: true }).count() === 0;
      assert.ok(result.checks.safetyOptOut);

      await page.getByRole('link', { name: 'Back to results', exact: true }).click();
      await page.getByRole('link', { name: expected[0].title, exact: true }).waitFor({ state: 'visible' });
      result.checks.backKeepsEditedFilters = true;
      assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    } catch (error) {
      result.failure = String(error.message).replace(/https?:\/\/\S+/g, '[url]');
      result.currentUrlPath = new URL(page.url()).pathname;
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  await sql.end({ timeout: 2 });
  await writeFile(new URL('./rendered-search-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));

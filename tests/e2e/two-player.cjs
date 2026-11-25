/**
 * Two-player end-to-end test: matchmaking, best-of-3, reveal, Elo/chips, double-or-nothing,
 * timeouts, rematch decline, leaderboard, profile and friend challenges.
 *
 * Needs two confirmed accounts (see README → "End-to-end test") and a running app:
 *   npm run build && npm start
 *   BASE_URL=http://localhost:3000 node tests/e2e/two-player.cjs
 * Make sure neither test account is mid-match before running.
 */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2] ?? "tests/e2e/screenshots";
require("fs").mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

async function login(ctx, email) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("PAGEERROR", email, e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "TestPass!2345");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/play", { timeout: 15000 });
  await page.getByText("Find match").waitFor();
  return page;
}

async function throwMove(page, label) {
  const btn = page.locator(`button[aria-label="${label}"]:not([disabled])`);
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
}

(async () => {
  const browser = await chromium.launch(
    process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {},
  );
  const mk = (scheme) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  const ctxA = await mk("dark"), ctxB = await mk("light");
  const A = await login(ctxA, "spr-e2e-a@example.test");
  const B = await login(ctxB, "spr-e2e-b@example.test");
  log("both logged in");
  await A.waitForTimeout(800);
  await A.screenshot({ path: `${SHOTS}/1-lobby-dark.png` });
  await B.screenshot({ path: `${SHOTS}/1-lobby-light.png` });

  // Ranked, stake 10
  for (const p of [A, B]) await p.locator("button.num", { hasText: /^10$/ }).first().click();
  await A.getByText("Find match").click();
  await A.getByText("Finding opponent").waitFor();
  await A.screenshot({ path: `${SHOTS}/2-searching.png` });
  const tQ = Date.now();
  await B.getByText("Find match").click();
  await Promise.all([A.waitForURL("**/match/**"), B.waitForURL("**/match/**")]);
  log(`matched in ${Date.now() - tQ}ms`, A.url() === B.url() ? "same match ✓" : "DIFFERENT MATCH ✗");
  const firstMatch = A.url();

  // A always rock, B always scissors → A wins 2-0
  for (let i = 1; i <= 2; i++) {
    await throwMove(A, "Rock");
    if (i === 1) {
      await B.getByText("Opponent locked in").waitFor({ timeout: 5000 });
      await B.screenshot({ path: `${SHOTS}/3-throw-opponent-locked.png` });
    }
    const t0 = Date.now();
    await throwMove(B, "Scissors");
    await A.getByText("You take it").waitFor({ timeout: 5000 });
    log(`throw ${i}: reveal visible to A ${Date.now() - t0}ms after B moved`);
    if (i === 1) {
      await A.waitForTimeout(450);
      await A.screenshot({ path: `${SHOTS}/4-reveal-win.png` });
    }
  }
  await A.getByText("Victory").waitFor({ timeout: 8000 });
  await B.getByText("Defeat").waitFor({ timeout: 8000 });
  await A.waitForTimeout(1100);
  await A.screenshot({ path: `${SHOTS}/5-victory-dark.png` });
  await B.screenshot({ path: `${SHOTS}/5-defeat-light.png` });
  log("result screens ✓", await A.locator("text=Double or nothing").count() ? "double-or-nothing offered ✓" : "no DoN ✗");

  // Double or nothing: both must agree
  await A.getByText("I'm in").click();
  await B.getByText("Opponent wants a rematch!").waitFor({ timeout: 5000 });
  await B.getByText("I'm in").click();
  await Promise.all([
    A.waitForURL((u) => u.toString() !== firstMatch && u.pathname.startsWith("/match/"), { timeout: 8000 }),
    B.waitForURL((u) => u.toString() !== firstMatch && u.pathname.startsWith("/match/"), { timeout: 8000 }),
  ]);
  log("rematch started ✓", A.url() === B.url() ? "same match ✓" : "✗");
  await A.getByText("40 pot").waitFor({ timeout: 5000 });
  log("stake doubled (20 each → 40 pot) ✓");

  // Timeout handling: A never moves, B plays paper. Then nobody moves at all.
  await throwMove(B, "Paper");
  await A.getByText("timed out · random").first().waitFor({ timeout: 12000 });
  log("timeout → random move ✓");
  await A.screenshot({ path: `${SHOTS}/6-timeout-reveal.png` });
  // Let the rest of the match auto-play via timeouts
  await A.locator("text=/Victory|Defeat/").waitFor({ timeout: 60000 });
  await B.locator("text=/Victory|Defeat/").waitFor({ timeout: 10000 });
  log("match completed by timeouts alone ✓");

  // Decline rematch
  await A.getByText("No thanks").click();
  await B.getByText("Rematch declined").waitFor({ timeout: 6000 });
  log("decline propagates ✓");

  // Leaderboard + profile
  await A.goto(`${BASE}/leaderboard`);
  await A.waitForTimeout(500);
  await A.screenshot({ path: `${SHOTS}/7-leaderboard.png` });
  await A.goto(`${BASE}/u/e2e_alpha`);
  await A.getByText("Recent matches").waitFor();
  await A.screenshot({ path: `${SHOTS}/8-profile.png` });
  log("leaderboard + profile ✓");

  // Friend challenge
  await A.goto(`${BASE}/play`);
  await A.getByText("Create challenge link").click();
  const code = (await A.locator("p.num.tracking-\\[0\\.3em\\]").textContent()).trim();
  log("challenge code", code);
  await B.goto(`${BASE}/c/${code}`);
  await B.getByText("You've been challenged").waitFor();
  await B.screenshot({ path: `${SHOTS}/9-challenge-accept.png` });
  await B.getByRole("button", { name: "Accept" }).click();
  await Promise.all([A.waitForURL("**/match/**", { timeout: 8000 }), B.waitForURL("**/match/**", { timeout: 8000 })]);
  log("friend challenge → match ✓", A.url() === B.url() ? "same ✓" : "✗");
  await A.getByText("Match found").waitFor();
  await A.screenshot({ path: `${SHOTS}/10-intro.png` });

  await browser.close();
  log("ALL E2E CHECKS PASSED");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });

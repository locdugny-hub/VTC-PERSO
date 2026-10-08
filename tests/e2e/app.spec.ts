// Parcours PWA dans Chromium (moteur différent de Safari iOS : à revalider sur iPhone).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const WIDTHS = [320, 375, 390, 430];

async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `débordement horizontal ${r.sw} > ${r.cw}`).toBeLessThanOrEqual(r.cw);
}

async function setup(page: Page) {
  await page.goto('/#/reglages/couts');
  await page.fill('[name=name]', 'Test');
  await page.selectOption('[name=energy]', 'hybride');
  await page.fill('[name=cons]', '5');
  await page.fill('[name=price]', '1,8');
  await page.fill('[name=maint]', '0,11');
  await page.fill('[name=fixed]', '800');
  await page.fill('[name=hours]', '160');
  await page.fill('[name=other]', '0');
  await page.click('button[type=submit]');
  await expect(page.locator('main p', { hasText: 'Version 1' })).toContainText('v = 0,200 €/km');
  await page.goto('/#/reglages/seuils');
  await page.selectOption('[name=level]', 'margin');
  await page.fill('[name=km]', '0,8');
  await page.fill('[name=h]', '18');
  await page.click('button[type=submit]');
  await expect(page.locator('main p', { hasText: 'Version 1 :' })).toBeVisible();
  await page.goto('/#/reglages/plateformes');
  await page.selectOption('[name=uber-basis]', 'net_driver');
  await page.check('[name=uber-ok]');
  await page.selectOption('[name=bolt-basis]', 'net_driver');
  await page.check('[name=bolt-ok]');
  await page.click('button[type=submit]');
  await expect(page.locator('#toast')).toContainText('Bases des prix enregistrées');
}

test('parcours complet : réglages, analyse, historique, statut, bilan, export', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/#/session');
  await page.click('[data-act=copy-config]');
  const cfg = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(cfg.configId).toMatch(/^cfg-/);
  expect(cfg.cost.variablePerKm).toBeCloseTo(0.2, 10);
  expect(cfg.cost.fixedPerHour).toBe(5);
  await expect(page.locator('text=à jour dans le raccourci')).toBeVisible();
  await page.fill('#ocrText', 'UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)');
  await page.click('[data-act=analyze]');
  await expect(page.locator('.result-title')).toContainText('Favorable · 19,23 €/h marge');
  await page.click('[data-act=save-manual]');
  await page.goto('/#/historique');
  await page.click('.list a');
  await page.click('[data-status=acceptee]');
  page.once('dialog', (d) => d.accept('12,50'));
  await page.click('[data-status=realisee]');
  await expect(page.locator('text=course réalisée')).toBeVisible();
  // Correction après coup : l'original reste
  await page.fill('[name=tripMin]', '30');
  await page.click('#corr button[type=submit]');
  await expect(page.locator('text=Analyse corrigée')).toBeVisible();
  await page.goto('/#/bilan');
  await expect(page.locator('.period').first()).toContainText('12,50 €');
  await noHorizontalOverflow(page);
  await page.goto('/#/reglages/donnees');
  const dl = page.waitForEvent('download');
  await page.click('[data-act=export]');
  const file = await (await dl).path();
  const json = JSON.parse(readFileSync(file!, 'utf8'));
  expect(json.format).toBe('vtcperso-backup');
  expect(json.summary.totals.tripRevenue).toBe(12.5);
  // Persistance après rechargement
  await page.reload();
  await page.goto('/#/historique');
  await expect(page.locator('.list li')).toHaveCount(1);
});

for (const w of WIDTHS) {
  test(`mise en page ${w} px : aucun débordement, cibles tactiles >= 44 px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 740 });
    await page.goto('/#/reglages/donnees');
    await page.click('[data-act=demo]');
    await expect(page.locator('.banner.demo')).toBeVisible();
    for (const route of ['#/session', '#/historique', '#/bilan', '#/reglages', '#/reglages/couts', '#/reglages/seuils', '#/reglages/parcours', '#/reglages/raccourci', '#/reglages/mesures', '#/reglages/donnees', '#/reglages/plateformes', '#/reglages/ia', '#/reglages/compte']) {
      await page.goto('/' + route);
      await page.waitForSelector('main .card');
      await noHorizontalOverflow(page);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('main .btn, nav.tabs a, main input:not([type=checkbox]):not([hidden]), main select')]
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => ({ t: (e as HTMLElement).innerText || (e as HTMLInputElement).name, h: e.getBoundingClientRect().height }))
          .filter((x) => x.h < 44),
      );
      expect(small, `${route} : éléments trop petits`).toEqual([]);
    }
  });
}

test('paysage 844x390 : navigation accessible', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/#/bilan');
  await noHorizontalOverflow(page);
  await expect(page.locator('nav.tabs a').nth(3)).toBeVisible();
});

test('zoom autorisé (pas de maximum-scale) et champs à 16 px', async ({ page }) => {
  await page.goto('/#/reglages/couts');
  const vp = await page.getAttribute('meta[name=viewport]', 'content');
  expect(vp).not.toMatch(/maximum-scale|user-scalable=no/);
  const fs = await page.evaluate(() => getComputedStyle(document.querySelector('input')!).fontSize);
  expect(fs).toBe('16px');
});

test('hors connexion après préparation : lancement et analyse locale', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/#/session');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // la page est désormais contrôlée par le service worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.brand')).toContainText('VTC Perso');
  await expect(page.locator('#status')).toContainText('Hors connexion');
  await page.fill('#ocrText', 'Bolt\n24,30 €\nPrise en charge · 3 min · 1,1 km\nDestination · 25 min · 15,2 km');
  await page.click('[data-act=analyze]');
  await expect(page.locator('.result-title')).toContainText('Favorable');
  const r = await page.evaluate(() => fetch('./VTCPerso.js').then((x) => x.status));
  expect(r).toBe(200); // script du raccourci disponible hors connexion
  await context.setOffline(false);
});

test('démonstration séparée des données personnelles', async ({ page }) => {
  await page.goto('/#/reglages/donnees');
  await page.click('[data-act=demo]');
  await expect(page.locator('.banner.demo')).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Préparation' })).toBeVisible();
  await page.goto('/#/historique');
  await page.selectOption('[data-f=period]', 'all');
  expect(await page.locator('.list li').count()).toBeGreaterThan(5);
  await page.goto('/#/reglages/donnees');
  await page.click('[data-act=leave-demo]');
  await expect(page.locator('.banner.demo')).toHaveCount(0);
  await page.goto('/#/historique');
  await page.selectOption('[data-f=period]', 'all');
  await expect(page.locator('.list li')).toHaveCount(0);
});

import { test, expect } from '@playwright/test';

test('depuración: el cartel en móvil', async ({ page }) => {
  const errores = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push('excepción: ' + e.message));

  await page.goto('/becas.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.beca').first()).toBeVisible({ timeout: 30_000 });

  const estado = await page.evaluate(() => ({
    fichas: document.querySelectorAll('.beca').length,
    zona: (document.querySelector('#zona-lista')?.textContent || '').trim().slice(0, 80),
    buscar: !!document.querySelector('#buscar'),
    botonRect: (() => { const b = document.querySelector('#buscar'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    encima: (() => { const b = document.querySelector('#buscar'); if (!b) return null; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? e.tagName + '.' + e.className : null; })(),
  }));

  await page.locator('#buscar').click();
  await page.waitForTimeout(700);

  const despues = await page.evaluate(() => ({
    cartel: !!document.querySelector('.buscando'),
    titulo: !!document.querySelector('.buscando-h'),
    zona: (document.querySelector('#zona-lista')?.textContent || '').trim().slice(0, 80),
    fichas: document.querySelectorAll('.beca').length,
  }));

  console.log('ESTADO:', JSON.stringify({ estado, despues, errores }, null, 2));
});

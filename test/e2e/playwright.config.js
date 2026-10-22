import { defineConfig } from '@playwright/test';

/**
 * Configuración de Playwright.
 *
 * Va dentro de `test/` a propósito: esa carpeta no se despliega (está en
 * `.vercelignore`) y así no hay ni un fichero de pruebas en la web pública.
 *
 * El puerto es el 5174 y no el 5173 porque el 5173 lo usa el servidor de
 * desarrollo que suele estar abierto mientras se trabaja. `reuseExistingServer`
 * hace que, si ya hay uno escuchando, no se levante otro.
 */
const PUERTO = process.env.PUERTO ?? '5174';

export default defineConfig({
  testDir: '.',
  // Los márgenes son-generosos a propósito. Una prueba que se queda sin
  // tiempo no dice qué falla: dice que el equipo va lento, que es otra
  // cosa. Con el equipo cargado —un navegador abierto, una ingesta, tres
  // Measurements— una carga de la base de datos puede tardar medio minuto.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Uno a uno: el servidor de desarrollo es un único proceso y las pruebas
  // miden la misma base de datos. En paralelo, dos búsquedas a la vez se
  // pisan y los fallos no dicen nada de lo que pasa.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results',

  use: {
    baseURL: `http://localhost:${PUERTO}`,
    // El Chrome del sistema, no el que descarga Playwright: ya está en la
    // máquina y es el mismo que se usa para medir a mano. Con `channel:
    // 'chrome'` no hace falta `npx playwright install` para poder probar.
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },

  projects: [
    {
      name: 'movil',
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'escritorio',
      use: { viewport: { width: 1280, height: 900 } },
    },
  ],

  webServer: {
    // La ruta es relativa a este fichero: el comando se lanza desde `test/e2e`.
    //
    // `BS_SIN_ENV` es la pieza que mantiene el alta fuera de la base real:
    // sin él, serve.mjs carga .env.local y las cuentas de estas pruebas
    // (@ejemplo.es) nacen en Supabase, con la fila de sesiones y el aviso de
    // avisos incluidos. El modo fichero es el que describe la cabecera de
    // cuenta.spec.js, así que aquí se garantiza.
    command: `BS_SIN_ENV=1 node ../../serve.mjs ${PUERTO}`,
    url: `http://localhost:${PUERTO}`,
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'ignore',
  },
});

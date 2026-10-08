import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', locale: 'fr-FR', timezoneId: 'Europe/Paris', launchOptions: { executablePath: process.env.PW_CHROMIUM ?? undefined } },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true },
});

import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

/** Génère sw.js avec la liste exacte des fichiers du build et une version dérivée de leur contenu. */
function serviceWorker(): Plugin {
  return {
    name: 'vtcperso-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      // Le script Scriptable est servi pour téléchargement (et disponible hors connexion).
      if (existsSync('shortcut/dist/VTCPerso.js')) {
        this.emitFile({ type: 'asset', fileName: 'VTCPerso.js', source: readFileSync('shortcut/dist/VTCPerso.js', 'utf8') });
      }
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const statics = ['manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'docs/RACCOURCI.html', 'docs/GUIDE.html'];
      const list = ['./', './index.html', ...[...new Set([...files, ...statics, 'VTCPerso.js'])].filter((f) => f !== 'index.html').map((f) => './' + f)];
      const h = createHash('sha256');
      for (const f of files) {
        const it = bundle[f];
        h.update(f);
        h.update(it.type === 'chunk' ? it.code : typeof it.source === 'string' ? it.source : Buffer.from(it.source));
      }
      const version = pkg.version + '-' + h.digest('hex').slice(0, 10);
      const tpl = readFileSync('src/sw/sw-template.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list, null, 1));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: tpl });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'safari15', outDir: 'dist', sourcemap: false, assetsInlineLimit: 0 },
  plugins: [serviceWorker()],
});

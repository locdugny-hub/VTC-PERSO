// Construit shortcut/dist/VTCPerso.js (script Scriptable autonome) et
// supabase/functions/_shared/vtc-core.js (même moteur pour les fonctions serveur),
// ainsi que public/vtc-core.js (même moteur pour le composant natif via JavaScriptCore).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
mkdirSync('shortcut/dist', { recursive: true });

const res = await build({
  entryPoints: ['shortcut/scriptable-entry.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'VTCPersoBundle',
  target: 'es2019',
  write: false,
  legalComments: 'none',
});
const code = res.outputFiles[0].text;
const sha = createHash('sha256').update(code).digest('hex').slice(0, 12);
const header = `// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: car;
// VTC Perso — script du parcours rapide (version ${pkg.version}, build ${sha}).
// Généré automatiquement. Source : shortcut/scriptable-entry.ts. Licence : usage personnel.
`;
writeFileSync('shortcut/dist/VTCPerso.js', header + code + '\nawait VTCPersoBundle.main();\n');
console.log('shortcut/dist/VTCPerso.js', (code.length / 1024).toFixed(1), 'Ko, build', sha);

// Moteur seul, ESM, pour Deno (Supabase Edge Functions).
mkdirSync('supabase/functions/_shared', { recursive: true });
await build({ entryPoints: ['src/core/index.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'supabase/functions/_shared/vtc-core.js', legalComments: 'none' });
writeFileSync('supabase/functions/_shared/vtc-core.d.ts', "export * from '../../../src/core/index';\n");

// Moteur seul, IIFE global "VTCCore", pour JavaScriptCore (composant natif iOS).
mkdirSync('native/VTCPerso/Resources', { recursive: true });
await build({ entryPoints: ['src/core/index.ts'], bundle: true, format: 'iife', globalName: 'VTCCore', target: 'es2019', outfile: 'native/VTCPerso/Resources/vtc-core.js', legalComments: 'none' });
console.log('supabase/functions/_shared/vtc-core.js et native/VTCPerso/Resources/vtc-core.js générés');

# VTC Perso

Outil personnel pour analyser une offre Uber ou Bolt (France) **pendant que l'application chauffeur reste affichée**, puis suivre son historique et ses bilans.

> **Statut** : prototype complet, testé hors iPhone. **Parcours principal non encore validé sur iPhone.** Voir `docs/BILAN.md`.

## Comment ça marche
- **Pendant la conduite**, une pression sur AssistiveTouch lance le raccourci « VTC Analyse » :
  1. capture de l'écran ;
  2. lecture du texte par l'OCR d'Apple ;
  3. calcul local dans Scriptable avec vos coûts et seuils ;
  4. bannière, par exemple « ✅ Favorable · 19,23 €/h marge », et annonce vocale brève.

  Rien n'est accepté ni refusé automatiquement.
- **En option (iOS 27)** : l'app native ScreenCaptureKit vise zéro action par offre. Le code source est livré mais **non compilé**.
- **La PWA** (Netlify) sert aux réglages, sessions, historique, corrections, bilans, exports, ainsi qu'à la synchronisation Supabase et aux fonctions Gemini facultatives.

## Documents
| Document | Contenu |
|---|---|
| `docs/GUIDE.md` | Installer, démarrer une session, sauvegarder |
| `docs/RACCOURCI.md` | Construction exacte du raccourci et d'AssistiveTouch |
| `docs/INSTALLATION.md` | Netlify, Supabase, Google OAuth, Gemini (0 €) |
| `docs/VALIDATION_IPHONE.md` | Protocole de preuve sur iPhone (30 essais par plateforme, corpus réel) |
| `docs/ETUDE_TECHNIQUE.md` | Capacités iOS vérifiées, offres gratuites, place de Gemini, sources |
| `docs/ARCHITECTURE.md` | Composants, contrats de données, sécurité |
| `docs/BILAN.md` | Réalisé, testé, limites, configuration restante |
| `native/README.md` | Composant natif et ses contraintes |

## Arborescence
```
src/core/        moteur pur partagé (finances, verdict, parseurs, historique, bilans, sauvegarde, synchronisation)
src/app/         PWA (Vite + TypeScript, IndexedDB, service worker)
shortcut/        script Scriptable (source + dist/VTCPerso.js généré)
supabase/        migration SQL + RLS, Edge Functions device-api et ai, tests SQL
native/          app iOS 27 ScreenCaptureKit (Swift, non compilée) + pont JavaScriptCore
tools/           test-db.sh, latency-report.mjs, corpus-eval.mjs, gemini-bench.mjs, banc OCR synthétique
tests/           Vitest (unitaires, intégration) + Playwright (tests/e2e)
validation/      formats des mesures et du corpus à remplir
```

## Commandes
```
npm ci
npm test                         # 100 tests
bash tools/test-db.sh            # SQL + RLS + quotas sur PostgreSQL 16 local
npm run build                    # bundles partagés + PWA dans dist/
npx playwright test              # PWA dans Chromium (320 à 430 px, hors connexion)
node tools/latency-report.mjs validation/mesures.csv
node tools/corpus-eval.mjs validation/corpus --jeu validation
```

## Avertissement
Outil d'analyse personnel : il ne constitue ni un conseil fiscal ou juridique, ni une recommandation garantie. Aucune affiliation avec Uber ou Bolt. Les montants « marge » et « solde » sont des estimations fondées sur vos hypothèses.

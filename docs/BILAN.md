# Bilan honnête au 08/10/2026

## En une phrase
Le parcours en une pression (AssistiveTouch, capture, OCR Apple, calcul local, notification et voix) est construit et testé hors iPhone. **Il n'a pas encore été validé sur votre iPhone 12 Pro Max** : l'application n'est donc pas présentée comme terminée. Le protocole `docs/VALIDATION_IPHONE.md` est la prochaine étape.

## Réalisé
| Livrable | Emplacement |
|---|---|
| **Moteur financier déterministe** : P, D, T, ratios, marge, commission, verdict, fraîcheur | `src/core/finance.ts`, `verdict.ts`, `analyze.ts` |
| **Parseurs Uber et Bolt (France)** : ancres, unités, ambiguïtés, provenance | `src/core/parse.ts` |
| **Script Scriptable** du raccourci (bundle autonome, même moteur) | `shortcut/dist/VTCPerso.js` |
| Procédure exacte de construction du raccourci et réglage d'AssistiveTouch | `docs/RACCOURCI.md` |
| **PWA « VTC Perso »** : Session, Historique, Bilan, Réglages, test guidé, corrections, export CSV et JSON, démo fictive séparée, hors connexion | `src/app`, `public`, `index.html` |
| Configuration Netlify (cache, sécurité) | `netlify.toml` |
| **Supabase** : schéma, RLS, synchronisation, jetons d'appareil, quotas IA | `supabase/migrations` |
| **Fonctions serveur** `device-api` (raccourci) et `ai` (Gemini protégé) | `supabase/functions` |
| Intégrations Gemini codées : explication, résumé de bilan, lecture de justificatif, incohérences, aide, extraction en diagnostic | `supabase/functions/_shared/ai.ts`, vues PWA |
| **Composant natif « zéro action »** (ScreenCaptureKit, iOS 27) et compilation en ligne | `native/`, `.github/workflows` |
| Outils de validation : corpus réel, latence vidéo, étude comparative Gemini | `tools/` |
| Exemples de configuration sans secrets | `.env.example`, `supabase/functions/.env.example` |
| Dépendances verrouillées | `package-lock.json` |

## Testé ici (exécuté)
| Test | Résultat |
|---|---|
| **Tests unitaires et d'intégration** (Vitest) | **100 réussis**. Ils couvrent : les cas financiers obligatoires du cahier ; le verdict ; les parseurs (formats, masquage, ambiguïtés, unités, heures, comptes à rebours) ; les corrections ; l'import du journal ; la sauvegarde et la restauration (données, relations, totaux) ; la synchronisation avec coupures et conflits ; IndexedDB ; les fonctions serveur avec dépendances simulées ; le pont natif JavaScript |
| **Script Scriptable généré**, exécuté avec des API Scriptable simulées | Contrat du raccourci, configuration absente, invalide ou modifiée, résultat périmé, requête retardée, test fictif non journalisé, synchronisation hors ligne puis en ligne |
| **Base PostgreSQL 16 locale**, avec une simulation du schéma auth de Supabase | RLS avec deux comptes (lecture, modification, changement de propriétaire), accès anonyme refusé, jetons hachés et révoqués, limite de débit, ingestion idempotente, quotas IA. **20 appels simultanés pour une limite de 10 : exactement 10 acceptés** |
| **PWA dans Chromium** (Playwright) | 320, 375, 390 et 430 px sans débordement horizontal ; cibles tactiles d'au moins 44 px ; paysage ; zoom autorisé ; parcours complet ; **lancement hors connexion** puis analyse locale ; démo séparée |
| Fonctions Deno | Vérification de types réussie (`deno check`) |
| **Revue de code indépendante** | 2 défauts critiques et 8 majeurs relevés, **tous corrigés** et couverts par des tests de non-régression |

## Simulé seulement
- **Banc OCR synthétique** : 80 images d'offres fictives, OCR Tesseract.
  - Résultat : 385 champs sur 400 corrects, 15 inconnus, **0 valeur fausse** ; 62 offres non masquées sur 63 entièrement lues.
  - Ce banc ne mesure ni l'OCR d'Apple ni de vraies offres Uber ou Bolt.
- **Temps de calcul du script sous Node** : p50 ≈ 3 ms, p95 ≈ 5 ms. C'est un ordre de grandeur, **pas une mesure iPhone**.

## Restant à valider sur iPhone (rien de ceci n'est prouvé)
1. AssistiveTouch qui lance le raccourci ; capture de l'app chauffeur (non noire) ; absence de dialogue après « Toujours autoriser ».
2. Fonctionnement de Scriptable 1.7.19 sous votre version d'iOS. Si ce n'est pas le cas : variante serveur ou a-Shell.
3. Formats réels des offres Uber et Bolt : **les ancres des parseurs sont des hypothèses** à confronter à au moins 150 captures par plateforme, dont 100 inédites.
4. **Temps de réponse** de la pression jusqu'au verdict visible ou annoncé, mesuré en vidéo. Cibles : médiane ≤ 1 s et 95 % des essais ≤ 2 s. **Non mesuré. Le raccourci ajoute un délai propre à iOS qui peut empêcher d'atteindre la seconde.**
5. Visibilité réelle des bannières (concentration Conduite) et de la voix pendant le guidage.
6. Mode natif : compilation, signature gratuite de 7 jours, comportement en arrière-plan sous iOS 27, capture d'Uber et de Bolt, batterie.
7. PWA sous Safari iOS : installation depuis l'écran d'accueil, hors connexion et persistance d'IndexedDB. Seul Chromium a été testé ici.

## Limites connues
- **Pas d'action automatique sur l'offre**, par conception.
- Une bannière de Raccourcis reste dans le Centre de notifications, mais n'est pas réaffichée après expiration. Le titre indique l'heure de capture.
- **Synchronisation** : le dernier écrivain gagne, enregistrement par enregistrement. Deux modifications simultanées d'une même offre sur deux appareils ne fusionnent pas : la plus récente l'emporte.
- **Les fonctions IA n'ont jamais appelé Gemini.** Aucune clé ne vous a été demandée. Leur logique est testée avec un faux service. L'étude comparative reste à lancer sur votre corpus avec `tools/gemini-bench.mjs`.
- L'iPhone 7 (iOS 15, puce A10) ne peut pas faire le parcours rapide.
- Gratuité : Netlify met les sites en pause à 300 crédits par mois (environ 20 déploiements) ; Supabase met le projet en pause après 7 jours d'inactivité et n'a pas de sauvegarde automatique ; la clause EEE de Gemini est à lire. Aucun fournisseur ne garantit la gratuité dans la durée.

## Configuration restante (à faire par vous)
1. Déployer la PWA sur Netlify (`docs/INSTALLATION.md`, section 1). Aucun accès à votre compte n'a été utilisé, donc aucun lien n'est encore en ligne.
2. Facultatif : projet Supabase, migration, connexion Google, fonctions serveur (section 2).
3. Facultatif : clé Gemini sur un projet **sans facturation** (section 3).
4. Installer Scriptable, construire le raccourci et régler AssistiveTouch (`docs/RACCOURCI.md`).
5. Exécuter le protocole `docs/VALIDATION_IPHONE.md`, puis renvoyer `validation/mesures.csv` et les résultats de `corpus-eval` pour ajuster les parseurs.

# Architecture et contrats de données

```
 iPhone (conduite)                                     Netlify (HTTPS gratuit)       Supabase (gratuit)
 ┌───────────────────────────────────────────────┐    ┌──────────────────────┐      ┌───────────────────────────┐
 │ Uber/Bolt au premier plan                     │    │ PWA VTC Perso        │      │ Auth (Google)             │
 │  AssistiveTouch ─► Raccourci « VTC Analyse »  │    │  réglages, session,  │◄────►│ Postgres + RLS            │
 │   capture ─► OCR Apple ─► Scriptable          │    │  historique, bilans  │ sync │  sync_push / sync_pull    │
 │   (moteur local + config locale)              │    │  IndexedDB (local)   │      │ Edge Functions :          │
 │   ─► notification + voix                      │    │  service worker      │      │  device-api (jeton)       │
 │   ─► journal local (JSONL) ──────────────────────► import ou sync ────────────────►  ai (JWT) ─► Gemini API  │
 └───────────────────────────────────────────────┘    └──────────────────────┘      └───────────────────────────┘
```

Le **même moteur** (`src/core`) est exécuté par :
- la PWA ;
- le script Scriptable (`shortcut/dist/VTCPerso.js`) ;
- les fonctions serveur (`supabase/functions/_shared/vtc-core.js`) ;
- le composant natif via JavaScriptCore (`native/VTCPerso/Resources/vtc-core.js`).

Les trois copies sont générées par `npm run build:bundles`.

## A. Composant opérationnel (parcours rapide)
- **Entrée du script** : dictionnaire `{mode:"analyze", text, t0}`. `t0` est la date de début du raccourci, au format ISO avec millisecondes.
- **Sortie** : `{show, speak, title, body, speech, id, verdict, configId}`. Si `title` est vide, rien n'est affiché (résultat périmé ou remplacé).
- **Configuration** : fichier local `Scriptable/vtcperso/config.json`, importé une fois depuis la PWA par le presse-papiers.
  - Elle est versionnée par une empreinte (`cfg-xxxxxxxx`) et son intégrité est vérifiée.
  - Elle reste utilisable hors connexion.
  - Le raccourci **n'accède jamais à IndexedDB**.
- **Concurrence et fraîcheur** :
  - `latest.json` est écrit au début de chaque analyse ; un résultat plus ancien que la dernière requête n'est pas affiché.
  - Fraîcheur : `validUntil = t0 + min(échéance lue, fraîcheur configurée)`, 10 s par défaut.
- **Journal** : un fichier JSONL par jour, avec des lignes `analysis` (l'analyse complète, sans texte OCR brut) et `timing`. La file `pending.json` contient ce qui reste à envoyer au serveur.

## B. PWA
- **Stockage** : IndexedDB, avec une base par espace.
  - `local` : sans compte ;
  - `u-<id>` : compte ;
  - `demo` : données fictives.
  - Les données de deux comptes ne se mélangent jamais sur un même appareil.
- **Profils versionnés et immuables** : véhicule, coûts, seuils. Chaque analyse conserve ses valeurs (`input`, `thresholdValues`) : modifier un réglage ne change pas les analyses passées.
- **Statuts d'offre** : Analysée, Acceptée, Refusée, Annulée, Réalisée, Encaissée. Une recette n'existe que sous forme de **course** (`TripRec`) avec un montant **saisi et confirmé**.
- **Corrections** : l'analyse d'origine est conservée. L'analyse corrigée est recalculée avec les mêmes hypothèses, et la provenance du champ devient `manual`.
- **Bilans** : recettes confirmées moins dépenses réelles de la période.
  - Le temps d'activité vient des horodatages de session, attente comprise et pauses exclues.
  - Les ratios se calculent sur les totaux.
  - Une session est rattachée au jour de son début.
- **Hors connexion** : le service worker met en cache la coquille, le script Scriptable et les guides. Les appels Supabase et Gemini ne sont jamais mis en cache.

## C. Backend Supabase
- **Tables** : `vehicles`, `cost_profiles`, `thresholds`, `offers`, `trips`, `sessions`, `expenses`, `settings`.
  - Clé primaire : `(user_id, id)`, plus `data jsonb` et quelques colonnes typées.
  - `updated_at` est l'horodatage client ; `server_seq` est une séquence serveur.
  - RLS sur toutes les tables, avec propriété vérifiée par `auth.uid()`.
- **Synchronisation**, au niveau de chaque enregistrement :
  - Le dernier écrivain gagne, avec des pierres tombales pour les suppressions.
  - Une entrée de la file d'attente n'est retirée qu'après accusé de réception de la version envoyée.
  - Le curseur avance seulement après application du lot, avec un recouvrement de 50 numéros.
  - L'envoi est idempotent grâce aux identifiants stables.
- **Jetons d'appareil** :
  - stockés hachés en SHA-256 et illisibles par le client ;
  - 5 jetons actifs au maximum, limités à 30 requêtes par minute, révocables ;
  - portées `ingest` et `analyze`.
- **Fonctions serveur** :
  - `device-api` : jeton d'appareil ; `/ingest` (idempotent), `/analyze` (variante serveur).
  - `ai` : JWT vérifié dans la fonction avec `getClaims` ; quota atomique par jour et par utilisateur, plus un quota global ; une relance au plus ; arrêt sur 429.
- **Clés** : le navigateur n'a que l'URL et la clé publiable. Les clés secrètes Supabase et Gemini restent dans les secrets des fonctions.

## Données transmises
| Action | Données envoyées | Destination |
|---|---|---|
| Analyse en conduite (mode B) | **Aucune**, tout est local | — |
| Variante serveur B' | Texte OCR de l'écran, qui peut contenir des adresses | Votre fonction Supabase. Le texte brut n'est pas stocké, seule l'analyse l'est |
| Synchronisation | Enregistrements structurés (offres analysées, courses, dépenses, sessions, réglages) | Votre projet Supabase |
| IA : explication ou résumé | Valeurs calculées ou totaux agrégés | Supabase, puis Gemini |
| IA : justificatif | L'image choisie (à recadrer) | Supabase, puis Gemini. Elle n'est pas stockée |

Aucune capture n'est conservée dans Supabase Storage. Les journaux serveur ne contiennent pas de contenu d'offre.

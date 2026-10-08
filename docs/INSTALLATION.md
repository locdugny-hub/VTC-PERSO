# Déploiement (0 € de frais obligatoires)

Chaque étape utilise une offre gratuite permanente. **N'activez aucun compte de facturation**, et n'ajoutez ni carte, ni recharge, ni domaine payant.

Ordre conseillé : 1 (Netlify) seul permet déjà l'usage local complet. Les étapes 2 et 3 sont facultatives : elles ajoutent sauvegarde cloud, synchronisation et IA.

## 1. PWA sur Netlify (environ 10 minutes)
1. Créez un compte gratuit sur netlify.com.
2. Déployez le dossier du projet, au choix :
   - **Avec Git** : placez le dossier sur GitHub (dépôt privé possible), puis « Add new project > Import from Git ». La commande de build et le dossier `dist` sont déjà définis dans `netlify.toml`.
   - **Sans Git** : sur votre ordinateur, lancez `npm ci`, puis `npm run build`. Glissez ensuite le dossier `dist` dans « Deploys > Drag and drop ».
3. Renommez le site (Project configuration > Change project name). Vous obtenez une adresse HTTPS gratuite `https://<nom>.netlify.app`.
4. **Budget** : chaque déploiement de production coûte 15 crédits sur 300 par mois. Regroupez donc vos mises à jour : 20 déploiements épuisent le mois et **mettent le site en pause**, sans aucune facturation.

Mode local seul : ne définissez aucune variable. Le compte et l'IA restent alors masqués.

## 2. Supabase (facultatif : sauvegarde cloud, synchronisation, IA)
1. Créez un projet gratuit (région **West EU (Paris)**).
2. **Migration** : collez `supabase/migrations/20261008202418_vtc_perso_init.sql` dans SQL Editor et exécutez-le. Avec la CLI, `supabase db push` fait la même chose.
3. **Authentification** : Authentication > Providers > Google.
   1. Créez un client OAuth de type « Application Web » dans Google Cloud (Google Auth Platform), sans facturation, avec les étendues openid, email et profile.
   2. Indiquez comme URI de redirection l'adresse de rappel affichée par Supabase.
   3. Collez l'identifiant et le secret du client dans Supabase. Le secret n'est jamais mis dans le code.
   4. Dans URL Configuration, mettez `https://<nom>.netlify.app` comme Site URL et comme Redirect URL.
4. **Fonctions serveur** :
   ```
   supabase functions deploy device-api --no-verify-jwt
   supabase functions deploy ai --no-verify-jwt
   ```
   L'authentification est faite dans le code des fonctions. Voir `supabase/config.toml`.
5. **Variables Netlify** (Site configuration > Environment variables), puis redéployez :
   - `VITE_SUPABASE_URL` = `https://<projet>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = la clé **publiable** `sb_publishable_…` (Settings > API Keys). Elle est conçue pour le navigateur.
   - **Jamais** la clé secrète `sb_secret_…`.
6. **Vérification** : connectez-vous avec deux comptes Google différents. Chacun ne voit que ses données. Le même contrôle a été automatisé sur PostgreSQL 16 avec `tools/test-db.sh`.

**À savoir** : sur l'offre gratuite, le projet est mis en pause après 7 jours sans activité. Vous pouvez le relancer depuis le tableau de bord. L'offre ne comprend pas de sauvegarde automatique : exportez régulièrement en JSON depuis la PWA.

## 3. Gemini (facultatif, désactivé par défaut)
1. Lisez les conditions : `docs/ETUDE_TECHNIQUE.md`, section 4.
2. Dans Google AI Studio, créez une clé sur un projet **sans compte de facturation**. En cas de dépassement, l'API répond 429 et rien n'est facturé.
3. Enregistrez les secrets, sans jamais les mettre dans la PWA ni dans le raccourci :
   ```
   cp supabase/functions/.env.example supabase/functions/.env   # puis éditez localement
   supabase secrets set --env-file supabase/functions/.env
   ```
4. Dans la PWA, ouvrez Réglages > Fonctions IA > Activer.

## 4. Développement local
```
npm ci
npm test                 # moteur, parseurs, script Scriptable simulé, fonctions, IndexedDB
bash tools/test-db.sh    # migration + RLS + quotas sur PostgreSQL 16 local
npm run build && npx playwright test   # PWA : 320 à 430 px, hors connexion, export (Chromium)
```

# Étude technique : capacités iOS, coûts et choix retenus

Sources consultées le 08/10/2026. Les mentions « [3P] » désignent une source non officielle, « [non vérifié] » une capacité qu'aucune source n'établit et que le protocole doit constater sur l'iPhone.

## 1. Conclusion

| Mode | Gestes par offre | Faisabilité réelle | Coût | Statut |
|---|---|---|---|---|
| **B. Raccourci + AssistiveTouch + Scriptable** (retenu en premier) | 1 pression | Briques publiques documentées ; enchaînement à valider | 0 € | Prototype livré, simulé, **non validé sur iPhone** |
| B'. Même raccourci, calcul serveur | 1 pression | Idem + réseau | 0 € (quotas) | Livré, testé avec dépendances simulées |
| **C. App native ScreenCaptureKit (iOS 27)** | 0 après démarrage | API publique officielle depuis iOS 27 | 0 € avec signature gratuite (7 jours) ; 99 USD/an sinon | Code source livré, **non compilé** (aucun Mac) |
| A. PWA seule | — | **Impossible** : Safari iOS n'a pas `getDisplayMedia`, pas d'exécution en arrière-plan | — | Écartée pour la lecture d'offre |

Le mode « zéro action » existe désormais par une voie publique (ScreenCaptureKit sur iOS 27). Il exige une app native, donc un Mac ou une compilation en ligne, et une resignature hebdomadaire avec un compte Apple gratuit. Le mode « une pression » est disponible immédiatement sans Mac et sans frais : c'est le parcours principal livré.

## 2. Vérification des capacités

### A. Capture automatique par API publique
- **ScreenCaptureKit est disponible sur iOS à partir de 27.0.** Le sélecteur système (`SCContentSharingPicker.present()`) permet de choisir « l'écran entier ». Le mode d'arrière-plan `screen-capture` maintient le flux quand l'app n'est plus au premier plan. Apple indique que ScreenCaptureKit « remplace ReplayKit » et qu'« une extension de diffusion n'est plus nécessaire ». Source : Apple, *Capturing screen content on iOS* (iOS 27) et *ScreenCaptureKit*, developer.apple.com.
- **ReplayKit** : `RPBroadcastSampleHandler` est marqué « No longer supported » dans iOS 27, et `RPSystemBroadcastPickerView` est déprécié au profit de `SCContentSharingPicker`. Source : developer.apple.com/documentation/replaykit.
- **iOS actuel** : iOS 27.0.1, sorti le 28/09/2026. iOS 27 est sorti le 14/09/2026. Source : support.apple.com/100100. D'après la liste du guide Apple, l'iPhone 12 Pro Max fait partie des modèles compatibles avec iOS 27. **L'iPhone 7 plafonne à iOS 15** et n'a pas Live Text, qui demande une puce A12 (support.apple.com/120004) : il ne peut faire ni le mode B ni le mode C.
- **Ce qui reste à constater sur l'iPhone :**
  - Uber et Bolt peuvent masquer leur contenu pendant une capture (`UIScreen.isCaptured`). Apple indique que certaines apps n'autorisent pas l'enregistrement. Si l'image capturée de l'offre est noire, le mode C est impossible pour cette app.
  - L'indicateur d'enregistrement reste visible pendant toute la session. Apple l'exige (règle App Review 2.5.14).
  - Le mode d'arrière-plan doit rester accepté avec une signature gratuite. Le compte gratuit autorise la capacité « Background Modes » (developer.apple.com/help/account/reference/supported-capabilities-ios).
  - La consommation de batterie et la chauffe sont à mesurer.

### B. Raccourcis + AssistiveTouch
- **Prendre une capture d'écran** : action disponible depuis iOS 14.5. Elle n'ouvre pas l'éditeur et n'enregistre pas l'image dans Photos [3P, How-To Geek]. Aucune page Apple ne la décrit.
- **Extraire le texte de l'image** : fonction Live Text, qui demande un iPhone XS ou plus récent (A12) ; le français est pris en charge (apple.com/ios/feature-availability). Sous iOS 27, l'action s'appellerait « Extraire de l'image » [3P].
- **AssistiveTouch** : Apple documente les actions personnalisées « Toucher une fois », « Toucher deux fois » et « Appui long » (support.apple.com/111794). Le choix d'un raccourci à cet endroit est connu des utilisateurs [3P] mais pas écrit par Apple : **à constater**. Apple documente « Toucher le dos » pour lancer un raccourci (guide Raccourcis iOS 27).
- **Afficher la notification** : l'action crée une notification système et passe à l'action suivante sans attendre, contrairement à « Afficher l'alerte » (guide Raccourcis iOS 27). La concentration « Conduite » peut masquer les notifications, sauf pour les apps autorisées (support.apple.com/108384).
- **Autorisations** : les demandes proposent « Toujours autoriser », qui supprime la question aux exécutions suivantes (guide Raccourcis iOS 27, *Adjust privacy settings*). L'absence de demande pour Take Screenshot et Run Script est **[non vérifié]**.
- **Calcul local** : Raccourcis ne peut pas exécuter de JavaScript sans app tierce. **Scriptable** (gratuite, version 1.7.19 du 30/09/2024, iOS 15.5 minimum) exécute un script depuis Raccourcis sans s'ouvrir, avec `args.shortcutParameter` et `Script.setShortcutOutput` (docs.scriptable.app). Son fonctionnement sous iOS 26 ou 27 n'est confirmé par aucune source : **à constater**.
  - Alternatives si Scriptable échoue : a-Shell mini (gratuite, mise à jour en septembre 2026, commande « Execute Command » en extension) ; Actions de Sindre Sorhus (gratuite, iOS 26 minimum, « Transform Text with JavaScript ») [non vérifié en arrière-plan].
- **Nouveautés iOS 27** : déclencheurs d'automatisation sur capture d'écran et sur notification. Apple ne les liste pas parmi les automatisations qui s'exécutent sans demander (guide Raccourcis iOS 27). Ils ne sont donc pas retenus, faute de garantie d'absence de confirmation.

### C. Composant natif : contraintes honnêtes
- **Sans Mac**, il faut une compilation en ligne : le workflow GitHub Actions fourni produit un `.ipa` non signé sur un runner macOS. La disponibilité d'un Xcode avec le SDK iOS 27 sur ce runner est **à vérifier**. Les minutes macOS sont gratuites pour un dépôt public ; pour un dépôt privé, elles consomment le quota gratuit plus vite (coefficient macOS).
- **Signature gratuite** : un identifiant Apple suffit, via Sideloadly sur Windows ou Xcode sur Mac.
  - Le profil expire **au bout de 7 jours** et doit être réinstallé chaque semaine.
  - Limites : 3 apps par appareil, 10 identifiants d'app par période de 7 jours (developer.apple.com/help/account/basics/about-your-developer-account).
  - Le Mode développeur doit être activé sur l'iPhone.
- **Signature durable** : Apple Developer Program, 99 USD par an. **Non activé**, car payant.
- **Union européenne** : la distribution hors App Store passe par des apps notarisées de membres du programme payant. Aucune voie gratuite et durable n'a été trouvée (developer.apple.com/support/dma-and-apps-in-the-eu).

## 3. Modèle et version nécessaires à la validation
- **iPhone 12 Pro Max**. Il n'a pas de Dynamic Island : les résultats s'affichent en bannière de notification et par la voix.
- **Mode B** : iOS 26 ou 27 (Live Text et Raccourcis sont disponibles), Scriptable installée.
- **Mode C** : iOS 27 ou plus récent est obligatoire.
- **Relevé à faire** : Réglages > Général > Informations, puis noter le modèle et la version exacte dans `validation/mesures.csv`.

## 4. Gratuité : plans retenus

| Service | Plan retenu | Quotas utiles | Limites, pauses | Si indisponible |
|---|---|---|---|---|
| **Netlify** | Free, permanent, à crédits : 300 crédits par mois avec un plafond dur, sans recharge ni facturation | Déploiement de production : 15 crédits ; bande passante : 20 crédits/Go ; requêtes : 2 crédits pour 10 000 | Crédits épuisés : **tous les sites sont mis en pause** jusqu'au mois suivant. L'offre gratuite peut être arrêtée sans préavis (conditions de 2020). Adresse HTTPS `*.netlify.app` incluse | La PWA installée continue de fonctionner hors ligne grâce au service worker. Le raccourci n'en dépend pas |
| **Supabase** | Free, permanent | 2 projets actifs ; base 500 Mo ; 5 Go de sortie ; 50 000 utilisateurs actifs mensuels ; 500 000 appels de fonctions ; région Paris (eu-west-3) | **Pause après 7 jours d'inactivité**, restauration possible pendant 1 an. **Aucune sauvegarde automatique.** Dépassement : pause, lecture seule ou HTTP 402, sans facturation. Clés `anon` et `service_role` dépréciées d'ici fin 2026 : le projet utilise les nouvelles clés | Le local reste complet. La synchronisation est retentée plus tard. L'export JSON reste indépendant de Supabase |
| **Gemini Developer API** (AI Studio) | Niveau gratuit d'un projet **sans compte de facturation** | Modèles gratuits listés, dont `gemini-2.5-flash-lite` (non déprécié, sans date d'arrêt) et `gemini-3.5-flash-lite` (recommandé pour les nouveaux projets). Les plafonds ne sont plus publiés : ils sont visibles dans AI Studio et « non garantis » | Dépassement : erreur 429, pas de facturation tant qu'aucun compte de facturation n'est lié. Une alerte budgétaire n'est pas un plafond | Les fonctions IA sont indisponibles. Rien d'autre n'est affecté |
| Vertex AI | **Écarté** | Essai de 300 USD sur 90 jours avec moyen de paiement ; « express mode » de 90 jours | Offres temporaires, pas une offre gratuite permanente | — |
| Google OAuth (connexion Google) | Client « Application Web » | Mode test : 100 utilisateurs | L'expiration à 7 jours ne s'applique pas aux étendues openid, email et profile. Aucun coût mentionné [non vérifié] | La connexion est facultative, l'usage local continue |

**Point juridique à lire avant d'activer l'IA** (constat, pas un avis juridique) :
- Les *Gemini API Additional Terms*, en vigueur au 23/03/2026, prévoient que les règles de données des services payants s'appliquent aussi au quota gratuit dans l'EEE : les requêtes ne servent pas à améliorer les produits.
- Ces conditions précisent aussi : « You may use only Paid Services when making API Clients available to users in the EEA ».
- Elles réservent l'usage aux besoins professionnels. Votre activité VTC est professionnelle.
- L'application de la clause « API Clients made available » à un outil strictement personnel relève de l'interprétation.
- L'IA est donc **désactivée par défaut** et hors du parcours de conduite. L'âge minimum est de 18 ans.

**Aucun fournisseur ne garantit la gratuité dans la durée.** L'architecture ne rend aucun d'eux indispensable au verdict : celui-ci est calculé localement.

## 5. Gemini : place retenue

1. **Parcours de conduite : pas de Gemini.** Le réseau, le quota et la clause EEE seraient incompatibles avec un verdict fiable en une seconde, et rien ne permet d'en prouver le bénéfice.
2. **Fonctions intégrées, protégées par la fonction serveur `ai`** :
   - explication d'un résultat déjà calculé ;
   - résumé de bilans agrégés ;
   - lecture de justificatifs, avec confirmation avant enregistrement ;
   - détection d'incohérences ;
   - aide à l'utilisation ;
   - extraction d'offre en diagnostic.
3. **Étude comparative à mener** sur votre corpus avec `tools/gemini-bench.mjs`. Elle compare trois approches :
   - OCR local et parseur ;
   - OCR local puis structuration par Gemini ;
   - image envoyée directement à Gemini.

   Elle mesure exactitude, valeurs fausses, valeurs inconnues, latence et volume envoyé. **Aucune mesure n'a été faite ici** : aucune clé n'a été demandée et aucun corpus réel n'était disponible. Une intégration dans le parcours rapide ne serait envisageable que si ces mesures la justifient.

## 6. Sources principales
- Apple : [Capturing screen content on iOS](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios), [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit), [RPSystemBroadcastPickerView](https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview), [Background modes](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes), [Show Notification (Raccourcis iOS 27)](https://support.apple.com/guide/shortcuts/use-the-show-notification-action-apd2175adcab/10.0/ios/27), [Privacy settings (Raccourcis)](https://support.apple.com/guide/shortcuts/adjust-privacy-settings-apd961a4fc65/10.0/ios/27), [Automations (iOS 27)](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/10.0/ios/27), [AssistiveTouch](https://support.apple.com/en-us/111794), [Live Text, appareils](https://support.apple.com/en-us/120004), [Concentration Conduite](https://support.apple.com/en-us/108384), [Versions d'iOS](https://support.apple.com/en-us/100100), [Compte développeur gratuit](https://developer.apple.com/help/account/basics/about-your-developer-account), [Capacités du compte gratuit](https://developer.apple.com/help/account/reference/supported-capabilities-ios), [UE et DMA](https://developer.apple.com/support/dma-and-apps-in-the-eu/).
- Netlify : [Plans à crédits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [Fonctionnement des crédits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), [Tarifs](https://www.netlify.com/pricing/).
- Supabase : [Tarifs](https://supabase.com/pricing), [Pause des projets gratuits](https://supabase.com/docs/guides/platform/free-project-pausing), [Sauvegardes](https://supabase.com/docs/guides/platform/backups), [Clés d'API](https://supabase.com/docs/guides/api/api-keys), [Fonctions et authentification](https://supabase.com/docs/guides/functions/auth), [Clés de signature JWT](https://supabase.com/docs/guides/auth/signing-keys), [Secrets des fonctions](https://supabase.com/docs/guides/functions/secrets).
- Google : [Tarifs Gemini API](https://ai.google.dev/gemini-api/docs/pricing), [Limites de débit](https://ai.google.dev/gemini-api/docs/rate-limits), [Dépréciations](https://ai.google.dev/gemini-api/docs/deprecations), [Conditions additionnelles](https://ai.google.dev/gemini-api/terms), [Régions disponibles](https://ai.google.dev/gemini-api/docs/available-regions), [Facturation](https://ai.google.dev/gemini-api/docs/billing), [Budgets Cloud](https://docs.cloud.google.com/billing/docs/how-to/budgets), [Offres gratuites Cloud](https://docs.cloud.google.com/free/docs/free-cloud-features).
- Scriptable : [App Store](https://apps.apple.com/fr/app/scriptable/id1405459188), [Documentation](https://docs.scriptable.app/).

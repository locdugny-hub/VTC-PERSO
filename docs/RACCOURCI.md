# Raccourci « VTC Analyse » : construction exacte (iPhone 12 Pro Max, iOS 26 ou 27)

**Statut : non validé sur iPhone.** Ce parcours a été construit et testé avec un simulateur (voir `tests/scriptable.test.ts`). Il n'a pas été exécuté sur un téléphone. Le protocole de validation est dans `docs/VALIDATION_IPHONE.md`.

**Pas de fichier `.shortcut` ni de lien iCloud fourni.** Depuis iOS 15, un raccourci importé sous forme de fichier doit être signé, et cette signature exige la commande `shortcuts sign` d'un Mac. Un lien iCloud, lui, ne peut être créé que depuis un iPhone où le raccourci existe déjà. Une fois le raccourci construit, vous pourrez créer ce lien vous-même avec « Partager > Copier le lien iCloud ».

**Complexité : 16 actions, environ 20 à 30 minutes**, à faire une seule fois, à l'arrêt.

## 0. Prérequis (une fois)

1. Installer **Scriptable** depuis l'App Store. L'app est gratuite et sans abonnement ; seuls des pourboires facultatifs sont proposés. Dernière version : 1.7.19 du 30/09/2024. Elle n'a pas été mise à jour depuis, donc son fonctionnement sur votre version d'iOS fait partie des points à valider.
2. Copier le script dans Scriptable, au choix :
   - **Par Fichiers** : dans la PWA, ouvrez « Réglages > Raccourci > Télécharger VTCPerso.js » et enregistrez le fichier dans **Fichiers > iCloud Drive > Scriptable**. Si vous n'utilisez pas iCloud Drive, passez par l'autre méthode.
   - **Par copier-coller** : « Réglages > Raccourci > Copier le script », puis dans Scriptable touchez « + », collez, et nommez le script **VTC Perso**.
3. Importer la configuration :
   - Dans la PWA, ouvrez « Réglages > Raccourci > Copier la configuration ».
   - Dans Scriptable, touchez **VTC Perso**, puis « Importer la configuration (presse-papiers) ».
   - Le message affiche la version de configuration (`cfg-xxxxxxxx`). Cette même version apparaît dans la PWA.
4. Dans le même menu Scriptable, lancer « Tester une offre fictive ». Si iOS le demande, autorisez les notifications de Scriptable.

## 1. Construire le raccourci (app Raccourcis, bouton +)

Nommez-le **VTC Analyse**. Les libellés ci-dessous sont ceux de l'interface française. Les noms anglais sont donnés entre parenthèses pour retrouver les actions par la recherche.

| # | Action | Réglages exacts |
|---|---|---|
| 1 | **Date actuelle** (Current Date) | — |
| 2 | **Formater la date** (Format Date) | Date : *Date actuelle*. Format : **Personnalisé**, chaîne `yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ` |
| 3 | **Prendre une capture d'écran** (Take Screenshot) | Écran principal |
| 4 | **Extraire le texte de l'image** (Extract Text from Image). Sous iOS 27, l'action peut s'appeler **Extraire de l'image** (Extract from Image) | Entrée : *Capture d'écran*. Si l'action propose un type, choisissez **Texte** |
| 5 | **Dictionnaire** (Dictionary) | 3 clés de type Texte : `mode` = `analyze` ; `text` = variable *Texte extrait* (résultat de l'action 4) ; `t0` = variable *Date formatée* (résultat de l'action 2) |
| 6 | **Run Script** (Scriptable) | Script : **VTC Perso**. Parameter : *Dictionnaire*. **Run In App : désactivé**. **Show When Run : désactivé** |
| 7 | **Obtenir la valeur du dictionnaire** (Get Dictionary Value) | Clé `title` dans *Résultat du script* (Script Result). Renommez la variable **Titre** |
| 8 | **Obtenir la valeur du dictionnaire** | Clé `body` dans *Résultat du script*. Renommez la variable **Corps** |
| 9 | **Obtenir la valeur du dictionnaire** | Clé `speech` dans *Résultat du script*. Renommez la variable **Voix** |
| 10 | **Si** (If) | *Titre* **a une valeur** (has any value) |
| 11 | **Afficher la notification** (Show Notification) | Titre : *Titre*. Corps : *Corps*. Jouer un son : désactivé |
| 12 | **Si** (imbriqué) | *Voix* **a une valeur** |
| 13 | **Énoncer le texte** (Speak Text) | Texte : *Voix*. **Attendre la fin : désactivé**. Langue : Français (France). Débit : un peu plus rapide |
| 14 | **Fin Si** + **Fin Si** | — |
| 15 | *(mesure, recommandée pendant la validation)* **Date actuelle**, puis **Formater la date** avec le même format, puis **Dictionnaire** : `mode` = `post`, `id` = valeur `id` du *Résultat du script*, `tNotify` = *Date formatée* | Utilisez Obtenir la valeur du dictionnaire pour lire `id` |
| 16 | *(mesure)* **Run Script** | Script **VTC Perso**, Parameter = le dictionnaire de l'étape 15, Run In App désactivé |

Dans les réglages du raccourci (icône ⓘ) :
- désactiver « Afficher dans la feuille de partage » ;
- si l'option existe, désactiver « Demander avant d'exécuter ».

**Pourquoi ces choix :**
- **Afficher la notification** ne bloque pas le raccourci, contrairement à « Afficher l'alerte » qui attend une réponse. Source : Apple, *Use the Show Notification action*, guide Raccourcis iOS 27.
- **Rien n'est enregistré dans Photos** : la capture reste en mémoire dans le raccourci.
- **Résultats périmés ou remplacés** : le script renvoie un titre vide, donc rien n'est affiché.

## 2. Premier lancement à l'arrêt (autorisations)

1. Lancez **VTC Analyse** une fois depuis l'app Raccourcis.
2. Pour chaque demande d'autorisation, par exemple pour exécuter Scriptable, choisissez **Toujours autoriser**. Apple documente ces choix : Allow Once, Always Allow, Don't Allow (*Adjust privacy settings*, iOS 27).
3. Lancez-le une deuxième fois : **aucune demande ne doit réapparaître**. Si une demande revient à chaque fois, le critère « aucune confirmation répétée » échoue. Notez-le dans le protocole.

## 3. AssistiveTouch : une seule pression

1. Ouvrez Réglages > Accessibilité > Toucher > **AssistiveTouch** et activez-le.
2. Dans **Actions personnalisées > Toucher une fois**, choisissez **VTC Analyse** dans la section Raccourcis. Apple documente les actions personnalisées d'AssistiveTouch, mais le choix d'un raccourci à cet endroit doit être constaté sur votre téléphone.
3. Réglez **Opacité au repos** à environ 40 %.
4. **Sécurité** : placez le bouton **loin du bouton « Accepter »** d'Uber et de Bolt (par exemple en haut à gauche), pour qu'une pression ne puisse jamais toucher l'offre.

Variante : Réglages > Accessibilité > Toucher > Toucher le dos > Toucher deux fois > VTC Analyse. Elle fonctionne sur un iPhone 8 ou plus récent, mais elle est peu pratique avec un téléphone sur support.

## 4. Rendre le résultat visible pendant la conduite

- Ouvrez Réglages > Notifications > **Raccourcis**. Activez Autoriser, Bannières, et le style de bannière **Temporaire**. Le style Persistant masquerait l'offre.
- **Concentration « Conduite »** : elle peut masquer ou limiter les notifications (Apple, support 108384). Dans Réglages > Concentration > Conduite > Notifications autorisées > Apps, ajoutez **Raccourcis**.
- La voix suit le volume média et le mode silencieux. Vérifiez-la pendant le guidage, avec le protocole.
- Une notification créée ne prouve pas qu'elle a été vue. Le protocole mesure l'affichage réel en vidéo.

## 5. Variante B, sans Scriptable : calcul par le serveur

Remplacez l'action 6 par **Obtenir le contenu de l'URL** (Get Contents of URL) :

| Réglage | Valeur |
|---|---|
| URL | `https://<projet>.supabase.co/functions/v1/device-api/analyze` |
| Méthode | POST |
| En-têtes | `x-device-token` = votre jeton `vtcd_…` (Réglages > Compte > Jetons d'appareil) |
| Corps | JSON : `text` = *Texte extrait*, `t0` = *Date formatée* |

La réponse a la même forme que le résultat du script : `title`, `body`, `speech`, `id`.

Limites de cette variante :
- elle dépend du réseau et de Supabase (projet gratuit mis en pause après 7 jours d'inactivité) ;
- la latence s'ajoute au délai de réponse ;
- **hors connexion, aucun verdict**.

Le jeton se trouve alors dans le raccourci. **Ne partagez pas ce raccourci**, et révoquez le jeton depuis la PWA si nécessaire.

## 6. Après la session : transférer l'historique

Trois possibilités :
- **Sans compte** : dans Scriptable, « VTC Perso > Copier le journal ». Puis dans la PWA, « Réglages > Données > Importer le journal du raccourci ». L'import est idempotent : un import répété ne crée pas de doublon.
- **Avec compte et jeton** : dans Scriptable, « Synchroniser maintenant ». La PWA récupère ensuite les analyses lors de sa propre synchronisation.
- **Synchronisation après chaque offre** (`syncMode: after_each`, activé dans la PWA) : une requête réseau part après l'affichage, ce qui n'est pas mesuré dans le délai du verdict. Elle prolonge l'exécution du raccourci d'environ une seconde. Ce mode est désactivé par défaut.

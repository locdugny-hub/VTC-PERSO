# VTC Perso : guide court

## Installer (une fois, à l'arrêt)
1. Ouvrez l'adresse de votre PWA dans **Safari**.
2. Touchez **Partager**, puis **Sur l'écran d'accueil**, puis **Ajouter**. Sous iOS 26 et 27, si l'option n'apparaît pas tout de suite, faites défiler la feuille de partage ou touchez « Plus ».
3. Ouvrez VTC Perso depuis l'écran d'accueil, puis renseignez dans **Réglages** :
   - **Véhicule et coûts** : un champ vide signifie « non renseigné », ce qui est différent de 0 ;
   - **Seuils** ;
   - **Base des prix Uber / Bolt** : à vérifier sur vos relevés.
4. Installez le **raccourci** en suivant Réglages > Raccourci iPhone : Scriptable, script, configuration, raccourci, puis AssistiveTouch.
5. Faites le **test guidé** (onglet Session) : une offre fictive s'affiche, appuyez sur AssistiveTouch et comparez la notification au résultat attendu.

## Pendant une session
1. Dans l'onglet **Session**, touchez « Démarrer ». Vous pouvez saisir le compteur kilométrique.
2. Ouvrez **Uber** ou **Bolt** et laissez l'app chauffeur affichée.
3. Quand une offre apparaît, faites **une pression sur AssistiveTouch**. Vous recevez :
   - une bannière : verdict, €/h, €/km, heure de capture ;
   - une annonce vocale brève.
4. **Verdicts possibles** :
   - **Favorable** : les deux seuils sont atteints.
   - **Limite** : chaque ratio atteint au moins 80 % de son seuil.
   - **Faible** : sinon.
   - **Partiel** : une donnée manque ou n'est pas confirmée.
   - **Analyse indisponible** : l'offre n'a pas pu être lue.
5. **Vous décidez seul** d'accepter ou de refuser : l'outil ne touche jamais à l'offre.
6. Le résultat est valable environ 10 secondes. Au-delà, il n'est plus affiché.
7. En fin de journée, touchez « Terminer ». La durée inclut l'attente et exclut les pauses.

## Après la session
1. Dans Scriptable, ouvrez **VTC Perso**, puis **Copier le journal**. Dans la PWA, ouvrez Réglages > Données > **Importer le journal**. Avec un compte, utilisez plutôt « Synchroniser maintenant ».
2. Dans l'**Historique**, pour chaque offre :
   - marquez-la Acceptée, Refusée, Annulée, Réalisée (avec le **montant réellement perçu**) ou Encaissée ;
   - corrigez si besoin une lecture erronée.
3. Dans le **Bilan**, ajoutez vos dépenses réelles (carburant, péages…). Les ratios utilisent le temps réel de session.

## Sauvegarder
- **Réglages > Données > Exporter tout (JSON)** : à faire régulièrement, même avec un compte. La sauvegarde vérifie les totaux et les relations à la restauration.
- L'export CSV (offres, courses, dépenses) s'ouvre dans Excel ou Numbers.
- Si vous modifiez un réglage, **recopiez la configuration** dans Scriptable avant de reprendre la route. La PWA l'indique dans l'onglet Session.

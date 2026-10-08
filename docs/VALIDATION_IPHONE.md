# Protocole de validation sur iPhone (à exécuter, non exécuté à ce jour)

**But** : prouver ou infirmer le parcours principal sur votre iPhone 12 Pro Max, à l'arrêt, en restant sur Uber puis sur Bolt.

**Règle d'avancement** : tant que les étapes V1 à V4 n'ont pas réussi, l'application n'est pas présentée comme terminée.

## Matériel
- L'iPhone 12 Pro Max. Notez le modèle et la version d'iOS (Réglages > Général > Informations).
- Un **second appareil** qui filme l'écran en ralenti (240 i/s si possible) avec le son. Sans second appareil, la mesure de bout en bout est impossible.
- Applications Uber Driver et Bolt Driver connectées. Les offres sont observées, **jamais acceptées par l'outil**.
- Configuration réelle importée dans Scriptable, dont la version `cfg-…` est notée.

## V0. Préparation (une fois)
1. Suivre `docs/RACCOURCI.md`, sections 0 à 4.
2. Lancer le **test guidé** dans la PWA (Session > Test guidé à l'arrêt). Une offre fictive s'affiche : appuyez sur AssistiveTouch, puis comparez la notification au résultat attendu.
3. **Critère** : notification visible sans dialogue, résultat identique au résultat attendu, voix audible.

## V1. Acquisition et absence de dialogue (Uber, puis Bolt)
Avec une offre réelle affichée, appuyez une fois sur AssistiveTouch. Vérifiez chaque point ci-dessous et notez oui ou non :
- l'app chauffeur reste au premier plan ;
- aucun éditeur de capture, aucun choix de photo, aucune confirmation ;
- une bannière s'affiche ;
- la voix démarre ;
- l'offre n'est pas masquée durablement.

Répétez l'essai juste après pour confirmer qu'**aucune autorisation n'est redemandée**.

**Échec bloquant** : si une confirmation apparaît à chaque fois, ou si la capture de l'app chauffeur est noire. Dans ce second cas, vérifiez la capture en enregistrant temporairement l'image dans Photos.

## V2. Lecture (corpus réel)
1. Constituez **au moins 150 captures autorisées par plateforme**, prises à l'arrêt, avec des offres variées : mode sombre, texte agrandi, bandeau de notification par-dessus, offres longues ou courtes.
2. Réservez **100 captures inédites** pour la validation finale (colonne `jeu` = `validation`). Ne réglez jamais les parseurs avec ces captures.
3. Produisez les textes OCR avec un petit raccourci « VTC Corpus » :
   - Sélectionner des photos ;
   - Répéter avec chaque élément : Extraire le texte de l'image, puis Enregistrer le fichier dans `Fichiers/VTC Corpus/textes/<nom>.txt`.
4. Annotez `validation/corpus/annotations.csv` (format dans `annotations.exemple.csv`), puis lancez :
   `node tools/corpus-eval.mjs validation/corpus --jeu validation`
5. **Cibles** :
   - prix exact sur au moins 99 % des offres exploitables ;
   - distances et durées affectées correctement sur au moins 98 % ;
   - **zéro verdict favorable dû à une erreur de lecture** (code de sortie 2 sinon) ;
   - taux de rejet publié.

## V3. Temps de réponse (30 essais par plateforme au minimum)
Pour chaque essai, filmez l'écran, puis relevez dans la vidéo :
- l'image de la **pression** (doigt sur AssistiveTouch) ;
- l'image de **la bannière lisible** ;
- l'image du **début de la voix**.

**Distinguez les essais à froid et à chaud :**
- *Froid* : après redémarrage de l'iPhone, ou après avoir fermé Raccourcis et Scriptable dans le sélecteur d'apps.
- *Chaud* : enchaînement d'essais à moins d'une minute d'intervalle.

Indiquez aussi si l'offre était **encore affichée** au moment du résultat, et si le verdict était correct.

Saisissez le tout dans `validation/mesures.csv` (format dans `mesures.exemple.csv`), puis lancez :
`node tools/latency-report.mjs validation/mesures.csv`

**Cibles à mesurer** :
- médiane ≤ 1 s ;
- au moins 95 % des essais ≤ 2 s ;
- un essai sans résultat compte comme un échec.

Le chronométrage s'arrête quand le verdict est visible ou que la voix commence. **Il ne s'arrête pas à la fin du script.**

Mesures internes complémentaires : PWA > Réglages > Mesures. Elles partent du début du raccourci, pas de la pression, et l'écart entre les deux est à mesurer en vidéo.

## V4. Variantes
- **Offres successives** : deux offres à quelques secondes d'intervalle. Le résultat de la première ne doit pas s'afficher après celui de la seconde.
- **Résultat périmé** : réglez la validité sur 3 s (Réglages > Parcours rapide), réimportez la configuration, puis déclenchez l'analyse et attendez. Aucun résultat ne doit apparaître après expiration.
- **Réseau absent** (mode avion) : le verdict local doit s'afficher. La synchronisation reste en attente.
- **Notifications** : vérifiez avec la concentration Conduite active, Raccourcis autorisé puis non autorisé, et le style de bannière Temporaire puis Persistant.
- **Audio** : mode silencieux, volume bas, guidage GPS en cours, Bluetooth de la voiture.
- **Mauvaise lecture** : offre partiellement masquée. Le résultat attendu est « Partiel » ou « Analyse indisponible », jamais « Favorable » à tort.
- **Lancement à froid** de la PWA en mode avion : l'historique et l'analyse manuelle doivent fonctionner.

## V5. Historique
1. Après la session, importez le journal dans la PWA (copier et coller), ou synchronisez.
2. Réimportez le même journal : aucun doublon ne doit apparaître.
3. Corrigez une offre, puis vérifiez que l'original reste visible.
4. Marquez une offre refusée, puis une offre annulée : le bilan ne doit pas augmenter.

## Décision
- **V1 à V4 réussis** : le mode une pression est accepté.
- **V1 échoue à cause de Scriptable** : passez à la variante B' (calcul serveur) ou à a-Shell, puis refaites V1 et V3.
- **V3 rate la cible** : notez la médiane et le p95 réels, puis décidez s'ils restent utiles. Il ne faut pas annoncer une cible non atteinte.
- **Mode C (ScreenCaptureKit)** : à évaluer séparément avec `native/README.md`, après passage à iOS 27 et compilation.

# Composant natif « zéro action » (expérimental, iOS 27)

**Statut : code source livré, NON COMPILÉ et NON TESTÉ.** L'environnement de livraison ne dispose ni de macOS ni de Xcode.

Seule la partie JavaScript embarquée est testée : `bridge.js` et `vtc-core.js`, avec `tests/native-bridge.test.ts`.

## Principe
1. Dans l'app, touchez **Démarrer**. Le sélecteur système iOS s'ouvre : choisissez **Écran entier**.
2. Ouvrez Uber ou Bolt. ScreenCaptureKit continue d'envoyer l'écran à l'app en arrière-plan, grâce au mode `screen-capture` (documentation Apple iOS 27).
3. Chaque image est traitée ainsi :
   - une empreinte 16 × 16 détecte un changement dans la partie basse de l'écran ;
   - Vision lit le texte uniquement si l'écran a changé ;
   - un préfiltre vérifie la présence de « € » et de « km » ou « min » ;
   - le même moteur que la PWA calcule le verdict.
4. Le résultat est restitué par une notification locale (identifiant fixe : la nouvelle offre remplace l'ancienne) et par la voix. La notification est retirée à l'expiration.
5. Aucune action n'est nécessaire offre par offre. L'app n'accepte ni ne refuse rien.

## Contraintes (honnêtes)
| Sujet | Réalité |
|---|---|
| Version d'iOS | **iOS 27 minimum**. L'iPhone 12 Pro Max doit être mis à jour. L'iPhone 7 est exclu. |
| Compilation sans Mac | Workflow `.github/workflows/ios-unsigned-build.yml` sur un runner macOS de GitHub : à lancer manuellement (Actions > Run workflow). Il échoue proprement si aucun Xcode 27 n'est présent sur l'image. |
| Signature gratuite | Avec Sideloadly (Windows) et votre identifiant Apple gratuit, ou Xcode sur un Mac emprunté. **Le profil expire au bout de 7 jours** : réinstallation chaque semaine. Il faut activer le Mode développeur sur l'iPhone. Limites : 3 apps et 10 identifiants d'app par période de 7 jours. |
| Signature durable | Apple Developer Program, 99 USD par an. **Non activé.** |
| Indicateur | L'enregistrement d'écran reste signalé par iOS pendant toute la session. C'est normal et voulu. |
| Contenu protégé | Si Uber ou Bolt masquent leur affichage pendant une capture, l'image reçue est noire et le mode est inutilisable pour cette app. **À constater en premier.** |
| Batterie | Au plus 4 images par seconde à demi-résolution, OCR seulement sur changement. À mesurer sur une heure et à comparer à une heure sans l'app. |
| Notifications | Le niveau « Time Sensitive » n'est pas disponible avec un compte gratuit. La concentration Conduite peut masquer les bannières : autorisez l'app. |
| Maintenance | Les formats d'écran changent : il faut mettre à jour `src/core/parse.ts`, puis `npm run build:bundles` et recompiler. |

## Construire sur un Mac (si vous en empruntez un)
```
brew install xcodegen
npm ci && npm run build:bundles
cd native && xcodegen generate && open VTCPerso.xcodeproj
```
Ensuite, dans Xcode : Signing > Team > votre Personal Team, puis lancez l'app sur l'iPhone branché.

## Points à vérifier à la première compilation
Les signatures exactes des API ScreenCaptureKit pour iOS 27 sont à confronter au SDK :
- `SCContentSharingPicker`, son observateur et `SCStreamConfiguration` ;
- le comportement de `UIScreen.main` sous iOS 27.

Le code suit l'exemple officiel d'Apple et les signatures macOS connues.

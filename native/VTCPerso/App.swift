// VTC Perso Auto — composant natif expérimental (iOS 27+, ScreenCaptureKit).
// Objectif : zéro action par offre après démarrage de la session (sélecteur système de capture).
// STATUT : code non compilé ni testé (aucun Mac disponible lors de la livraison). Voir native/README.md.
import SwiftUI
import UserNotifications

@main
struct VTCPersoApp: App {
    @StateObject private var engine = CaptureEngine()
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(engine) }
    }
}

struct ContentView: View {
    @EnvironmentObject var engine: CaptureEngine
    @State private var message = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Session automatique") {
                    Text(engine.statusText).font(.headline)
                    if engine.isCapturing {
                        Button("Arrêter la capture", role: .destructive) { Task { await engine.stop() } }
                    } else {
                        Button("Démarrer (choisir « Écran entier »)") { engine.presentPicker() }
                            .disabled(engine.config == nil)
                    }
                    Text("Après le démarrage, ouvrez Uber ou Bolt. L'indicateur d'enregistrement d'iOS reste visible pendant toute la session. L'app n'accepte ni ne refuse aucune course.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Dernier résultat") {
                    Text(engine.lastTitle.isEmpty ? "—" : engine.lastTitle).font(.title3.bold())
                    Text(engine.lastBody).font(.callout)
                    if let ms = engine.lastLatencyMs { Text("Changement d'écran → notification : \(ms) ms (mesure interne)").font(.footnote) }
                }
                Section("Configuration") {
                    Text(engine.config.map { "Version \($0.configId)" } ?? "Aucune configuration")
                    Button("Importer depuis le presse-papiers (copiée dans la PWA)") {
                        message = engine.importConfigFromPasteboard()
                    }
                    Toggle("Annonce vocale", isOn: $engine.voice)
                }
                Section("Journal") {
                    Text("\(engine.journalCount) analyse(s) enregistrée(s) localement")
                    ShareLink(item: engine.journalURL) { Text("Exporter le journal (JSONL) vers la PWA") }
                }
                if !message.isEmpty { Section { Text(message).font(.footnote) } }
            }
            .navigationTitle("VTC Perso Auto")
            .task { await engine.requestNotificationPermission() }
        }
    }
}

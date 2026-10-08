// Pont JavaScriptCore : exécute le MÊME moteur (vtc-core.js, généré depuis src/core) que la PWA,
// le script Scriptable et les fonctions serveur. Aucun réseau.
import Foundation
import JavaScriptCore

struct FastConfigInfo { let configId: String; let json: String; let voice: Bool }

struct AnalysisOutput {
    let id: String
    let title: String
    let body: String
    let speech: String
    let verdict: String
    let status: String          // ok / partial / not_offer / ambiguous
    let fingerprint: String     // prix + distances, pour éviter de notifier deux fois la même offre
    let validUntil: Date
    let journalLine: String
}

final class CoreBridge {
    private let ctx: JSContext

    init?() {
        guard let url = Bundle.main.url(forResource: "vtc-core", withExtension: "js"),
              let src = try? String(contentsOf: url, encoding: .utf8),
              let ctx = JSContext() else { return nil }
        ctx.exceptionHandler = { _, ex in NSLog("VTCCore JS error: %@", ex?.toString() ?? "?") }
        ctx.evaluateScript(src)
        // Points d'entrée (fichier séparé, testé sous Node : tests/native-bridge.test.ts).
        guard let b = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let bridge = try? String(contentsOf: b, encoding: .utf8) else { return nil }
        ctx.evaluateScript(bridge)
        self.ctx = ctx
    }

    func validate(_ json: String) -> Result<FastConfigInfo, String> {
        guard let r = ctx.objectForKeyedSubscript("vtcValidate")?.call(withArguments: [json])?.toString(),
              let d = try? JSONSerialization.jsonObject(with: Data(r.utf8)) as? [String: Any] else { return .failure("Erreur interne") }
        if d["ok"] as? Bool == true { return .success(FastConfigInfo(configId: d["configId"] as? String ?? "?", json: json, voice: d["voice"] as? Bool ?? true)) }
        return .failure(d["error"] as? String ?? "Configuration refusée")
    }

    func analyze(text: String, config: FastConfigInfo, capturedAt: Date) -> AnalysisOutput? {
        let iso = ISO8601DateFormatter.withMs.string(from: capturedAt)
        guard let r = ctx.objectForKeyedSubscript("vtcAnalyze")?.call(withArguments: [text, config.json, iso])?.toString(),
              let d = try? JSONSerialization.jsonObject(with: Data(r.utf8)) as? [String: Any],
              d["error"] == nil else { return nil }
        return AnalysisOutput(
            id: d["id"] as? String ?? UUID().uuidString,
            title: d["title"] as? String ?? "",
            body: d["body"] as? String ?? "",
            speech: d["speech"] as? String ?? "",
            verdict: d["verdict"] as? String ?? "indisponible",
            status: d["status"] as? String ?? "not_offer",
            fingerprint: d["fingerprint"] as? String ?? "",
            validUntil: ISO8601DateFormatter.withMs.date(from: d["validUntil"] as? String ?? "") ?? capturedAt,
            journalLine: d["journalLine"] as? String ?? "")
    }
}

extension ISO8601DateFormatter {
    static let withMs: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

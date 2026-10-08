// Capture continue autorisée par l'utilisateur via le sélecteur système (ScreenCaptureKit, iOS 27+),
// détection de changement, OCR Vision local, calcul via le moteur partagé, notification + voix.
// Références Apple : "Capturing screen content on iOS" (iOS 27), UIBackgroundModes "screen-capture".
import Foundation
import ScreenCaptureKit
import CoreMedia
import CoreImage
import Vision
import UIKit
import UserNotifications
import AVFoundation

@MainActor
final class CaptureEngine: NSObject, ObservableObject {
    @Published var isCapturing = false
    @Published var statusText = "Arrêtée"
    @Published var lastTitle = ""
    @Published var lastBody = ""
    @Published var lastLatencyMs: Int?
    @Published var config: FastConfigInfo?
    @Published var voice = true
    @Published var journalCount = 0

    private let picker = SCContentSharingPicker.shared
    private var stream: SCStream?
    private let core = CoreBridge()
    private let speech = AVSpeechSynthesizer()
    private let processing = FrameProcessor()
    private var lastFingerprint = ""
    private var lastFingerprintAt = Date.distantPast

    let journalURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("journal.jsonl")
    private let configURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("config.json")

    override init() {
        super.init()
        if let s = try? String(contentsOf: configURL, encoding: .utf8), case .success(let c)? = core?.validate(s) { config = c; voice = c.voice }
        journalCount = (try? String(contentsOf: journalURL, encoding: .utf8))?.split(separator: "\n").count ?? 0
        processing.onCandidate = { [weak self] text, changedAt in
            Task { @MainActor in self?.handle(text: text, changedAt: changedAt) }
        }
    }

    func requestNotificationPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    func importConfigFromPasteboard() -> String {
        guard let core, let s = UIPasteboard.general.string else { return "Presse-papiers vide" }
        switch core.validate(s) {
        case .success(let c):
            try? s.write(to: configURL, atomically: true, encoding: .utf8)
            config = c; voice = c.voice
            return "Configuration \(c.configId) enregistrée"
        case .failure(let e): return "Refusée : \(e)"
        }
    }

    func presentPicker() {
        var cfg = SCContentSharingPickerConfiguration()
        cfg.showsMicrophoneControl = false
        picker.defaultConfiguration = cfg
        picker.add(self)
        picker.isActive = true
        picker.present() // l'utilisateur choisit « Écran entier »
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
        picker.isActive = false
        isCapturing = false
        statusText = "Arrêtée"
    }

    fileprivate func start(with filter: SCContentFilter) async {
        await stop()
        let conf = SCStreamConfiguration()
        let b = UIScreen.main.bounds.size, sc = UIScreen.main.scale
        // Demi-résolution : suffisant pour l'OCR des montants, moins de mémoire et d'énergie.
        conf.width = Int(b.width * sc / 2)
        conf.height = Int(b.height * sc / 2)
        conf.minimumFrameInterval = CMTime(value: 1, timescale: 4) // 4 images/s au plus
        conf.pixelFormat = kCVPixelFormatType_32BGRA
        conf.queueDepth = 3
        let s = SCStream(filter: filter, configuration: conf, delegate: self)
        do {
            try s.addStreamOutput(processing, type: .screen, sampleHandlerQueue: processing.queue)
            try await s.startCapture()
            stream = s
            isCapturing = true
            statusText = "Capture active : en attente d'une offre"
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers, .mixWithOthers])
        } catch {
            statusText = "Échec du démarrage : \(error.localizedDescription)"
        }
    }

    private func handle(text: String, changedAt: Date) {
        guard let core, let config else { return }
        guard let a = core.analyze(text: text, config: config, capturedAt: changedAt) else { return }
        if a.status == "not_offer" { return }                       // écran sans offre : silence
        if a.fingerprint == lastFingerprint && Date().timeIntervalSince(lastFingerprintAt) < 30 { return } // même offre
        if Date() > a.validUntil { return }                          // résultat déjà périmé : rien
        lastFingerprint = a.fingerprint; lastFingerprintAt = Date()
        lastTitle = a.title; lastBody = a.body
        let content = UNMutableNotificationContent()
        content.title = a.title
        content.body = a.body
        content.interruptionLevel = .active
        content.threadIdentifier = "offre"
        // Identifiant constant : une nouvelle offre REMPLACE la notification précédente.
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "vtc-offre", content: content, trigger: nil))
        if voice && !a.speech.isEmpty {
            speech.stopSpeaking(at: .immediate)
            speech.speak(AVSpeechUtterance(string: a.speech).withFrench())
        }
        lastLatencyMs = Int(Date().timeIntervalSince(changedAt) * 1000)
        appendJournal(a.journalLine)
        appendJournal("{\"kind\":\"timing\",\"id\":\"\(a.id)\",\"afterNotifyMs\":\(lastLatencyMs ?? -1)}")
        // Retrait automatique à expiration : le résultat ne reste pas une recommandation active.
        let delay = max(0, a.validUntil.timeIntervalSinceNow)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["vtc-offre"])
        }
    }

    private func appendJournal(_ line: String) {
        guard !line.isEmpty, let data = (line + "\n").data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: journalURL) { h.seekToEndOfFile(); h.write(data); try? h.close() }
        else { try? data.write(to: journalURL) }
        journalCount += 1
    }
}

extension AVSpeechUtterance {
    func withFrench() -> AVSpeechUtterance { voice = AVSpeechSynthesisVoice(language: "fr-FR"); rate = 0.55; return self }
}

extension CaptureEngine: SCContentSharingPickerObserver {
    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in self.statusText = "Sélection annulée" }
    }
    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        Task { @MainActor in await self.start(with: filter) }
    }
    nonisolated func contentSharingPickerStartDidFailWithError(_ error: Error) {
        Task { @MainActor in self.statusText = "Erreur du sélecteur : \(error.localizedDescription)" }
    }
}

extension CaptureEngine: SCStreamDelegate {
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in self.isCapturing = false; self.statusText = "Capture arrêtée : \(error.localizedDescription)" }
    }
}

/// Traitement hors du fil principal : détection de changement d'écran puis OCR seulement si nécessaire.
final class FrameProcessor: NSObject, SCStreamOutput, @unchecked Sendable {
    let queue = DispatchQueue(label: "vtc.frames", qos: .userInitiated)
    var onCandidate: ((String, Date) -> Void)?
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private var lastSignature: [UInt8] = []
    private var busy = false

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !busy, let px = CMSampleBufferGetImageBuffer(sb) else { return }
        let image = CIImage(cvPixelBuffer: px)
        // Zone de l'offre : moitié inférieure de l'écran (carte d'offre). À ajuster selon le corpus.
        let ext = image.extent
        let roi = CGRect(x: ext.minX, y: ext.minY, width: ext.width, height: ext.height * 0.6)
        let sig = signature(image.cropped(to: roi))
        let changed = lastSignature.isEmpty || meanAbsDiff(sig, lastSignature) > 6
        lastSignature = sig
        guard changed else { return }
        busy = true
        let changedAt = Date()
        let req = VNRecognizeTextRequest { [weak self] r, _ in
            defer { self?.busy = false }
            let obs = (r.results as? [VNRecognizedTextObservation]) ?? []
            let lines = obs.sorted { $0.boundingBox.minY > $1.boundingBox.minY }.compactMap { $0.topCandidates(1).first?.string }
            let text = lines.joined(separator: "\n")
            // Préfiltre bon marché : une offre contient un montant en euros et une distance ou une durée.
            guard text.contains("€"), text.range(of: "km|min", options: .regularExpression) != nil else { return }
            self?.onCandidate?(text, changedAt)
        }
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        req.recognitionLanguages = ["fr-FR", "en-US"]
        req.regionOfInterest = CGRect(x: 0, y: 0, width: 1, height: 0.6) // coordonnées Vision : origine en bas
        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do { try handler.perform([req]) } catch { busy = false }
    }

    /// Empreinte 16x16 en niveaux de gris pour détecter un changement d'écran.
    private func signature(_ img: CIImage) -> [UInt8] {
        let scaled = img.transformed(by: CGAffineTransform(scaleX: 16 / max(img.extent.width, 1), y: 16 / max(img.extent.height, 1)))
        var buf = [UInt8](repeating: 0, count: 16 * 16 * 4)
        ciContext.render(scaled, toBitmap: &buf, rowBytes: 64, bounds: CGRect(x: scaled.extent.minX, y: scaled.extent.minY, width: 16, height: 16), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        return stride(from: 0, to: buf.count, by: 4).map { UInt8((Int(buf[$0]) + Int(buf[$0 + 1]) + Int(buf[$0 + 2])) / 3) }
    }
    private func meanAbsDiff(_ a: [UInt8], _ b: [UInt8]) -> Int {
        guard a.count == b.count, !a.isEmpty else { return 255 }
        var s = 0
        for i in 0..<a.count { s += abs(Int(a[i]) - Int(b[i])) }
        return s / a.count
    }
}

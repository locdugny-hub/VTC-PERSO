// Points d'entrée appelés par CoreBridge.swift (JavaScriptCore). Testé sous Node : tests/native-bridge.test.ts
function vtcAnalyze(text, cfgJson, capturedAtIso) {
  var cfg = JSON.parse(cfgJson);
  var v = VTCCore.validateFastConfig(cfg);
  if (!v.ok) return JSON.stringify({ error: v.errors.join(', ') });
  var a = VTCCore.analyzeText(text, v.config, { capturedAt: capturedAtIso, source: 'native' });
  var o = a.offer;
  return JSON.stringify({
    id: a.id, title: a.display.title, body: a.display.body, speech: a.display.speech,
    verdict: a.verdict.verdict, status: o.status, validUntil: a.validUntil,
    fingerprint: [o.platform.value, o.price.value, o.approachKm.value, o.tripKm.value, o.tripMin.value].join('|'),
    journalLine: JSON.stringify({ kind: 'analysis', analysis: a })
  });
}
function vtcValidate(cfgJson) {
  try { var v = VTCCore.validateFastConfig(JSON.parse(cfgJson)); return v.ok ? JSON.stringify({ ok: true, configId: v.config.configId, voice: v.config.voice }) : JSON.stringify({ ok: false, error: v.errors.join(', ') }); }
  catch (e) { return JSON.stringify({ ok: false, error: 'JSON illisible' }); }
}

// icon-color: deep-blue; icon-glyph: car;
// VTC Perso – Traffic bundle test build
var __modules = {
"shortcut/scriptable-entry.ts": function(module, exports, __require){
"use strict";
// Script "VTC Perso" pour l'app Scriptable (gratuite), appelé par le raccourci iOS via l'action
// "Run Script" (Exécuter le script), SANS ouvrir l'app (option "Run In App" désactivée).
// Il reçoit le texte OCR produit par l'action Apple "Extraire le texte de l'image", applique le
// moteur local (même code que la PWA) avec la configuration enregistrée sur le téléphone,
// puis renvoie au raccourci le texte de la notification et de l'annonce vocale.
// Lancé directement dans Scriptable, il affiche un menu de configuration / export / synchronisation.
//
// Fichier généré par shortcut/build-scriptable.mjs : ne pas éditer shortcut/dist/VTCPerso.js à la main.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAnalyze = runAnalyze;
exports.extractUberAddresses = extractUberAddresses;
exports.runAnalyzeTraffic = runAnalyzeTraffic;
exports.runPost = runPost;
exports.main = main;
const core_1 = __require("src/core/index.ts");
const runtime_1 = __require("shortcut/runtime.ts");
function parseIsoMs(s) {
    if (!s || typeof s !== 'string')
        return null;
    // Raccourcis peut produire "2026-10-08T14:02:31.123+02:00" ou "2026-10-08 14:02:31,123".
    const t = Date.parse(s.trim().replace(' ', 'T').replace(/,(\d{1,3})/, '.$1'));
    return Number.isFinite(t) ? t : null;
}
/** Cœur du parcours rapide, testable hors iPhone avec un Runtime simulé. */
function runAnalyze(rt, input) {
    const scriptStart = rt.now();
    const t0ms = parseIsoMs(input.t0);
    const capturedAt = new Date(t0ms ?? scriptStart).toISOString();
    const id = rt.uuid();
    const log = !input.test; // un test fictif n'écrit rien dans le journal
    // Marque cette requête comme la plus récente AVANT le calcul, seulement si son déclenchement est
    // réellement plus récent que celui déjà enregistré (une requête retardée ne prend pas la place d'une plus récente).
    const prev = rt.readJson('latest.json');
    const prevT = prev && typeof prev.capturedAt === 'string' ? Date.parse(prev.capturedAt) : -Infinity;
    if (!(prevT > Date.parse(capturedAt)))
        rt.writeJson('latest.json', { id, capturedAt });
    const cfgRaw = rt.readJson('config.json');
    const v = cfgRaw ? (0, core_1.validateFastConfig)(cfgRaw) : null;
    if (!v || !v.ok) {
        const out = {
            show: true,
            speak: false,
            title: '⚠️ Analyse indisponible',
            body: v && !v.ok ? 'Configuration invalide : ' + v.errors[0] : 'Configuration absente : ouvrez VTC Perso dans Scriptable',
            speech: '',
            id,
            verdict: 'indisponible',
            configId: null,
        };
        if (log)
            rt.appendJournal({ kind: 'error', id, at: capturedAt, message: out.body });
        return out;
    }
    const cfg = v.config;
    const text = typeof input.text === 'string' ? input.text : '';
    const a = (0, core_1.analyzeText)(text, cfg, { id, capturedAt, now: () => new Date(rt.now()), source: 'shortcut' });
    const latest = rt.readJson('latest.json');
    const decision = (0, core_1.shouldDisplay)(a, latest, new Date(rt.now()));
    const scriptEnd = rt.now();
    if (log) {
        rt.appendJournal({ kind: 'analysis', analysis: a });
        rt.appendJournal({
            kind: 'timing',
            id,
            scriptStartMs: t0ms !== null ? scriptStart - t0ms : undefined,
            scriptEndMs: t0ms !== null ? scriptEnd - t0ms : undefined,
            suppressed: !decision.show,
        });
    }
    if (!decision.show) {
        return { show: false, speak: false, title: '', body: decision.reason, speech: '', id, verdict: a.verdict.verdict, configId: cfg.configId };
    }
    return {
        show: true,
        speak: cfg.voice && a.display.speech.length > 0,
        title: a.display.title,
        body: a.display.body,
        speech: a.display.speech,
        id,
        verdict: a.verdict.verdict,
        configId: cfg.configId,
    };
}
/** Deux adresses visibles dans une carte Uber. Aucune adresse n'est inventée. */
function extractUberAddresses(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
    const found = [];
    for (let i=0;i<lines.length;i++) {
        let clean = lines[i].replace(/^[•|\-\s]+/, '').replace(/\s+/g, ' ').trim();
        if (!/^\d{1,4}\s+(?:bis\s+)?(?:rue|avenue|av\.?|boulevard|bd\.?|place|allée|allee|chemin|route|quai|impasse|passage|cours)\s+.+/i.test(clean)) continue;
        // An OCR-wrapped address must include its postcode and city.
        if (!/\b\d{5}\b/.test(clean) && i+1<lines.length && /\b\d{5}\b/.test(lines[i+1])) {
            clean += ' ' + lines[++i].replace(/\s+/g,' ').trim();
        }
        if (/\b\d{5}\b/.test(clean) && clean.length<=200) found.push(clean);
    }
    return found.length>=2 && found[0]!==found[1] ? {pickup:found[0],destination:found[1]} : null;
}
function compactFallback(base) {
    if (!base || !base.show) return base;
    const v = String(base.verdict ?? '').toLowerCase();
    const grade = v === 'favorable' ? 'BON' : v === 'faible' ? 'MAUVAIS' : 'MOYEN';
    const icon = grade === 'BON' ? '🟢' : grade === 'MOYEN' ? '🟠' : '🔴';
    const km = String(base.title ?? '').match(/\d+(?:[.,]\d+)?\s*€\s*\/\s*km/i)?.[0] ?? '';
    const amount = String(base.body ?? '').match(/\b\d+(?:[.,]\d{1,2})?\s*€/i)?.[0] ?? '';
    return { ...base, title: icon + ' ' + grade + ' · sans trafic',
      body: [amount, km].filter(Boolean).join(' · ') || 'Analyse partielle',
      speech: grade.toLowerCase(), verdict: grade.toLowerCase(), speak: base.speak };
}

// Screenshot offer formats may come from video screenshots, not just native Uber UI.
function parseVideoOffer(raw) {
 const t=String(raw||'').replace(/\u00a0/g,' ').replace(/[•·]/g,' · ');
 const euro=t.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*€/);
 if(!euro)return null;
 const price=Number(euro[1].replace(',','.'));
 if(!Number.isFinite(price)||price<=0)return null;
 const approach=t.match(/(\d{1,3})\s*min\s*(?:\(\s*(?:à\s*)?(\d+(?:[.,]\d+)?)\s*km\s*\)|·\s*(\d+(?:[.,]\d+)?)\s*km)/i);
 const trip=t.match(/(?:course\s+de\s+(\d+(?:[.,]\d+)?)\s*km)|(?:(\d{1,3})\s*min\s*·\s*(\d+(?:[.,]\d+)?)\s*km)/i);
 if(!approach||!trip)return null;
 const approachMin=Number(approach[1]),approachKm=Number((approach[2]||approach[3]).replace(',','.'));
 const tripKm=Number((trip[1]||trip[3]).replace(',','.'));
 const tripMin=trip[2]?Number(trip[2]):null;
 if(![approachMin,approachKm,tripKm].every(Number.isFinite)||approachMin<0||approachMin>90||approachKm<0||tripKm<=0)return null;
 return {price,approachMin,approachKm,tripKm,tripMin};
}
function videoPair(raw) {
 const lines=String(raw||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
 const entries=[];
 for(let i=0;i<lines.length;i++){
  let a=lines[i].replace(/\s+/g,' ');
  if(!/^\d{1,4}\s+(?:rue|av\.?|avenue|bd\.?|boulevard|place|allée|allee|route|quai|impasse|passage|cours)\b/i.test(a))continue;
  for(let j=i+1;j<=Math.min(i+2,lines.length-1)&&!/\b\d{5}\b/.test(a);j++)a+=' '+lines[j];
  if(/\b\d{5}\b/.test(a))entries.push(a);
 }
 return entries.length>=2?{pickup:entries[0],destination:entries[1]}:null;
}
function videoVerdict(base, offer, tripMin, hasTraffic) {
 if(!Number.isFinite(tripMin)||tripMin<=0)return { ...base,show:true,title:'⚪ INCOMPLET',body:'Durée trajet indisponible',speech:'',speak:false,verdict:'incomplet'};
 const minutes=offer.approachMin+tripMin, hour=60*offer.price/minutes;
 const km=offer.price/(offer.approachKm+offer.tripKm);
 const grade=hour<22.5?'MAUVAIS':hour<25?'MOYEN':'BON';
 const icon=grade==='BON'?'🟢':grade==='MOYEN'?'🟠':'🔴';
 const fmt=(n,d=1)=>n.toFixed(d).replace('.',',');
 return {...base,show:true,title:icon+' '+grade+' · '+fmt(hour)+' €/h',
  body:fmt(offer.price,2)+' € · '+minutes+' min · '+fmt(km,2)+' €/km'+(hasTraffic?'':' · sans trafic'),
  speech:grade.toLowerCase(),verdict:grade.toLowerCase(),speak:base.speak};
}
async function runAnalyzeTraffic(rt, input) {
    // Uber OCR: approach without a label directly after "Montant net de frais".
    const raw = typeof input.text === 'string' ? input.text : '';
    const labeled = /montant net de frais/i.test(raw)
      ? raw.replace(/(^|\n)([ \t]*[•·*-]?[ \t]*)(\d{1,2}[ \t]*min[ \t]*\([ \t]*\d+(?:[.,]\d+)?[ \t]*km[ \t]*\))/im,
          '$1Approche : $3')
      : raw;
    input = { ...input, text: labeled };
    const base = runAnalyze(rt, input);
    const offer = parseVideoOffer(raw);
    if (offer) {
      const pair = videoPair(raw) || extractUberAddresses(raw);
      // When a screenshot provides a trip time directly, evaluate it immediately.
      // For a distance-only offer, require a live TomTom route; never invent duration.
      if (offer.tripMin !== null) return videoVerdict(base, offer, offer.tripMin, false);
      if (pair && rt.hasToken()) {
        const route = await rt.trafficRoute(pair.pickup, pair.destination);
        if(route && route.trip_km>0.40*offer.tripKm && route.trip_km<2.5*offer.tripKm)
          return videoVerdict(base, offer, route.trip_minutes, true);
      }
      return {...base,show:true,title:'⚪ INCOMPLET',body:'Trajet non vérifié',speech:'',speak:false,verdict:'incomplet'};
    }
    if (!base.show || !rt.hasToken() || !/\buber\b|uberx/i.test(input.text ?? ''))
        return compactFallback(base);
    const pair = extractUberAddresses(input.text ?? '');
    if (!pair)
        return compactFallback(base);
    const cfg = rt.readJson('config.json');
    if (!cfg)
        return compactFallback(base);
    const route = await rt.trafficRoute(pair.pickup, pair.destination);
    if (!route)
        return compactFallback(base);
    const latest = rt.readJson('latest.json');
    if (!latest || latest.id !== base.id || Date.now() - Date.parse(latest.capturedAt) > 15000)
        return { ...base, show: false, title: '', speech: '' };
    const lines = (input.text ?? '').split('\n');
    const amountLine = lines.find(l => /^\s*\d{1,4}(?:[.,]\d{1,2})?\s*€\s*$/.test(l));
    const price = amountLine ? Number(amountLine.replace(/[^0-9,.]/g, '').replace(',', '.')) : NaN;
    const approach = (input.text ?? '').match(/(\d{1,2})\s*min\s*\(\s*\d+(?:[.,]\d+)?\s*km\s*\)/i);
    if (!Number.isFinite(price) || price <= 0 || !approach || !/montant net de frais/i.test(input.text ?? ''))
        return compactFallback(base);
    const minutes = Number(approach[1]) + route.trip_minutes;
    const hourly = 60 * price / minutes;
    const target = 25;
    // Kilometer economics follow the existing configured local analyzer;
    // do not invent an extra €/km threshold or ignore its low verdict.
    const localKmMatch = String(base.title ?? '').match(/(\d+(?:[.,]\d+)?)\s*€\s*\/\s*km/i);
    const kmRate = localKmMatch ? Number(localKmMatch[1].replace(',', '.')) : null;
    const kmWeak = kmRate !== null && base.verdict === 'faible';
    const hourlyOk = hourly >= target;
    // Three immediate outcomes. The local km threshold can downgrade "BON" to "MOYEN".
    // A marginal hourly outcome is never promoted by a favorable km rate.
    const grade = hourly < target * 0.90 ? 'MAUVAIS'
      : hourly < target || kmWeak || kmRate === null ? 'MOYEN' : 'BON';
    const symbol = grade === 'BON' ? '🟢' : grade === 'MOYEN' ? '🟠' : '🔴';
    const fmt = n => n.toFixed(1).replace('.', ',');
    const title = `${symbol} ${grade} · ${fmt(hourly)} €/h`;
    const body = `${price.toFixed(2).replace('.', ',')} € · ${minutes} min · ${kmRate === null ? '€/km —' : kmRate.toFixed(2).replace('.', ',') + ' €/km'}`;
    // Keep complete analysis in the local journal, only shorten the real-time alert.
    return { ...base, title, body, speech: grade.toLowerCase(), verdict: grade.toLowerCase(), speak: !!cfg.voice };
}
/** Appelé après l'affichage : enregistre l'instant de restitution (mesure) ; synchronise si demandé. */
async function runPost(rt, input) {
    const latest = rt.readJson('latest.json');
    const t0 = latest && latest.id === input.id ? Date.parse(latest.capturedAt) : null;
    const tn = parseIsoMs(input.tNotify) ?? rt.now();
    if (input.id)
        rt.appendJournal({ kind: 'timing', id: input.id, afterNotifyMs: t0 !== null ? tn - t0 : undefined });
    const cfgRaw = rt.readJson('config.json');
    if (cfgRaw && cfgRaw.syncMode === 'after_each')
        return rt.sync(cfgRaw);
    return 'ok';
}
async function inAppMenu(rt) {
    const choice = await rt.menu('VTC Perso', [
        'Importer la configuration (presse-papiers)',
        'Tester une offre fictive (notification + voix)',
        'Copier le journal dans le presse-papiers',
        'Synchroniser maintenant',
        'Enregistrer le jeton d’appareil (presse-papiers)',
        'Installer la configuration de démonstration',
        'État',
    ]);
    if (choice === 0) {
        const txt = rt.pasteboard();
        let obj = null;
        try {
            obj = JSON.parse(txt ?? '');
        }
        catch {
            /* noop */
        }
        const v = (0, core_1.validateFastConfig)(obj);
        if (!v.ok)
            return rt.alert('Configuration refusée', v.errors.join('\n'));
        rt.writeJson('config.json', v.config);
        return rt.alert('Configuration enregistrée', `${v.config.configId}\nCoûts v${v.config.cost.version}, seuils v${v.config.thresholds.version}`);
    }
    if (choice === 1) {
        const fake = 'OFFRE FICTIVE\nUberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)';
        const out = runAnalyze(rt, { mode: 'analyze', text: fake, t0: new Date(rt.now()).toISOString(), test: true });
        rt.notify(out.title, out.body + ' (TEST FICTIF)');
        if (out.speak)
            rt.speak(out.speech);
        return rt.alert(out.title, out.body + '\n\nCe test vérifie la configuration, la notification et la voix. Il ne mesure pas le parcours réel.');
    }
    if (choice === 2) {
        const n = rt.copyJournal();
        return rt.alert('Journal copié', `${n} ligne(s). Collez-les dans la PWA : Réglages > Données > Importer le journal du raccourci.`);
    }
    if (choice === 3) {
        const cfg = rt.readJson('config.json');
        if (!cfg)
            return rt.alert('Synchronisation', 'Configuration absente');
        return rt.alert('Synchronisation', await rt.sync(cfg));
    }
    if (choice === 4) {
        const tok = (rt.pasteboard() ?? '').trim();
        if (!/^vtcd_[A-Za-z0-9_-]{30,}$/.test(tok))
            return rt.alert('Jeton refusé', 'Le presse-papiers ne contient pas un jeton VTC Perso (vtcd_…).');
        rt.setToken(tok);
        return rt.alert('Jeton enregistré', 'Stocké dans le trousseau iOS de Scriptable. Révocable depuis la PWA.');
    }
    if (choice === 5) {
        rt.writeJson('config.json', (0, core_1.demoConfig)());
        return rt.alert('Démonstration', 'Configuration FICTIVE installée (v=0,20 €/km, f=5 €/h, seuils marge 1 €/km et 18 €/h). Remplacez-la par la vôtre avant de conduire.');
    }
    if (choice === 6) {
        const cfg = rt.readJson('config.json');
        return rt.alert('État', `Configuration : ${cfg ? cfg.configId + ' du ' + cfg.createdAt.slice(0, 10) : 'absente'}\nEn attente de synchronisation : ${rt.pendingCount()}\nJeton : ${rt.hasToken() ? 'oui' : 'non'}`);
    }
}
async function main() {
    const rt = (0, runtime_1.createRuntime)();
    const p = (typeof args !== 'undefined' ? args.shortcutParameter : undefined);
    const input = typeof p === 'string' ? { mode: 'analyze', text: p } : p && typeof p === 'object' ? p : null;
    if (!input) {
        if (config.runsInApp)
            await inAppMenu(rt);
        rt.complete(null);
        return;
    }
    try {
        if (input.mode === 'post') {
            rt.complete(await runPost(rt, input));
        }
        else if (input.mode === 'sync') {
            const cfg = rt.readJson('config.json');
            rt.complete(cfg ? await rt.sync(cfg) : 'Configuration absente');
        }
        else {
            rt.complete(await runAnalyzeTraffic(rt, input));
        }
    }
    catch (e) {
        // Jamais de dialogue bloquant dans le parcours : on renvoie un résultat "indisponible".
        rt.complete({ show: true, speak: false, title: '⚠️ Analyse indisponible', body: 'Erreur interne : ' + String(e).slice(0, 80), speech: '', id: '', verdict: 'indisponible', configId: null });
    }
}

},
"src/core/index.ts": function(module, exports, __require){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(__require("src/core/types.ts"), exports);
__exportStar(__require("src/core/finance.ts"), exports);
__exportStar(__require("src/core/verdict.ts"), exports);
__exportStar(__require("src/core/parse.ts"), exports);
__exportStar(__require("src/core/analyze.ts"), exports);
__exportStar(__require("src/core/config.ts"), exports);
__exportStar(__require("src/core/domain.ts"), exports);
__exportStar(__require("src/core/history.ts"), exports);
__exportStar(__require("src/core/aggregate.ts"), exports);
__exportStar(__require("src/core/backup.ts"), exports);
__exportStar(__require("src/core/sync.ts"), exports);

},
"src/core/types.ts": function(module, exports, __require){
"use strict";
// Types partagés par le moteur, les parseurs, la PWA, le script du raccourci,
// les fonctions serveur et (via le bundle JS) le composant natif.
// Aucune dépendance : ce module doit rester pur.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARSER_VERSION = exports.ENGINE_VERSION = void 0;
exports.ENGINE_VERSION = 'engine-1.0.0';
exports.PARSER_VERSION = 'parser-1.0.0';

},
"src/core/finance.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.driverRevenue = driverRevenue;
exports.computeFinance = computeFinance;
exports.round = round;
exports.fmtEur = fmtEur;
exports.fmtNum = fmtNum;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
function sumKnown(parts, required) {
    // Les termes "required" doivent tous être connus ; les autres sont optionnels mais
    // s'ils sont fournis (non null), ils sont ajoutés.
    for (const r of required)
        if (!isNum(r))
            return null;
    let s = 0;
    for (const p of parts)
        if (isNum(p))
            s += p;
    return s;
}
/** Recette chauffeur P à partir du montant lu et de sa base. */
function driverRevenue(price, basis, commissionRate) {
    if (!isNum(price) || price < 0)
        return { P: null, upperBound: false, note: 'Prix inconnu' };
    if (basis === 'net_driver')
        return { P: price, upperBound: false, note: null };
    if (basis === 'gross_before_commission') {
        if (!isNum(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
            // Aucune commission déduite sans taux confirmé : le montant affiché n'est qu'une borne haute de P.
            return { P: price, upperBound: true, note: 'Montant avant commission, taux non confirmé : montant affiché utilisé comme borne haute' };
        }
        return { P: price * (1 - commissionRate), upperBound: false, note: `Commission ${(commissionRate * 100).toFixed(1)} % déduite` };
    }
    // Base inconnue : on garde le montant affiché comme borne haute de la recette chauffeur.
    return { P: price, upperBound: true, note: 'Base du prix inconnue : montant affiché utilisé comme borne haute' };
}
function computeFinance(input) {
    const notes = [];
    const missing = [];
    const rev = driverRevenue(input.price, input.priceBasis, input.commissionRate);
    if (rev.note)
        notes.push(rev.note);
    if (rev.P === null)
        missing.push('P');
    const sc = input.scenario;
    const returnKm = isNum(sc.returnKm) && sc.returnKm > 0 ? sc.returnKm : null;
    const returnMin = isNum(sc.returnMin) && sc.returnMin > 0 ? sc.returnMin : null;
    const waitMin = isNum(sc.waitMin) && sc.waitMin > 0 ? sc.waitMin : null;
    if ((returnKm === null) !== (returnMin === null))
        notes.push('Retour simulé incomplet : ignoré');
    const useReturn = returnKm !== null && returnMin !== null;
    if (useReturn)
        notes.push(`Retour simulé inclus : ${returnKm} km / ${returnMin} min`);
    if (waitMin !== null)
        notes.push(`Attente incluse : ${waitMin} min`);
    const D = sumKnown([input.approachKm, input.tripKm, useReturn ? returnKm : null], [input.approachKm, input.tripKm]);
    const T = sumKnown([input.approachMin, input.tripMin, useReturn ? returnMin : null, waitMin], [input.approachMin, input.tripMin]);
    if (!isNum(input.approachKm))
        missing.push('distance d’approche');
    if (!isNum(input.tripKm))
        missing.push('distance du trajet');
    if (!isNum(input.approachMin))
        missing.push('durée d’approche');
    if (!isNum(input.tripMin))
        missing.push('durée du trajet');
    const P = rev.P;
    const revenuePerKm = P !== null && D !== null && D > 0 ? P / D : null;
    const revenuePerHour = P !== null && T !== null && T > 0 ? (60 * P) / T : null;
    if (D === 0)
        notes.push('Distance totale nulle : €/km indisponible');
    if (T === 0)
        notes.push('Durée totale nulle : €/h indisponible');
    const v = isNum(input.variablePerKm) && input.variablePerKm >= 0 ? input.variablePerKm : null;
    const f = isNum(input.fixedPerHour) && input.fixedPerHour >= 0 ? input.fixedPerHour : null;
    const E = isNum(input.otherCosts) && input.otherCosts >= 0 ? input.otherCosts : null;
    if (v === null)
        missing.push('coût variable v');
    if (f === null)
        missing.push('allocation fixe f');
    const variableCost = v !== null && D !== null ? v * D : null;
    const fixedAllocation = f !== null && T !== null ? (f * T) / 60 : null;
    let margin = null;
    let marginExcludesOther = false;
    if (P !== null && variableCost !== null && fixedAllocation !== null) {
        margin = P - variableCost - fixedAllocation - (E ?? 0);
        if (E === null) {
            marginExcludesOther = true;
            notes.push('Autres frais E non renseignés : marge hors E (borne haute)');
        }
    }
    const marginPerKm = margin !== null && D !== null && D > 0 ? margin / D : null;
    const marginPerHour = margin !== null && T !== null && T > 0 ? (60 * margin) / T : null;
    return {
        P,
        pIsUpperBound: rev.upperBound,
        D,
        T,
        revenuePerKm,
        revenuePerHour,
        variableCost,
        fixedAllocation,
        margin,
        marginExcludesOther,
        marginPerKm,
        marginPerHour,
        notes,
        missing,
    };
}
/** Arrondi d'affichage (jamais utilisé dans les calculs). */
function round(x, digits = 2) {
    if (!isNum(x))
        return null;
    const k = 10 ** digits;
    return Math.round((x + Number.EPSILON) * k) / k;
}
function fmtEur(x, digits = 2) {
    if (!isNum(x))
        return '—';
    return x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' €';
}
function fmtNum(x, digits = 2) {
    if (!isNum(x))
        return '—';
    return x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

},
"src/core/verdict.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERDICT_SYMBOL = exports.VERDICT_LABEL = exports.LIMIT_FACTOR = void 0;
exports.computeVerdict = computeVerdict;
exports.LIMIT_FACTOR = 0.8;
function computeVerdict(fin, th) {
    const reasons = [];
    const level = th.level;
    const validTh = th.perKm > 0 && th.perHour > 0 && Number.isFinite(th.perKm) && Number.isFinite(th.perHour);
    if (!validTh) {
        return { verdict: 'indisponible', level, perKm: null, perHour: null, ratioKm: null, ratioHour: null, reasons: ['Seuils invalides'] };
    }
    if (fin.P === null) {
        return {
            verdict: 'indisponible',
            level,
            perKm: null,
            perHour: null,
            ratioKm: null,
            ratioHour: null,
            reasons: ['Recette chauffeur inconnue', ...fin.missing.filter((m) => m !== 'P').map((m) => `${m} manquant`)],
        };
    }
    const perKm = level === 'revenue' ? fin.revenuePerKm : fin.marginPerKm;
    const perHour = level === 'revenue' ? fin.revenuePerHour : fin.marginPerHour;
    const ratioKm = perKm === null ? null : perKm / th.perKm;
    const ratioHour = perHour === null ? null : perHour / th.perHour;
    // Incertitudes qui font des ratios des bornes hautes.
    const upper = fin.pIsUpperBound || (level === 'margin' && fin.marginExcludesOther);
    if (fin.pIsUpperBound)
        reasons.push('Base du prix non confirmée');
    if (level === 'margin' && fin.marginExcludesOther)
        reasons.push('Autres frais non renseignés');
    if (level === 'margin' && fin.margin === null) {
        const costsMissing = fin.missing.includes('coût variable v') || fin.missing.includes('allocation fixe f');
        reasons.push(costsMissing ? 'Coûts non renseignés : marge indisponible' : 'Marge indisponible : distance ou durée manquante');
    }
    if (perKm === null)
        reasons.push('€/km indisponible');
    if (perHour === null)
        reasons.push(fin.T === null ? '€/h indisponible (durée manquante)' : '€/h indisponible');
    const available = [ratioKm, ratioHour].filter((r) => r !== null);
    const anyBelowLimit = available.some((r) => r < exports.LIMIT_FACTOR);
    if (anyBelowLimit) {
        // Certain même avec une donnée manquante ou une borne haute.
        if (ratioKm !== null && ratioKm < exports.LIMIT_FACTOR)
            reasons.unshift(`€/km sous 80 % du seuil`);
        if (ratioHour !== null && ratioHour < exports.LIMIT_FACTOR)
            reasons.unshift(`€/h sous 80 % du seuil`);
        return { verdict: 'faible', level, perKm, perHour, ratioKm, ratioHour, reasons };
    }
    if (available.length < 2 || upper) {
        if (available.length === 0) {
            // Niveau "marge" sans coûts : les indicateurs avant frais restent affichables => partiel, pas indisponible.
            const pre = fin.revenuePerKm !== null || fin.revenuePerHour !== null;
            return { verdict: pre ? 'partiel' : 'indisponible', level, perKm, perHour, ratioKm, ratioHour, reasons };
        }
        return { verdict: 'partiel', level, perKm, perHour, ratioKm, ratioHour, reasons };
    }
    const [rk, rh] = [ratioKm, ratioHour];
    if (rk >= 1 && rh >= 1)
        return { verdict: 'favorable', level, perKm, perHour, ratioKm, ratioHour, reasons: ['Deux seuils atteints', ...reasons] };
    if (rk < 1)
        reasons.unshift('€/km sous le seuil');
    if (rh < 1)
        reasons.unshift('€/h sous le seuil');
    return { verdict: 'limite', level, perKm, perHour, ratioKm, ratioHour, reasons };
}
exports.VERDICT_LABEL = {
    favorable: 'Favorable',
    limite: 'Limite',
    faible: 'Faible',
    partiel: 'Partiel',
    indisponible: 'Analyse indisponible',
};
exports.VERDICT_SYMBOL = {
    favorable: '✅',
    limite: '🟠',
    faible: '⛔',
    partiel: '❔',
    indisponible: '⚠️',
};

},
"src/core/parse.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fold = fold;
exports.normalizeText = normalizeText;
exports.parseDecimal = parseDecimal;
exports.detectPlatform = detectPlatform;
exports.parseOffer = parseOffer;
// Extraction des champs d'une offre Uber / Bolt (France, EUR, km) depuis un texte OCR.
// Principes :
//  - aucun "premier nombre trouvé" : chaque valeur est rattachée à une unité et à une ancre ;
//  - une donnée absente reste null ; une donnée ambiguë n'est pas inventée ;
//  - chaque champ conserve sa provenance, son fragment source et la règle utilisée.
// Les ancres sont des hypothèses de format à valider sur un corpus de captures réelles.
const types_1 = __require("src/core/types.ts");
const none = () => ({ value: null, provenance: 'none' });
const ocr = (value, raw, rule, confidence = 'high') => ({
    value,
    provenance: 'ocr',
    raw: raw.slice(0, 60),
    rule,
    confidence,
});
/** Minuscule, sans accents, espaces normalisés. */
function fold(s) {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}
function normalizeText(input) {
    let t = input.replace(/\r\n?/g, '\n');
    t = t.replace(/[    ]/g, ' ');
    t = t.replace(/[‒–—−]/g, '-');
    t = t.replace(/\bEUR\b|\beur\b|\bEuros?\b|\beuros?\b/g, '€');
    // Confusions OCR fréquentes, seulement au contact de chiffres.
    t = t.replace(/(\d)[Oo](?=[\d.,\s€)]|$)/gm, '$10');
    t = t.replace(/(\d[.,])[Oo]/g, '$10');
    t = t.replace(/(\d)[lI](?=\d)/g, '$11');
    t = t.replace(/[ \t]+/g, ' ');
    return t
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join('\n');
}
function parseDecimal(s) {
    const c = s.replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(c))
        return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
}
const MONEY_RE = /(\+\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*€(\s*\/\s*(?:km|h|heure|min))?|€\s*(\d{1,4}(?:[.,]\d{1,2})?)(\s*\/\s*(?:km|h|heure|min))?/g;
const DUR_RE = /(\d{1,2})\s*h\s*(\d{1,2})?\s*(?:min|mn)?\b|(\d{1,3})\s*(?:mins?|mn|minutes?)\b/g;
const DIST_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(km|mi|m)\b/g;
function tokenize(t) {
    const money = [];
    for (const m of t.matchAll(MONEY_RE)) {
        const num = m[2] ?? m[4];
        const v = parseDecimal(num);
        if (v === null)
            continue;
        money.push({
            kind: 'money',
            value: v,
            start: m.index,
            end: m.index + m[0].length,
            raw: m[0],
            unitOk: true,
            plus: !!m[1],
            rate: !!(m[3] ?? m[5]),
        });
    }
    const legs = [];
    for (const m of t.matchAll(DUR_RE)) {
        let v;
        const hourFmt = m[1] !== undefined;
        if (hourFmt)
            v = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
        else
            v = Number(m[3]);
        if (!Number.isFinite(v))
            continue;
        const hasMin = /m(i)?n/i.test(m[0]);
        if (hourFmt && !hasMin) {
            // Une heure d'horloge ("vers 2h35", "arrivée à 14 h 05") n'est pas une durée.
            const ls = t.lastIndexOf('\n', m.index - 1) + 1;
            const before = fold(t.slice(Math.max(ls, m.index - 16), m.index));
            if (/(vers|arriv|depos|prevu|avant|apres|heure|a)\s*$/.test(before))
                continue;
        }
        legs.push({ kind: 'dur', value: v, start: m.index, end: m.index + m[0].length, raw: m[0], unitOk: true, hourNoMin: hourFmt && !hasMin });
    }
    for (const m of t.matchAll(DIST_RE)) {
        const v = parseDecimal(m[1]);
        if (v === null)
            continue;
        const unit = m[2];
        // Les miles ne sont pas supportés (France) : valeur conservée mais marquée invalide.
        const km = unit === 'km' ? v : unit === 'm' ? v / 1000 : v;
        legs.push({ kind: 'dist', value: km, start: m.index, end: m.index + m[0].length, raw: m[0], unitOk: unit !== 'mi' });
    }
    legs.sort((a, b) => a.start - b.start);
    return { money, legs };
}
const APPROACH_ANCHORS = [
    /(^|\s)a\s*$/, // "À 6 min" : le mot "à" juste avant
    /prise en charge/,
    /approche/,
    /pick-?up/,
    /jusqu'?au (client|passager)/,
    /vers (le )?(client|passager)/,
    /recuperation/,
    /pour rejoindre/,
];
const APPROACH_AFTER = [/^\s*\)?\s*(de distance|away|d'approche|pour (le|la) prise)/];
const TRIP_ANCHORS = [/trajet/, /course/, /destination/, /\btrip\b/, /depose/, /voyage/, /duree totale/];
const TRIP_AFTER = [/^\s*\)?\s*(trip|de trajet|de course|jusqu'a destination)/];
/** Associe durée et distance proches (même segment, séparateurs seulement). */
function pairLegs(t, toks) {
    const legs = [];
    const used = new Set();
    for (let i = 0; i < toks.length; i++) {
        const a = toks[i];
        if (used.has(a))
            continue;
        const b = toks[i + 1];
        if (b && !used.has(b) && b.kind !== a.kind) {
            const between = t.slice(a.end, b.start);
            // Séparateurs : tout caractère non alphanumérique (·, •, ¢ lu par l'OCR à la place de •, parenthèses...).
            if (/^[^A-Za-z0-9]*$/.test(between) && between.split('\n').length <= 2 && between.length <= 6) {
                used.add(a);
                used.add(b);
                const min = a.kind === 'dur' ? a : b;
                const km = a.kind === 'dist' ? a : b;
                legs.push({ min, km, start: a.start, end: b.end });
                continue;
            }
        }
        used.add(a);
        legs.push({ min: a.kind === 'dur' ? a : null, km: a.kind === 'dist' ? a : null, start: a.start, end: a.end });
    }
    return legs;
}
function lineBounds(t, pos) {
    const s = t.lastIndexOf('\n', pos - 1) + 1;
    let e = t.indexOf('\n', pos);
    if (e < 0)
        e = t.length;
    return [s, e];
}
function classify(t, leg, prevLegEnd) {
    const [ls] = lineBounds(t, leg.start);
    const prevLineStart = ls > 0 ? lineBounds(t, ls - 1)[0] : ls;
    const beforeStart = Math.max(prevLegEnd, prevLineStart);
    const beforeSameLine = fold(t.slice(Math.max(ls, prevLegEnd), leg.start));
    const beforeWide = fold(t.slice(beforeStart, leg.start));
    const [, le] = lineBounds(t, leg.end);
    const after = fold(t.slice(leg.end, Math.min(le, leg.end + 30)));
    const isA = APPROACH_ANCHORS.some((r) => r.test(beforeSameLine)) ||
        APPROACH_AFTER.some((r) => r.test(after)) ||
        APPROACH_ANCHORS.slice(1).some((r) => r.test(beforeWide));
    const isT = TRIP_ANCHORS.some((r) => r.test(beforeSameLine)) || TRIP_AFTER.some((r) => r.test(after)) || TRIP_ANCHORS.some((r) => r.test(beforeWide));
    // Priorité au contexte immédiat de la ligne.
    const aLine = APPROACH_ANCHORS.some((r) => r.test(beforeSameLine)) || APPROACH_AFTER.some((r) => r.test(after));
    const tLine = TRIP_ANCHORS.some((r) => r.test(beforeSameLine)) || TRIP_AFTER.some((r) => r.test(after));
    if (aLine && !tLine)
        return { role: 'approach', reason: 'anchor-line' };
    if (tLine && !aLine)
        return { role: 'trip', reason: 'anchor-line' };
    if (isA && !isT)
        return { role: 'approach', reason: 'anchor-context' };
    if (isT && !isA)
        return { role: 'trip', reason: 'anchor-context' };
    return { role: null, reason: isA && isT ? 'both-anchors' : 'no-anchor' };
}
const EXTRA_WORDS = /(inclus|boost|bonus|pourboire|\btip\b|majoration|supplement|peage|promo|prime|defi|quest|surge|dynamique|minimum)/;
const GROSS_CUES = /(prix client|paye par (le )?(client|passager)|tarif (client|passager)|avant commission|prix total client)/;
const NET_CUES = /(vos gains|gains nets?|revenu net|net chauffeur|vous recevrez|vous gagnez|gain estime|montant net de frais|net de frais)/;
function detectPlatform(t) {
    const f = fold(t);
    const uber = /\buber\s?(x|green|comfort|berline|van|pet|black|pool|share|xl)?\b/.test(f) || /\buberx\b/.test(f);
    const bolt = /\bbolt\b/.test(f);
    if (uber && !bolt)
        return ocr('uber', 'uber', 'platform.keyword');
    if (bolt && !uber)
        return ocr('bolt', 'bolt', 'platform.keyword');
    return none();
}
function parseOffer(rawText) {
    const t = normalizeText(rawText ?? '');
    const f = fold(t);
    const warnings = [];
    const platform = detectPlatform(t);
    const { money, legs: legToks } = tokenize(t);
    // ---- Prix
    const extras = [];
    const candidates = [];
    for (const m of money) {
        if (m.rate)
            continue; // "1,20 €/km" n'est pas un prix d'offre
        const [ls, le] = lineBounds(t, m.start);
        const line = fold(t.slice(ls, le));
        if (m.plus || EXTRA_WORDS.test(line)) {
            extras.push({ label: line.slice(0, 40), amount: m.value, raw: m.raw });
            continue;
        }
        candidates.push(m);
    }
    let price = none();
    // Fourchette "12,50 - 15,00 €" sur UNE ligne, hors bonus et hors heure : borne basse retenue (prudente).
    const ranges = [];
    let badRange = false;
    for (const line of t.split('\n')) {
        const fl = fold(line);
        if (EXTRA_WORDS.test(fl) || /\d{1,2}[:h]\d{2}/.test(line))
            continue;
        const rm = line.match(/(?<![\d.,:])(\d{1,4}(?:[.,]\d{1,2})?)\s*€?\s*-\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*€/);
        if (!rm)
            continue;
        const lo = parseDecimal(rm[1]);
        const hi = parseDecimal(rm[2]);
        if (lo !== null && hi !== null && hi > lo)
            ranges.push({ lo, raw: rm[0] });
        else
            badRange = true;
    }
    const distinct = [...new Set(candidates.map((c) => c.value))];
    if (ranges.length === 1) {
        price = ocr(ranges[0].lo, ranges[0].raw, 'price.range-low', 'medium');
        warnings.push('Prix en fourchette : borne basse retenue');
    }
    else if (ranges.length > 1 || badRange) {
        warnings.push(badRange ? 'Fourchette de prix incohérente : prix ambigu' : 'Plusieurs fourchettes de prix : prix ambigu');
    }
    else if (distinct.length === 1) {
        price = ocr(distinct[0], candidates[0].raw, 'price.single', 'high');
    }
    else if (distinct.length > 1) {
        // Un montant seul sur sa ligne (présentation habituelle du prix) l'emporte s'il est unique.
        const alone = candidates.filter((c) => {
            const [ls, le] = lineBounds(t, c.start);
            return t.slice(ls, le).trim().length <= c.raw.length + 2;
        });
        const aloneDistinct = [...new Set(alone.map((c) => c.value))];
        if (aloneDistinct.length === 1) {
            price = ocr(aloneDistinct[0], alone[0].raw, 'price.standalone-line', 'medium');
            warnings.push('Plusieurs montants lus : montant isolé retenu');
        }
        else {
            warnings.push(`Prix ambigu (${distinct.join(' / ')} €)`);
        }
    }
    if (price.value !== null && (price.value <= 0 || price.value > 2000)) {
        warnings.push('Prix hors plage plausible');
        price = none();
    }
    // ---- Base du prix (indice textuel explicite uniquement)
    let priceBasis = none();
    const g = GROSS_CUES.test(f);
    const n = NET_CUES.test(f);
    if (g && !n)
        priceBasis = ocr('gross_before_commission', 'indice texte', 'basis.cue', 'medium');
    if (n && !g)
        priceBasis = ocr('net_driver', 'indice texte', 'basis.cue', 'medium');
    // ---- Approche et trajet
    // Écarter les heures d'horloge type "14 h" isolées : on ne garde que les durées <= 300 min.
    const legToksF = legToks.filter((x) => !(x.kind === 'dur' && x.value > 300));
    const legs = pairLegs(t, legToksF).filter((l) => !(l.min && l.min.hourNoMin && !l.km));
    const roles = [];
    let prevEnd = 0;
    for (const leg of legs) {
        const c = classify(t, leg, prevEnd);
        roles.push({ leg, ...c });
        prevEnd = leg.end;
    }
    // Complément : deux segments complets, un seul identifié => l'autre prend le rôle restant.
    const full = roles.filter((r) => r.leg.min && r.leg.km);
    if (full.length === 2) {
        const [r1, r2] = full;
        if (r1.role && !r2.role) {
            r2.role = r1.role === 'approach' ? 'trip' : 'approach';
            r2.reason = 'complement';
        }
        else if (r2.role && !r1.role) {
            r1.role = r2.role === 'approach' ? 'trip' : 'approach';
            r1.reason = 'complement';
        }
    }
    const pick = (role, kind) => {
        const found = roles.filter((r) => r.role === role && r.leg[kind]);
        const values = [...new Set(found.map((r) => r.leg[kind].value))];
        if (values.length === 0)
            return none();
        if (values.length > 1) {
            warnings.push(`${role === 'approach' ? 'Approche' : 'Trajet'} : plusieurs ${kind === 'km' ? 'distances' : 'durées'} candidates`);
            return none();
        }
        const tok = found[0].leg[kind];
        if (!tok.unitOk) {
            warnings.push(`Unité non supportée : ${tok.raw}`);
            return none();
        }
        const conf = found[0].reason === 'anchor-line' ? 'high' : 'medium';
        return ocr(tok.value, tok.raw, `${role}.${found[0].reason}`, conf);
    };
    const approachKm = pick('approach', 'km');
    const approachMin = pick('approach', 'min');
    const tripKm = pick('trip', 'km');
    const tripMin = pick('trip', 'min');
    const unresolved = roles.filter((r) => !r.role && (r.leg.min || r.leg.km));
    if (unresolved.length)
        warnings.push(`${unresolved.length} distance(s)/durée(s) sans rôle identifiable`);
    // Cohérences simples
    if (approachKm.value !== null && approachKm.value > 100)
        warnings.push('Approche > 100 km : à vérifier');
    if (tripMin.value !== null && tripKm.value !== null && tripMin.value > 0) {
        const kmh = (tripKm.value / tripMin.value) * 60;
        if (kmh > 150)
            warnings.push('Vitesse moyenne implausible (> 150 km/h)');
    }
    // ---- Échéance éventuelle
    let expiresInSec = none();
    // Sur une même ligne uniquement : "Accepter (12)" ou "12 s" / "12 sec" (jamais "min").
    let exp = null;
    for (const line of t.split('\n')) {
        exp = line.match(/(?:accepter|accept)[ \t]*\([ \t]*(\d{1,2})[ \t]*\)/i) || line.match(/(?<![\d.,])(\d{1,2})[ \t]*(?:s|sec|secondes?)\b(?![ \t]*\/)/i);
        if (exp)
            break;
    }
    if (exp) {
        const v = Number(exp[1]);
        if (v > 0 && v <= 60)
            expiresInSec = ocr(v, exp[0], 'expiry.countdown', 'low');
    }
    // ---- Produit
    const prod = f.match(/\b(uberx|uber x|uber green|green|comfort|berline|van|xl|uber pet|bolt comfort|bolt xl|economy|executive|premium)\b/);
    const productLabel = prod ? prod[1] : null;
    const haveLegs = [approachKm, approachMin, tripKm, tripMin].filter((x) => x.value !== null).length;
    let status;
    if (price.value === null && haveLegs === 0 && candidates.length === 0)
        status = 'not_offer';
    else if (price.value === null && (distinct.length > 1 || badRange || ranges.length > 1))
        status = 'ambiguous';
    else if (price.value !== null && haveLegs === 4)
        status = 'ok';
    else
        status = 'partial';
    if (status === 'not_offer')
        warnings.push('Aucune offre reconnue dans le texte');
    return {
        platform,
        layoutId: platform.value ? `${platform.value}.fr.v1` : null,
        parserVersion: types_1.PARSER_VERSION,
        price,
        currency: price.value !== null ? 'EUR' : null,
        priceBasis,
        approachKm,
        approachMin,
        tripKm,
        tripMin,
        expiresInSec,
        extras,
        productLabel,
        status,
        warnings,
    };
}

},
"src/core/analyze.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newId = newId;
exports.buildFinanceInput = buildFinanceInput;
exports.applySessionPlatform = applySessionPlatform;
exports.buildDisplay = buildDisplay;
exports.analyzeText = analyzeText;
exports.analyzeParsed = analyzeParsed;
exports.isFresh = isFresh;
exports.shouldDisplay = shouldDisplay;
// Chaîne complète du parcours rapide : texte OCR + configuration locale -> analyse + restitution courte.
// Aucune dépendance réseau. Utilisée par le script du raccourci, le composant natif, la PWA et le serveur.
const finance_1 = __require("src/core/finance.ts");
const parse_1 = __require("src/core/parse.ts");
const verdict_1 = __require("src/core/verdict.ts");
const types_1 = __require("src/core/types.ts");
function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function')
        return c.randomUUID();
    // Repli (Scriptable / JavaScriptCore) : UUID v4 pseudo-aléatoire, suffisant pour un identifiant de requête.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
/** Construit l'entrée financière depuis l'offre lue et la configuration (provenance conservée dans l'offre). */
function buildFinanceInput(offer, cfg) {
    const plat = offer.platform.value && offer.platform.value !== 'unknown' ? offer.platform.value : null;
    const rule = plat ? cfg.platforms[plat] : null;
    let basis = 'unknown';
    if (offer.priceBasis.value)
        basis = offer.priceBasis.value;
    else if (rule)
        basis = rule.priceBasis;
    return {
        price: offer.price.value,
        priceBasis: basis,
        // Le taux n'est utilisé que si l'utilisateur a confirmé que cette plateforme affiche un montant avant commission.
        commissionRate: rule && rule.priceBasis === 'gross_before_commission' ? rule.commissionRate : null,
        approachKm: offer.approachKm.value,
        approachMin: offer.approachMin.value,
        tripKm: offer.tripKm.value,
        tripMin: offer.tripMin.value,
        scenario: cfg.scenario,
        variablePerKm: cfg.cost.variablePerKm,
        fixedPerHour: cfg.cost.fixedPerHour,
        otherCosts: cfg.cost.otherPerOffer,
    };
}
/** Applique la plateforme de session si le texte ne l'identifie pas (provenance "config"). */
function applySessionPlatform(offer, cfg) {
    if (offer.platform.value || !cfg.sessionPlatform || cfg.sessionPlatform === 'unknown')
        return offer;
    return { ...offer, platform: { value: cfg.sessionPlatform, provenance: 'config', rule: 'session-platform' } };
}
function hhmmss(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    // Heure locale de l'appareil (Europe/Paris sur le téléphone de l'utilisateur).
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function buildDisplay(a) {
    const v = a.verdict;
    const lvl = v.level === 'margin' ? 'marge' : 'recette';
    const fin0 = a.finance;
    // Si le niveau choisi n'est pas calculable (coûts absents), on montre la recette AVANT FRAIS, libellée comme telle.
    const preCost = v.perHour === null && v.perKm === null && (fin0.revenuePerHour !== null || fin0.revenuePerKm !== null);
    const main = v.perHour !== null
        ? `${(0, finance_1.fmtNum)(v.perHour, 2)} €/h ${lvl}`
        : v.perKm !== null
            ? `${(0, finance_1.fmtNum)(v.perKm, 2)} €/km ${lvl}`
            : preCost
                ? fin0.revenuePerHour !== null
                    ? `${(0, finance_1.fmtNum)(fin0.revenuePerHour, 2)} €/h recette avant frais`
                    : `${(0, finance_1.fmtNum)(fin0.revenuePerKm, 2)} €/km recette avant frais`
                : '';
    const title = `${verdict_1.VERDICT_SYMBOL[v.verdict]} ${verdict_1.VERDICT_LABEL[v.verdict]}${main ? ' · ' + main : ''}`;
    const parts = [];
    if (v.perKm !== null && v.perHour !== null)
        parts.push(`${(0, finance_1.fmtNum)(v.perKm, 2)} €/km`);
    if (preCost && fin0.revenuePerHour !== null && fin0.revenuePerKm !== null)
        parts.push(`${(0, finance_1.fmtNum)(fin0.revenuePerKm, 2)} €/km avant frais`);
    const fin = a.finance;
    if (fin.P !== null)
        parts.push(`P ${(0, finance_1.fmtNum)(fin.P, 2)} €${fin.pIsUpperBound ? ' (base ?)' : ''}`);
    if (fin.D !== null)
        parts.push(`${(0, finance_1.fmtNum)(fin.D, 1)} km`);
    if (fin.T !== null)
        parts.push(`${(0, finance_1.fmtNum)(fin.T, 0)} min`);
    if (a.input.approachKm !== null || a.input.approachMin !== null)
        parts.push('approche incluse');
    if (v.verdict === 'partiel' || v.verdict === 'indisponible' || v.verdict === 'faible') {
        const r = v.reasons[0];
        if (r)
            parts.push(r);
    }
    const plat = a.offer.platform.value ? a.offer.platform.value.toUpperCase() : 'plateforme ?';
    parts.push(`${plat} ${hhmmss(a.capturedAt)}`);
    let speech;
    if (v.verdict === 'indisponible')
        speech = 'Analyse indisponible.';
    else if (v.perHour !== null)
        speech = `${verdict_1.VERDICT_LABEL[v.verdict]}. ${Math.round(v.perHour)} euros de l'heure.`;
    else if (preCost && fin0.revenuePerHour !== null)
        speech = `${verdict_1.VERDICT_LABEL[v.verdict]}. ${Math.round(fin0.revenuePerHour)} euros de l'heure avant frais.`;
    else if (v.perKm !== null)
        speech = `${verdict_1.VERDICT_LABEL[v.verdict]}. ${(0, finance_1.fmtNum)(v.perKm, 2).replace(',', ' euro ')} du kilomètre.`;
    else
        speech = `${verdict_1.VERDICT_LABEL[v.verdict]}.`;
    return { title, body: parts.join(' · '), speech };
}
function analyzeText(text, cfg, opts = {}) {
    const now = opts.now ?? (() => new Date());
    const capturedAt = opts.capturedAt ?? now().toISOString();
    const offer = applySessionPlatform((0, parse_1.parseOffer)(text), cfg);
    return analyzeParsed(offer, cfg, { ...opts, capturedAt, now });
}
function analyzeParsed(offer, cfg, opts = {}) {
    const now = opts.now ?? (() => new Date());
    const capturedAt = opts.capturedAt ?? now().toISOString();
    const input = buildFinanceInput(offer, cfg);
    const finance = (0, finance_1.computeFinance)(input);
    let verdict = (0, verdict_1.computeVerdict)(finance, cfg.thresholds);
    if (offer.status === 'not_offer') {
        verdict = { ...verdict, verdict: 'indisponible', reasons: ['Aucune offre reconnue', ...verdict.reasons] };
    }
    const expiry = offer.expiresInSec.value;
    const validSec = expiry !== null ? Math.min(expiry, cfg.freshnessSec) : cfg.freshnessSec;
    const validUntil = new Date(new Date(capturedAt).getTime() + validSec * 1000).toISOString();
    const base = {
        id: opts.id ?? newId(),
        engineVersion: types_1.ENGINE_VERSION,
        parserVersion: offer.parserVersion,
        configId: cfg.configId,
        costProfileRef: { id: cfg.cost.id, version: cfg.cost.version },
        thresholdRef: { id: cfg.thresholds.id, version: cfg.thresholds.version },
        thresholdValues: { level: cfg.thresholds.level, perKm: cfg.thresholds.perKm, perHour: cfg.thresholds.perHour },
        capturedAt,
        analyzedAt: now().toISOString(),
        validUntil,
        source: opts.source ?? 'shortcut',
        offer,
        input,
        finance,
        verdict,
    };
    return { ...base, display: buildDisplay(base) };
}
/** Règle de fraîcheur explicite : un résultat n'est une recommandation active que jusqu'à validUntil. */
function isFresh(a, now = new Date()) {
    return now.getTime() <= new Date(a.validUntil).getTime();
}
/**
 * Arbitrage entre analyses concurrentes : un résultat n'est restitué que s'il correspond
 * à la requête la plus récente connue (horodatage de déclenchement) et qu'il est encore frais.
 */
function shouldDisplay(a, latestRequest, now = new Date()) {
    if (latestRequest && latestRequest.id !== a.id && new Date(latestRequest.capturedAt) > new Date(a.capturedAt)) {
        return { show: false, reason: 'Résultat remplacé par une offre plus récente' };
    }
    if (!isFresh(a, now))
        return { show: false, reason: 'Résultat périmé' };
    return { show: true, reason: 'ok' };
}

},
"src/core/config.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fnv1a = fnv1a;
exports.canonical = canonical;
exports.buildFastConfig = buildFastConfig;
exports.validateFastConfig = validateFastConfig;
exports.demoConfig = demoConfig;
/** FNV-1a 32 bits, hexadécimal : empreinte déterministe, pas une fonction de sécurité. */
function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
/** JSON canonique (clés triées) pour une empreinte stable. */
function canonical(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(canonical).join(',') + ']';
    const o = v;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
function buildFastConfig(p, createdAt = new Date().toISOString()) {
    // Sélection explicite des champs : des propriétés en trop (ex. configId d'une ancienne version) sont ignorées.
    const body = {
        schema: 1,
        cost: p.cost,
        thresholds: p.thresholds,
        platforms: p.platforms,
        sessionPlatform: p.sessionPlatform,
        scenario: p.scenario,
        freshnessSec: p.freshnessSec,
        voice: p.voice,
        syncMode: p.syncMode,
        apiBase: p.apiBase,
    };
    const configId = 'cfg-' + fnv1a(canonical(body));
    return { ...body, configId, createdAt };
}
const isPosOrNull = (x) => x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);
function validateFastConfig(x) {
    const e = [];
    const c = x;
    if (!c || typeof c !== 'object')
        return { ok: false, errors: ['Configuration absente'] };
    if (c.schema !== 1)
        e.push('Version de schéma inconnue');
    if (typeof c.configId !== 'string')
        e.push('configId manquant');
    if (!c.cost || typeof c.cost.id !== 'string')
        e.push('Profil de coûts manquant');
    else {
        if (!isPosOrNull(c.cost.variablePerKm))
            e.push('v invalide');
        if (!isPosOrNull(c.cost.fixedPerHour))
            e.push('f invalide');
        if (!isPosOrNull(c.cost.otherPerOffer))
            e.push('E invalide');
    }
    if (!c.thresholds || !(c.thresholds.perKm > 0) || !(c.thresholds.perHour > 0))
        e.push('Seuils invalides (doivent être > 0)');
    if (c.thresholds && c.thresholds.level !== 'revenue' && c.thresholds.level !== 'margin')
        e.push('Niveau de seuil invalide');
    for (const k of ['uber', 'bolt']) {
        const r = c.platforms?.[k];
        if (!r)
            e.push(`Règle ${k} manquante`);
        else {
            if (!['net_driver', 'gross_before_commission', 'unknown'].includes(r.priceBasis))
                e.push(`Base ${k} invalide`);
            if (r.commissionRate !== null && !(r.commissionRate >= 0 && r.commissionRate < 1))
                e.push(`Commission ${k} invalide`);
        }
    }
    if (!(c.freshnessSec > 0 && c.freshnessSec <= 120))
        e.push('Fraîcheur invalide (1 à 120 s)');
    if (!c.scenario)
        e.push('Scénario manquant');
    if (e.length === 0) {
        // Vérifie l'intégrité de l'empreinte : une config modifiée à la main est signalée.
        const { configId, createdAt, ...body } = c;
        void createdAt;
        const expect = 'cfg-' + fnv1a(canonical(body));
        if (expect !== configId)
            e.push('Empreinte de configuration incohérente (fichier modifié ?)');
    }
    return e.length ? { ok: false, errors: e } : { ok: true, config: c };
}
/** Configuration de démonstration, clairement fictive. */
function demoConfig() {
    return buildFastConfig({
        cost: { id: 'demo-cost', version: 1, effectiveFrom: '2026-01-01T00:00:00Z', variablePerKm: 0.2, fixedPerHour: 5, otherPerOffer: 0 },
        thresholds: { id: 'demo-th', version: 1, effectiveFrom: '2026-01-01T00:00:00Z', level: 'margin', perKm: 1, perHour: 18 },
        platforms: {
            uber: { priceBasis: 'net_driver', commissionRate: null },
            bolt: { priceBasis: 'unknown', commissionRate: null },
        },
        sessionPlatform: null,
        scenario: { returnKm: null, returnMin: null, waitMin: null },
        freshnessSec: 10,
        voice: true,
        syncMode: 'off',
        apiBase: null,
    }, '2026-01-01T00:00:00.000Z');
}

},
"src/core/domain.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORES = exports.OFFER_STATUS_LABEL = void 0;
exports.deriveCosts = deriveCosts;
exports.defaultSettings = defaultSettings;
exports.OFFER_STATUS_LABEL = {
    analysee: 'Analysée',
    acceptee: 'Acceptée',
    refusee: 'Refusée',
    annulee: 'Annulée',
    realisee: 'Réalisée',
    encaissee: 'Encaissée',
};
exports.STORES = ['vehicles', 'costProfiles', 'thresholds', 'offers', 'trips', 'sessions', 'expenses', 'settings'];
/** Calcule v (€/km) et f (€/h) depuis la fiche véhicule. null si une donnée manque. */
function deriveCosts(v) {
    const energyPerKm = v.consumptionPer100 !== null && v.energyUnitPrice !== null ? (v.consumptionPer100 / 100) * v.energyUnitPrice : null;
    const variablePerKm = energyPerKm !== null && v.maintenancePerKm !== null ? energyPerKm + v.maintenancePerKm : null;
    const fixedPerHour = v.fixedMonthly !== null && v.plannedHoursMonthly !== null && v.plannedHoursMonthly > 0 ? v.fixedMonthly / v.plannedHoursMonthly : null;
    return { variablePerKm, fixedPerHour, energyPerKm };
}
function defaultSettings(now = new Date().toISOString()) {
    return {
        id: 'settings',
        updatedAt: now,
        activeVehicleId: null,
        activeCostProfileId: null,
        activeThresholdId: null,
        platforms: {
            uber: { priceBasis: 'unknown', commissionRate: null, confirmed: false },
            bolt: { priceBasis: 'unknown', commissionRate: null, confirmed: false },
        },
        sessionPlatform: null,
        scenario: { returnKm: null, returnMin: null, waitMin: null },
        freshnessSec: 10,
        voice: true,
        syncMode: 'off',
        apiBase: null,
        aiEnabled: false,
        onboardingDone: false,
    };
}

},
"src/core/history.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offerFromAnalysis = offerFromAnalysis;
exports.canTransition = canTransition;
exports.setStatus = setStatus;
exports.applyCorrection = applyCorrection;
exports.importJournal = importJournal;
exports.percentile = percentile;
exports.sanitizeAnalysis = sanitizeAnalysis;
// Règles de l'historique : statuts, corrections après coup, import du journal du raccourci.
const analyze_1 = __require("src/core/analyze.ts");
const finance_1 = __require("src/core/finance.ts");
const verdict_1 = __require("src/core/verdict.ts");
const nowIso = () => new Date().toISOString();
function offerFromAnalysis(a, sessionId = null, timing = null) {
    return {
        id: a.id,
        updatedAt: a.analyzedAt,
        capturedAt: a.capturedAt,
        platform: a.offer.platform.value ?? 'unknown',
        source: a.source,
        original: a,
        corrected: null,
        corrections: [],
        status: 'analysee',
        statusHistory: [{ status: 'analysee', at: a.analyzedAt }],
        sessionId,
        tripId: null,
        timing,
    };
}
const ALLOWED = {
    analysee: ['acceptee', 'refusee'],
    acceptee: ['annulee', 'realisee', 'refusee'],
    refusee: ['acceptee'],
    annulee: ['acceptee'],
    realisee: ['encaissee', 'annulee'],
    encaissee: ['realisee'],
};
function canTransition(from, to) {
    return ALLOWED[from].includes(to);
}
/**
 * Change le statut d'une offre. Ne crée JAMAIS de recette : passer à "réalisée" exige
 * un montant confirmé par l'utilisateur, qui crée/actualise une course (TripRec).
 */
function setStatus(offer, to, opts = {}) {
    if (offer.status === to)
        return { offer, trip: opts.trip ?? null };
    if (!canTransition(offer.status, to))
        throw new Error(`Transition ${offer.status} -> ${to} non autorisée`);
    const at = opts.at ?? nowIso();
    let trip = opts.trip ?? null;
    if (to === 'realisee' || to === 'encaissee') {
        if (!trip) {
            if (typeof opts.confirmedRevenue !== 'number' || !(opts.confirmedRevenue >= 0)) {
                throw new Error('Montant réellement perçu requis pour une course réalisée');
            }
            const a = offer.corrected ?? offer.original;
            trip = {
                id: offer.id + ':trip',
                updatedAt: at,
                offerId: offer.id,
                sessionId: offer.sessionId,
                date: offer.capturedAt,
                platform: offer.platform,
                revenue: opts.confirmedRevenue,
                km: a.finance.D,
                minutes: a.finance.T,
                status: 'realisee',
                paidAt: null,
                note: '',
            };
        }
        trip = { ...trip, status: to === 'encaissee' ? 'encaissee' : 'realisee', paidAt: to === 'encaissee' ? at : null, updatedAt: at };
    }
    if (to === 'annulee' && trip)
        trip = { ...trip, status: 'annulee', updatedAt: at };
    return {
        offer: {
            ...offer,
            status: to,
            statusHistory: [...offer.statusHistory, { status: to, at }],
            tripId: trip ? trip.id : offer.tripId,
            updatedAt: at,
        },
        trip,
    };
}
const FIELD_TO_INPUT = {
    price: 'price',
    priceBasis: 'priceBasis',
    commissionRate: 'commissionRate',
    approachKm: 'approachKm',
    approachMin: 'approachMin',
    tripKm: 'tripKm',
    tripMin: 'tripMin',
};
/**
 * Correction après coup : l'analyse d'origine est conservée ; une analyse corrigée est
 * recalculée avec LES MÊMES hypothèses (coûts, seuils, scénario) que l'origine.
 */
function applyCorrection(offer, field, value, at = nowIso()) {
    const base = offer.corrected ?? offer.original;
    const input = { ...base.input };
    const parsed = JSON.parse(JSON.stringify(base.offer));
    let before;
    if (field === 'platform') {
        before = parsed.platform.value;
        parsed.platform = { value: value, provenance: 'manual' };
    }
    else {
        const k = FIELD_TO_INPUT[field];
        before = input[k];
        input[k] = value;
        if (field !== 'commissionRate') {
            const pf = field;
            parsed[pf] = { value, provenance: 'manual' };
        }
    }
    const finance = (0, finance_1.computeFinance)(input);
    const tv = base.thresholdValues;
    const verdict = (0, verdict_1.computeVerdict)(finance, { id: '', version: 0, effectiveFrom: '', ...tv });
    const corrected0 = { ...base, offer: parsed, input, finance, verdict, analyzedAt: at };
    const corrected = { ...corrected0, display: (0, analyze_1.buildDisplay)(corrected0) };
    return {
        ...offer,
        platform: parsed.platform.value ?? offer.platform,
        corrected,
        corrections: [...offer.corrections, { at, field, before, after: value }],
        updatedAt: at,
    };
}
/** Import idempotent du journal : mêmes identifiants => pas de doublon. */
function importJournal(text, existing) {
    const errors = [];
    const byId = new Map();
    const timings = new Map();
    let skipped = 0;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    lines.forEach((l, i) => {
        let j;
        try {
            j = JSON.parse(l);
        }
        catch {
            errors.push(`Ligne ${i + 1} illisible`);
            return;
        }
        if (j.kind === 'analysis') {
            const a = sanitizeAnalysis(j.analysis);
            if (!a) {
                errors.push(`Ligne ${i + 1} : analyse invalide ignorée`);
                return;
            }
            if (existing.has(a.id) || byId.has(a.id)) {
                skipped++;
                return;
            }
            byId.set(a.id, offerFromAnalysis(a));
        }
        else if (j.kind === 'error') {
            skipped++; // trace d'erreur du raccourci : informative, rien à importer
        }
        else if (j.kind === 'timing' && typeof j.id === 'string') {
            const okNum = (x) => x === undefined || (typeof x === 'number' && Number.isFinite(x));
            if (!okNum(j.scriptStartMs) || !okNum(j.scriptEndMs) || !okNum(j.afterNotifyMs)) {
                errors.push(`Ligne ${i + 1} : mesure invalide`);
                return;
            }
            const t = timings.get(j.id) ?? {};
            if (typeof j.scriptStartMs === 'number')
                t.scriptStartMs = j.scriptStartMs;
            if (typeof j.scriptEndMs === 'number')
                t.scriptEndMs = j.scriptEndMs;
            if (typeof j.afterNotifyMs === 'number')
                t.afterNotifyMs = j.afterNotifyMs;
            timings.set(j.id, t);
        }
        else
            errors.push(`Ligne ${i + 1} : type inconnu`);
    });
    for (const [id, t] of timings) {
        const o = byId.get(id) ?? existing.get(id);
        if (!o)
            continue;
        const merged = { ...o, timing: { ...(o.timing ?? {}), ...t } };
        byId.set(id, merged);
    }
    return { upserts: [...byId.values()], errors, skipped };
}
/** Percentiles pour les mesures de latence (méthode du rang le plus proche). */
function percentile(values, p) {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length)
        return null;
    const rank = Math.ceil((p / 100) * v.length);
    return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}
// ---------- Validation des analyses venant de l'extérieur (journal importé, ingestion serveur) ----------
const nn = (x) => x === null || (typeof x === 'number' && Number.isFinite(x));
const str = (x, max = 300) => typeof x === 'string' && x.length <= max;
const isoOk = (x) => typeof x === 'string' && x.length <= 40 && Number.isFinite(Date.parse(x));
const PROVS = ['ocr', 'gemini', 'rule', 'manual', 'config', 'none'];
const VERDICTS = ['favorable', 'limite', 'faible', 'partiel', 'indisponible'];
const SOURCES = ['shortcut', 'native', 'manual', 'import', 'server', 'demo'];
function fieldOk(f, values) {
    if (!f || typeof f !== 'object')
        return false;
    const o = f;
    if (!PROVS.includes(o.provenance))
        return false;
    if (values ? !values.includes(o.value) : !nn(o.value))
        return false;
    if (o.raw !== undefined && !str(o.raw, 80))
        return false;
    if (o.rule !== undefined && !str(o.rule, 60))
        return false;
    if (o.confidence !== undefined && !['high', 'medium', 'low'].includes(o.confidence))
        return false;
    return true;
}
/**
 * Vérifie la forme d'une analyse reçue de l'extérieur. Renvoie null si un champ a un type inattendu :
 * une donnée importée ne peut ni injecter de contenu ni fausser silencieusement les calculs affichés.
 */
function sanitizeAnalysis(x) {
    const a = x;
    if (!a || typeof a !== 'object')
        return null;
    if (!str(a.id, 128) || !/^[A-Za-z0-9:_-]+$/.test(a.id))
        return null;
    if (!isoOk(a.capturedAt) || !isoOk(a.analyzedAt) || !isoOk(a.validUntil))
        return null;
    if (!SOURCES.includes(a.source))
        return null;
    if (!str(a.engineVersion, 40) || !str(a.parserVersion, 40))
        return null;
    if (a.configId !== null && !(str(a.configId, 40) && /^cfg-[0-9a-f]{8}$/.test(a.configId)))
        return null;
    const o = a.offer;
    if (!o || typeof o !== 'object')
        return null;
    if (!fieldOk(o.platform, ['uber', 'bolt', 'unknown', null]) || !fieldOk(o.priceBasis, ['net_driver', 'gross_before_commission', 'unknown', null]))
        return null;
    for (const k of ['price', 'approachKm', 'approachMin', 'tripKm', 'tripMin', 'expiresInSec'])
        if (!fieldOk(o[k]))
            return null;
    if (!Array.isArray(o.warnings) || !o.warnings.every((w) => str(w, 200)))
        return null;
    if (!Array.isArray(o.extras) || !o.extras.every((e) => e && str(e.label, 60) && str(e.raw, 60) && typeof e.amount === 'number'))
        return null;
    if (o.productLabel !== null && !str(o.productLabel, 40))
        return null;
    const i = a.input;
    if (!i || !['net_driver', 'gross_before_commission', 'unknown'].includes(i.priceBasis))
        return null;
    for (const k of ['price', 'commissionRate', 'approachKm', 'approachMin', 'tripKm', 'tripMin', 'variablePerKm', 'fixedPerHour', 'otherCosts'])
        if (!nn(i[k]))
            return null;
    if (!i.scenario || !nn(i.scenario.returnKm) || !nn(i.scenario.returnMin) || !nn(i.scenario.waitMin))
        return null;
    const f = a.finance;
    if (!f)
        return null;
    for (const k of ['P', 'D', 'T', 'revenuePerKm', 'revenuePerHour', 'variableCost', 'fixedAllocation', 'margin', 'marginPerKm', 'marginPerHour'])
        if (!nn(f[k]))
            return null;
    if (!Array.isArray(f.notes) || !f.notes.every((n) => str(n, 200)) || !Array.isArray(f.missing) || !f.missing.every((n) => str(n, 60)))
        return null;
    const v = a.verdict;
    if (!v || !VERDICTS.includes(v.verdict) || !['revenue', 'margin'].includes(v.level) || !nn(v.perKm) || !nn(v.perHour) || !nn(v.ratioKm) || !nn(v.ratioHour))
        return null;
    if (!Array.isArray(v.reasons) || !v.reasons.every((r) => str(r, 200)))
        return null;
    const t = a.thresholdValues;
    if (!t || !['revenue', 'margin'].includes(t.level) || !(t.perKm > 0) || !(t.perHour > 0))
        return null;
    const d = a.display;
    if (!d || !str(d.title, 200) || !str(d.body, 400) || !str(d.speech, 200))
        return null;
    return a;
}

},
"src/core/aggregate.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parisDate = parisDate;
exports.periodKey = periodKey;
exports.sessionMinutes = sessionMinutes;
exports.summarize = summarize;
/** Date civile Europe/Paris d'un instant, "YYYY-MM-DD". */
function parisDate(iso) {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t) => parts.find((p) => p.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
}
/** Clé de période pour une date civile. Semaine ISO (lundi). */
function periodKey(iso, kind) {
    const day = parisDate(iso);
    if (kind === 'day')
        return day;
    if (kind === 'month')
        return day.slice(0, 7);
    const [y, m, dd] = day.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    const dow = (dt.getUTCDay() + 6) % 7; // 0 = lundi
    dt.setUTCDate(dt.getUTCDate() - dow + 3); // jeudi de la semaine
    const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}
/** Durée d'activité d'une session en minutes (pauses exclues). Session ouverte : jusqu'à "now". */
function sessionMinutes(s, now = new Date()) {
    const start = new Date(s.startedAt).getTime();
    const end = s.endedAt ? new Date(s.endedAt).getTime() : now.getTime();
    let ms = Math.max(0, end - start);
    for (const p of s.pauses) {
        const ps = new Date(p.start).getTime();
        const pe = p.end ? new Date(p.end).getTime() : end;
        ms -= Math.max(0, Math.min(pe, end) - Math.max(ps, start));
    }
    return Math.max(0, ms / 60000);
}
const alive = (xs) => xs.filter((x) => !x.deleted);
function summarize(kind, data, opts = {}) {
    const now = opts.now ?? new Date();
    const map = new Map();
    const get = (key) => {
        let s = map.get(key);
        if (!s) {
            s = {
                key,
                revenueRealized: 0,
                revenueCashed: 0,
                tripsCount: 0,
                expenses: 0,
                expensesByCategory: {},
                activityMinutes: 0,
                openSessions: 0,
                result: 0,
                resultPerHour: null,
                revenuePerHour: null,
                kmOdometer: null,
                kmTrips: null,
                resultPerKm: null,
                offers: { analysed: 0, byVerdict: {}, accepted: 0, refused: 0 },
                completeness: [],
                social: null,
            };
            map.set(key, s);
        }
        return s;
    };
    const kmOdo = new Map();
    const kmTr = new Map();
    for (const t of alive(data.trips)) {
        if (t.status === 'annulee')
            continue; // une course annulée n'est jamais une recette
        const s = get(periodKey(t.date, kind));
        s.revenueRealized += t.revenue;
        if (t.status === 'encaissee')
            s.revenueCashed += t.revenue;
        s.tripsCount += 1;
        const k = kmTr.get(s.key) ?? { sum: 0, complete: true };
        if (t.km === null)
            k.complete = false;
        else
            k.sum += t.km;
        kmTr.set(s.key, k);
    }
    for (const e of alive(data.expenses)) {
        const s = get(periodKey(e.date, kind));
        s.expenses += e.amount;
        s.expensesByCategory[e.category] = (s.expensesByCategory[e.category] ?? 0) + e.amount;
    }
    for (const se of alive(data.sessions)) {
        // Session attribuée à la période de son début (journée de travail, y compris après minuit).
        const s = get(periodKey(se.startedAt, kind));
        s.activityMinutes += sessionMinutes(se, now);
        if (!se.endedAt)
            s.openSessions += 1;
        const k = kmOdo.get(s.key) ?? { sum: 0, complete: true };
        if (se.odoStart === null || se.odoEnd === null || se.odoEnd < se.odoStart)
            k.complete = false;
        else
            k.sum += se.odoEnd - se.odoStart;
        kmOdo.set(s.key, k);
    }
    for (const o of alive(data.offers)) {
        const s = get(periodKey(o.capturedAt, kind));
        s.offers.analysed += 1;
        const v = (o.corrected ?? o.original).verdict.verdict;
        s.offers.byVerdict[v] = (s.offers.byVerdict[v] ?? 0) + 1;
        if (['acceptee', 'realisee', 'encaissee'].includes(o.status))
            s.offers.accepted += 1;
        if (o.status === 'refusee')
            s.offers.refused += 1;
    }
    for (const s of map.values()) {
        s.result = s.revenueRealized - s.expenses;
        const h = s.activityMinutes / 60;
        s.resultPerHour = h > 0 ? s.result / h : null;
        s.revenuePerHour = h > 0 ? s.revenueRealized / h : null;
        const ko = kmOdo.get(s.key);
        s.kmOdometer = ko && ko.complete && ko.sum > 0 ? ko.sum : null;
        const kt = kmTr.get(s.key);
        s.kmTrips = kt && kt.complete ? kt.sum : null;
        s.resultPerKm = s.kmOdometer ? s.result / s.kmOdometer : null;
        if (s.activityMinutes === 0)
            s.completeness.push('Aucune session : taux horaire indisponible');
        if (s.openSessions)
            s.completeness.push(`${s.openSessions} session(s) non clôturée(s)`);
        if (!s.kmOdometer)
            s.completeness.push('Compteur kilométrique incomplet : €/km réel indisponible');
        const pending = alive(data.offers).filter((o) => periodKey(o.capturedAt, kind) === s.key && o.status === 'acceptee' && !o.tripId).length;
        if (pending)
            s.completeness.push(`${pending} offre(s) acceptée(s) sans course confirmée (non comptées)`);
        const soc = opts.social?.[s.key];
        if (soc && soc.base >= 0 && soc.rate >= 0 && soc.rate < 1) {
            const contribution = soc.base * soc.rate;
            s.social = { base: soc.base, rate: soc.rate, contribution, balance: s.result - contribution };
        }
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

},
"src/core/backup.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACKUP_VERSION = exports.BACKUP_FORMAT = void 0;
exports.emptyDataset = emptyDataset;
exports.summarizeDataset = summarizeDataset;
exports.makeBackup = makeBackup;
exports.parseBackup = parseBackup;
exports.verifyRestore = verifyRestore;
exports.toCsv = toCsv;
exports.offersCsv = offersCsv;
exports.tripsCsv = tripsCsv;
exports.expensesCsv = expensesCsv;
// Sauvegarde JSON versionnée, vérification après import, export CSV.
const domain_1 = __require("src/core/domain.ts");
exports.BACKUP_FORMAT = 'vtcperso-backup';
exports.BACKUP_VERSION = 1;
function emptyDataset() {
    return Object.fromEntries(domain_1.STORES.map((s) => [s, []]));
}
const cents = (x) => Math.round(x * 100);
function summarizeDataset(d) {
    const counts = Object.fromEntries(domain_1.STORES.map((s) => [s, d[s].length]));
    const live = (xs) => xs.filter((x) => !x.deleted);
    return {
        counts,
        totals: {
            tripRevenue: live(d.trips).reduce((s, t) => s + cents(t.revenue), 0) / 100,
            expenses: live(d.expenses).reduce((s, e) => s + cents(e.amount), 0) / 100,
            offerPrices: live(d.offers).reduce((s, o) => s + cents(o.original.offer.price.value ?? 0), 0) / 100,
        },
        relations: {
            tripsWithOffer: d.trips.filter((t) => t.offerId).length,
            offersWithTrip: d.offers.filter((o) => o.tripId).length,
            offersWithSession: d.offers.filter((o) => o.sessionId).length,
        },
    };
}
function makeBackup(d, now = new Date().toISOString()) {
    return { format: exports.BACKUP_FORMAT, version: exports.BACKUP_VERSION, exportedAt: now, app: 'VTC Perso', data: d, summary: summarizeDataset(d) };
}
function parseBackup(text) {
    let b;
    try {
        b = JSON.parse(text);
    }
    catch {
        return { ok: false, error: 'Fichier JSON illisible' };
    }
    if (b?.format !== exports.BACKUP_FORMAT)
        return { ok: false, error: 'Ce fichier n’est pas une sauvegarde VTC Perso' };
    if (typeof b.version !== 'number' || b.version > exports.BACKUP_VERSION)
        return { ok: false, error: `Version ${b.version} non prise en charge` };
    for (const s of domain_1.STORES)
        if (!Array.isArray(b.data?.[s]))
            return { ok: false, error: `Section ${s} manquante` };
    for (const s of domain_1.STORES)
        for (const r of b.data[s])
            if (typeof r.id !== 'string')
                return { ok: false, error: `Identifiant manquant dans ${s}` };
    // Contrôle d'intégrité : le résumé embarqué doit correspondre aux données.
    const check = summarizeDataset(b.data);
    if (JSON.stringify(check) !== JSON.stringify(b.summary))
        return { ok: false, error: 'Résumé incohérent : fichier modifié ou incomplet' };
    return { ok: true, backup: b };
}
/**
 * Vérifie qu'une restauration reproduit les comptes, relations et totaux.
 * exact = true quand la base cible était vide avant l'import (égalité stricte attendue).
 */
function verifyRestore(expected, actual, exact = true) {
    const a = summarizeDataset(actual);
    const errs = [];
    for (const s of domain_1.STORES) {
        if (exact ? a.counts[s] !== expected.counts[s] : a.counts[s] < expected.counts[s])
            errs.push(`${s} : ${a.counts[s]} lignes au lieu de ${expected.counts[s]}`);
    }
    if (exact) {
        if (a.totals.tripRevenue !== expected.totals.tripRevenue)
            errs.push('Total des recettes différent');
        if (a.totals.expenses !== expected.totals.expenses)
            errs.push('Total des dépenses différent');
        if (a.totals.offerPrices !== expected.totals.offerPrices)
            errs.push('Total des prix d\u2019offres différent');
        for (const k of ['tripsWithOffer', 'offersWithTrip', 'offersWithSession'])
            if (a.relations[k] !== expected.relations[k])
                errs.push(`Relations ${k} différentes`);
    }
    return errs;
}
/** Neutralise les formules dans un tableur (=, +, -, @ en tête d'un texte). */
function csvSafe(s) {
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function csvCell(v) {
    if (v === null || v === undefined)
        return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : csvSafe(String(v));
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** CSV séparé par ";" (Excel FR), décimales à virgule. */
function toCsv(rows, columns) {
    const head = columns.join(';');
    const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(';'));
    return '﻿' + [head, ...body].join('\n');
}
function offersCsv(d) {
    const rows = d.offers
        .filter((o) => !o.deleted)
        .map((o) => {
        const a = o.corrected ?? o.original;
        return {
            id: o.id,
            capture: o.capturedAt,
            plateforme: o.platform,
            statut: o.status,
            prix_lu: a.offer.price.value,
            base: a.input.priceBasis,
            recette_P: a.finance.P,
            km_total: a.finance.D,
            min_total: a.finance.T,
            recette_km: a.finance.revenuePerKm,
            recette_h: a.finance.revenuePerHour,
            marge: a.finance.margin,
            marge_km: a.finance.marginPerKm,
            marge_h: a.finance.marginPerHour,
            verdict: a.verdict.verdict,
            niveau: a.verdict.level,
            config: a.configId,
            corrigee: o.corrected ? 'oui' : 'non',
        };
    });
    return toCsv(rows, Object.keys(rows[0] ?? { id: 1 }));
}
function tripsCsv(d) {
    const rows = d.trips.filter((t) => !t.deleted).map((t) => ({ id: t.id, date: t.date, plateforme: t.platform, statut: t.status, recette: t.revenue, km: t.km, minutes: t.minutes, offre: t.offerId }));
    return toCsv(rows, ['id', 'date', 'plateforme', 'statut', 'recette', 'km', 'minutes', 'offre']);
}
function expensesCsv(d) {
    const rows = d.expenses.filter((e) => !e.deleted).map((e) => ({ id: e.id, date: e.date, categorie: e.category, montant: e.amount, note: e.note, source: e.source }));
    return toCsv(rows, ['id', 'date', 'categorie', 'montant', 'note', 'source']);
}

},
"src/core/sync.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newer = newer;
exports.syncOnce = syncOnce;
/** Vrai si a doit remplacer b. */
function newer(a, b) {
    if (!b)
        return true;
    if (a.updatedAt !== b.updatedAt)
        return a.updatedAt > b.updatedAt;
    // Départage déterministe à horodatage égal : la pierre tombale gagne, puis l'ordre JSON.
    if (!!a.deleted !== !!b.deleted)
        return !!a.deleted;
    return JSON.stringify(a) > JSON.stringify(b);
}
async function syncOnce(local, remote, batch = 200) {
    const rep = { pushed: 0, pulled: 0, appliedRemote: 0, keptLocal: 0, error: null };
    try {
        // 1) Envoi
        const items = await local.outbox();
        for (let i = 0; i < items.length; i += batch) {
            const chunk = items.slice(i, i + batch);
            const rows = [];
            for (const it of chunk) {
                const rec = await local.get(it.store, it.id);
                if (rec)
                    rows.push({ store: it.store, record: rec });
            }
            const acks = await remote.push(rows); // une exception laisse l'outbox intacte
            const ackSet = new Set(acks.map((a) => `${a.store}/${a.id}/${a.updatedAt}`));
            for (const it of chunk) {
                const rec = await local.get(it.store, it.id);
                // Retiré seulement si la version accusée est toujours la version locale actuelle.
                if (rec && ackSet.has(`${it.store}/${it.id}/${rec.updatedAt}`)) {
                    await local.removeOutbox(it);
                    rep.pushed++;
                }
                else if (!rec)
                    await local.removeOutbox(it);
            }
        }
        // 2) Tirage
        let cursor = await local.getCursor();
        for (;;) {
            const rows = await remote.pull(cursor, batch);
            if (!rows.length)
                break;
            let maxSeq = cursor;
            for (const r of rows) {
                rep.pulled++;
                const cur = await local.get(r.store, r.record.id);
                // À horodatage égal (et même état de suppression), la copie du serveur fait foi : les deux côtés convergent.
                const tie = !!cur && cur.updatedAt === r.record.updatedAt && !!cur.deleted === !!r.record.deleted;
                if (tie || newer(r.record, cur)) {
                    await local.put(r.store, r.record);
                    rep.appliedRemote++;
                }
                else
                    rep.keptLocal++;
                maxSeq = Math.max(maxSeq, r.serverSeq);
            }
            await local.setCursor(maxSeq); // après application complète du lot
            cursor = maxSeq;
            if (rows.length < batch)
                break;
        }
    }
    catch (e) {
        rep.error = e instanceof Error ? e.message : String(e);
    }
    return rep;
}

},
"shortcut/runtime.ts": function(module, exports, __require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRuntime = createRuntime;
const SYNC_BATCH = 100;
const SYNC_MAX_BATCHES = 5;
const TOKEN_KEY = 'vtcperso.deviceToken';
function createRuntime() {
    const fm = FileManager.local();
    const dir = fm.joinPath(fm.documentsDirectory(), 'vtcperso');
    if (!fm.fileExists(dir))
        fm.createDirectory(dir, true);
    const path = (n) => fm.joinPath(dir, n);
    const read = (n) => (fm.fileExists(path(n)) ? fm.readString(path(n)) : null);
    const dayFile = () => 'journal-' + new Date().toISOString().slice(0, 10) + '.jsonl';
    /** File d'attente dérivée du journal (aucune écriture supplémentaire pendant le parcours rapide). */
    const unsynced = () => {
        const done = new Set(rt.readJson('synced.json') ?? []);
        const out = [];
        for (const f of fm.listContents(dir).filter((x) => x.startsWith('journal-')).sort()) {
            for (const line of (read(f) ?? '').split('\n')) {
                if (!line.includes('"kind":"analysis"'))
                    continue;
                try {
                    const a = JSON.parse(line).analysis;
                    if (a && !done.has(a.id))
                        out.push(a);
                }
                catch {
                    /* ligne corrompue ignorée */
                }
            }
        }
        return out;
    };
    const rt = {
        now: () => Date.now(),
        uuid: () => UUID.string().toLowerCase(),
        readJson(n) {
            const s = read(n);
            if (!s)
                return null;
            try {
                return JSON.parse(s);
            }
            catch {
                return null;
            }
        },
        writeJson(n, v) {
            fm.writeString(path(n), JSON.stringify(v));
        },
        appendJournal(line) {
            const f = dayFile();
            const prev = read(f) ?? '';
            fm.writeString(path(f), prev + JSON.stringify(line) + '\n');
        },
        pendingCount() {
            return unsynced().length;
        },
        copyJournal() {
            const files = fm.listContents(dir).filter((f) => f.startsWith('journal-')).sort();
            const all = files.map((f) => read(f) ?? '').join('');
            Pasteboard.copy(all);
            return all.split('\n').filter((l) => l.trim()).length;
        },
        async sync(cfg) {
            if (!cfg.apiBase)
                return 'Pas d\u2019adresse serveur configurée : utilisez l\u2019export du journal.';
            if (!Keychain.contains(TOKEN_KEY))
                return 'Pas de jeton d\u2019appareil enregistré.';
            const pending = unsynced();
            if (!pending.length)
                return 'Rien à synchroniser.';
            const done = new Set(rt.readJson('synced.json') ?? []);
            let sent = 0;
            for (let b = 0; b < SYNC_MAX_BATCHES && b * SYNC_BATCH < pending.length; b++) {
                const batch = pending.slice(b * SYNC_BATCH, (b + 1) * SYNC_BATCH);
                const r = new Request(cfg.apiBase.replace(/\/$/, '') + '/ingest');
                r.method = 'POST';
                r.timeoutInterval = 8;
                r.headers = { 'content-type': 'application/json', 'x-device-token': Keychain.get(TOKEN_KEY) };
                r.body = JSON.stringify({ analyses: batch });
                try {
                    const res = (await r.loadJSON());
                    if (r.response.statusCode !== 200 || !Array.isArray(res.accepted))
                        return `Échec : ${res.error ?? r.response.statusCode}. ${sent} envoyée(s), le reste est conservé.`;
                    // Acceptées et refusées (forme invalide) sont marquées traitées : pas de renvoi sans fin.
                    for (const id of [...res.accepted, ...(res.rejected ?? [])])
                        done.add(id);
                    rt.writeJson('synced.json', [...done]);
                    sent += res.accepted.length;
                }
                catch (e) {
                    return `Réseau indisponible : ${sent} envoyée(s), le reste est conservé (${String(e).slice(0, 60)})`;
                }
            }
            return `${sent} analyse(s) synchronisée(s), ${unsynced().length} en attente.`;
        },
        pasteboard: () => Pasteboard.paste(),
        setToken: (t) => Keychain.set(TOKEN_KEY, t),
        hasToken: () => Keychain.contains(TOKEN_KEY),
        async trafficRoute(pickup, destination) {
            if (!Keychain.contains(TOKEN_KEY))
                return null;
            const req = new Request('https://vihzevndxgwetrwtaexp.supabase.co/functions/v1/device-traffic');
            req.method = 'POST';
            req.timeoutInterval = 7;
            req.headers = { 'content-type': 'application/json', 'x-device-token': Keychain.get(TOKEN_KEY) };
            req.body = JSON.stringify({ pickup, destination });
            try {
                const data = await req.loadJSON();
                if (req.response.statusCode !== 200 || !Number.isFinite(data.trip_minutes) || !Number.isFinite(data.trip_km))
                    return null;
                return { trip_minutes: data.trip_minutes, trip_km: data.trip_km, traffic_delay_minutes: data.traffic_delay_minutes ?? null };
            }
            catch {
                return null;
            }
        },
        notify(title, body) {
            const n = new Notification();
            n.title = title;
            n.body = body;
            n.schedule();
        },
        speak: (t) => Speech.speak(t),
        async alert(title, message) {
            const a = new Alert();
            a.title = title;
            a.message = message;
            a.addAction('OK');
            await a.presentAlert();
        },
        async menu(title, options) {
            const a = new Alert();
            a.title = title;
            options.forEach((o) => a.addAction(o));
            a.addCancelAction('Fermer');
            return a.presentSheet();
        },
        complete(output) {
            if (output !== null && output !== undefined)
                Script.setShortcutOutput(output);
            Script.complete();
        },
    };
    return rt;
}

},
};
var __cache={}; function __require(id){if(__cache[id])return __cache[id].exports;let m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__require);return m.exports;}
await __require("shortcut/scriptable-entry.ts").main();
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: car;
// VTC Perso — script du parcours rapide (version 0.1.0, build f8bb8dad1783).
// Généré automatiquement. Source : shortcut/scriptable-entry.ts. Licence : usage personnel.
"use strict";
var VTCPersoBundle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // shortcut/scriptable-entry.ts
  var scriptable_entry_exports = {};
  __export(scriptable_entry_exports, {
    main: () => main,
    runAnalyze: () => runAnalyze,
    runPost: () => runPost
  });

  // src/core/types.ts
  var ENGINE_VERSION = "engine-1.0.0";
  var PARSER_VERSION = "parser-1.0.0";

  // src/core/finance.ts
  var isNum = (x) => typeof x === "number" && Number.isFinite(x);
  function sumKnown(parts, required) {
    for (const r of required) if (!isNum(r)) return null;
    let s = 0;
    for (const p of parts) if (isNum(p)) s += p;
    return s;
  }
  function driverRevenue(price, basis, commissionRate) {
    if (!isNum(price) || price < 0) return { P: null, upperBound: false, note: "Prix inconnu" };
    if (basis === "net_driver") return { P: price, upperBound: false, note: null };
    if (basis === "gross_before_commission") {
      if (!isNum(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
        return { P: price, upperBound: true, note: "Montant avant commission, taux non confirm\xE9 : montant affich\xE9 utilis\xE9 comme borne haute" };
      }
      return { P: price * (1 - commissionRate), upperBound: false, note: `Commission ${(commissionRate * 100).toFixed(1)} % d\xE9duite` };
    }
    return { P: price, upperBound: true, note: "Base du prix inconnue : montant affich\xE9 utilis\xE9 comme borne haute" };
  }
  function computeFinance(input) {
    const notes = [];
    const missing = [];
    const rev = driverRevenue(input.price, input.priceBasis, input.commissionRate);
    if (rev.note) notes.push(rev.note);
    if (rev.P === null) missing.push("P");
    const sc = input.scenario;
    const returnKm = isNum(sc.returnKm) && sc.returnKm > 0 ? sc.returnKm : null;
    const returnMin = isNum(sc.returnMin) && sc.returnMin > 0 ? sc.returnMin : null;
    const waitMin = isNum(sc.waitMin) && sc.waitMin > 0 ? sc.waitMin : null;
    if (returnKm === null !== (returnMin === null)) notes.push("Retour simul\xE9 incomplet : ignor\xE9");
    const useReturn = returnKm !== null && returnMin !== null;
    if (useReturn) notes.push(`Retour simul\xE9 inclus : ${returnKm} km / ${returnMin} min`);
    if (waitMin !== null) notes.push(`Attente incluse : ${waitMin} min`);
    const D = sumKnown([input.approachKm, input.tripKm, useReturn ? returnKm : null], [input.approachKm, input.tripKm]);
    const T = sumKnown(
      [input.approachMin, input.tripMin, useReturn ? returnMin : null, waitMin],
      [input.approachMin, input.tripMin]
    );
    if (!isNum(input.approachKm)) missing.push("distance d\u2019approche");
    if (!isNum(input.tripKm)) missing.push("distance du trajet");
    if (!isNum(input.approachMin)) missing.push("dur\xE9e d\u2019approche");
    if (!isNum(input.tripMin)) missing.push("dur\xE9e du trajet");
    const P = rev.P;
    const revenuePerKm = P !== null && D !== null && D > 0 ? P / D : null;
    const revenuePerHour = P !== null && T !== null && T > 0 ? 60 * P / T : null;
    if (D === 0) notes.push("Distance totale nulle : \u20AC/km indisponible");
    if (T === 0) notes.push("Dur\xE9e totale nulle : \u20AC/h indisponible");
    const v = isNum(input.variablePerKm) && input.variablePerKm >= 0 ? input.variablePerKm : null;
    const f = isNum(input.fixedPerHour) && input.fixedPerHour >= 0 ? input.fixedPerHour : null;
    const E = isNum(input.otherCosts) && input.otherCosts >= 0 ? input.otherCosts : null;
    if (v === null) missing.push("co\xFBt variable v");
    if (f === null) missing.push("allocation fixe f");
    const variableCost = v !== null && D !== null ? v * D : null;
    const fixedAllocation = f !== null && T !== null ? f * T / 60 : null;
    let margin = null;
    let marginExcludesOther = false;
    if (P !== null && variableCost !== null && fixedAllocation !== null) {
      margin = P - variableCost - fixedAllocation - (E != null ? E : 0);
      if (E === null) {
        marginExcludesOther = true;
        notes.push("Autres frais E non renseign\xE9s : marge hors E (borne haute)");
      }
    }
    const marginPerKm = margin !== null && D !== null && D > 0 ? margin / D : null;
    const marginPerHour = margin !== null && T !== null && T > 0 ? 60 * margin / T : null;
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
      missing
    };
  }
  function fmtNum(x, digits = 2) {
    if (!isNum(x)) return "\u2014";
    return x.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  // src/core/verdict.ts
  var LIMIT_FACTOR = 0.8;
  function computeVerdict(fin, th) {
    const reasons = [];
    const level = th.level;
    const validTh = th.perKm > 0 && th.perHour > 0 && Number.isFinite(th.perKm) && Number.isFinite(th.perHour);
    if (!validTh) {
      return { verdict: "indisponible", level, perKm: null, perHour: null, ratioKm: null, ratioHour: null, reasons: ["Seuils invalides"] };
    }
    if (fin.P === null) {
      return {
        verdict: "indisponible",
        level,
        perKm: null,
        perHour: null,
        ratioKm: null,
        ratioHour: null,
        reasons: ["Recette chauffeur inconnue", ...fin.missing.filter((m) => m !== "P").map((m) => `${m} manquant`)]
      };
    }
    const perKm = level === "revenue" ? fin.revenuePerKm : fin.marginPerKm;
    const perHour = level === "revenue" ? fin.revenuePerHour : fin.marginPerHour;
    const ratioKm = perKm === null ? null : perKm / th.perKm;
    const ratioHour = perHour === null ? null : perHour / th.perHour;
    const upper = fin.pIsUpperBound || level === "margin" && fin.marginExcludesOther;
    if (fin.pIsUpperBound) reasons.push("Base du prix non confirm\xE9e");
    if (level === "margin" && fin.marginExcludesOther) reasons.push("Autres frais non renseign\xE9s");
    if (level === "margin" && fin.margin === null) {
      const costsMissing = fin.missing.includes("co\xFBt variable v") || fin.missing.includes("allocation fixe f");
      reasons.push(costsMissing ? "Co\xFBts non renseign\xE9s : marge indisponible" : "Marge indisponible : distance ou dur\xE9e manquante");
    }
    if (perKm === null) reasons.push("\u20AC/km indisponible");
    if (perHour === null) reasons.push(fin.T === null ? "\u20AC/h indisponible (dur\xE9e manquante)" : "\u20AC/h indisponible");
    const available = [ratioKm, ratioHour].filter((r) => r !== null);
    const anyBelowLimit = available.some((r) => r < LIMIT_FACTOR);
    if (anyBelowLimit) {
      if (ratioKm !== null && ratioKm < LIMIT_FACTOR) reasons.unshift(`\u20AC/km sous 80 % du seuil`);
      if (ratioHour !== null && ratioHour < LIMIT_FACTOR) reasons.unshift(`\u20AC/h sous 80 % du seuil`);
      return { verdict: "faible", level, perKm, perHour, ratioKm, ratioHour, reasons };
    }
    if (available.length < 2 || upper) {
      if (available.length === 0) {
        const pre = fin.revenuePerKm !== null || fin.revenuePerHour !== null;
        return { verdict: pre ? "partiel" : "indisponible", level, perKm, perHour, ratioKm, ratioHour, reasons };
      }
      return { verdict: "partiel", level, perKm, perHour, ratioKm, ratioHour, reasons };
    }
    const [rk, rh] = [ratioKm, ratioHour];
    if (rk >= 1 && rh >= 1) return { verdict: "favorable", level, perKm, perHour, ratioKm, ratioHour, reasons: ["Deux seuils atteints", ...reasons] };
    if (rk < 1) reasons.unshift("\u20AC/km sous le seuil");
    if (rh < 1) reasons.unshift("\u20AC/h sous le seuil");
    return { verdict: "limite", level, perKm, perHour, ratioKm, ratioHour, reasons };
  }
  var VERDICT_LABEL = {
    favorable: "Favorable",
    limite: "Limite",
    faible: "Faible",
    partiel: "Partiel",
    indisponible: "Analyse indisponible"
  };
  var VERDICT_SYMBOL = {
    favorable: "\u2705",
    limite: "\u{1F7E0}",
    faible: "\u26D4",
    partiel: "\u2754",
    indisponible: "\u26A0\uFE0F"
  };

  // src/core/parse.ts
  var none = () => ({ value: null, provenance: "none" });
  var ocr = (value, raw, rule, confidence = "high") => ({
    value,
    provenance: "ocr",
    raw: raw.slice(0, 60),
    rule,
    confidence
  });
  function fold(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function normalizeText(input) {
    let t = input.replace(/\r\n?/g, "\n");
    t = t.replace(/[    ]/g, " ");
    t = t.replace(/[‒–—−]/g, "-");
    t = t.replace(/\bEUR\b|\beur\b|\bEuros?\b|\beuros?\b/g, "\u20AC");
    t = t.replace(/(\d)[Oo](?=[\d.,\s€)]|$)/gm, "$10");
    t = t.replace(/(\d[.,])[Oo]/g, "$10");
    t = t.replace(/(\d)[lI](?=\d)/g, "$11");
    t = t.replace(/[ \t]+/g, " ");
    return t.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
  }
  function parseDecimal(s) {
    const c = s.replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(c)) return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  }
  var MONEY_RE = /(\+\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*€(\s*\/\s*(?:km|h|heure|min))?|€\s*(\d{1,4}(?:[.,]\d{1,2})?)(\s*\/\s*(?:km|h|heure|min))?/g;
  var DUR_RE = /(\d{1,2})\s*h\s*(\d{1,2})?\s*(?:min|mn)?\b|(\d{1,3})\s*(?:mins?|mn|minutes?)\b/g;
  var DIST_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(km|mi|m)\b/g;
  function tokenize(t) {
    var _a, _b;
    const money = [];
    for (const m of t.matchAll(MONEY_RE)) {
      const num = (_a = m[2]) != null ? _a : m[4];
      const v = parseDecimal(num);
      if (v === null) continue;
      money.push({
        kind: "money",
        value: v,
        start: m.index,
        end: m.index + m[0].length,
        raw: m[0],
        unitOk: true,
        plus: !!m[1],
        rate: !!((_b = m[3]) != null ? _b : m[5])
      });
    }
    const legs = [];
    for (const m of t.matchAll(DUR_RE)) {
      let v;
      const hourFmt = m[1] !== void 0;
      if (hourFmt) v = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
      else v = Number(m[3]);
      if (!Number.isFinite(v)) continue;
      const hasMin = /m(i)?n/i.test(m[0]);
      if (hourFmt && !hasMin) {
        const ls = t.lastIndexOf("\n", m.index - 1) + 1;
        const before = fold(t.slice(Math.max(ls, m.index - 16), m.index));
        if (/(vers|arriv|depos|prevu|avant|apres|heure|a)\s*$/.test(before)) continue;
      }
      legs.push({ kind: "dur", value: v, start: m.index, end: m.index + m[0].length, raw: m[0], unitOk: true, hourNoMin: hourFmt && !hasMin });
    }
    for (const m of t.matchAll(DIST_RE)) {
      const v = parseDecimal(m[1]);
      if (v === null) continue;
      const unit = m[2];
      const km = unit === "km" ? v : unit === "m" ? v / 1e3 : v;
      legs.push({ kind: "dist", value: km, start: m.index, end: m.index + m[0].length, raw: m[0], unitOk: unit !== "mi" });
    }
    legs.sort((a, b) => a.start - b.start);
    return { money, legs };
  }
  var APPROACH_ANCHORS = [
    /(^|\s)a\s*$/,
    // "À 6 min" : le mot "à" juste avant
    /prise en charge/,
    /approche/,
    /pick-?up/,
    /jusqu'?au (client|passager)/,
    /vers (le )?(client|passager)/,
    /recuperation/,
    /pour rejoindre/
  ];
  var APPROACH_AFTER = [/^\s*\)?\s*(de distance|away|d'approche|pour (le|la) prise)/];
  var TRIP_ANCHORS = [/trajet/, /course/, /destination/, /\btrip\b/, /depose/, /voyage/, /duree totale/];
  var TRIP_AFTER = [/^\s*\)?\s*(trip|de trajet|de course|jusqu'a destination)/];
  function pairLegs(t, toks) {
    const legs = [];
    const used = /* @__PURE__ */ new Set();
    for (let i = 0; i < toks.length; i++) {
      const a = toks[i];
      if (used.has(a)) continue;
      const b = toks[i + 1];
      if (b && !used.has(b) && b.kind !== a.kind) {
        const between = t.slice(a.end, b.start);
        if (/^[^A-Za-z0-9]*$/.test(between) && between.split("\n").length <= 2 && between.length <= 6) {
          used.add(a);
          used.add(b);
          const min = a.kind === "dur" ? a : b;
          const km = a.kind === "dist" ? a : b;
          legs.push({ min, km, start: a.start, end: b.end });
          continue;
        }
      }
      used.add(a);
      legs.push({ min: a.kind === "dur" ? a : null, km: a.kind === "dist" ? a : null, start: a.start, end: a.end });
    }
    return legs;
  }
  function lineBounds(t, pos) {
    const s = t.lastIndexOf("\n", pos - 1) + 1;
    let e = t.indexOf("\n", pos);
    if (e < 0) e = t.length;
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
    const isA = APPROACH_ANCHORS.some((r) => r.test(beforeSameLine)) || APPROACH_AFTER.some((r) => r.test(after)) || APPROACH_ANCHORS.slice(1).some((r) => r.test(beforeWide));
    const isT = TRIP_ANCHORS.some((r) => r.test(beforeSameLine)) || TRIP_AFTER.some((r) => r.test(after)) || TRIP_ANCHORS.some((r) => r.test(beforeWide));
    const aLine = APPROACH_ANCHORS.some((r) => r.test(beforeSameLine)) || APPROACH_AFTER.some((r) => r.test(after));
    const tLine = TRIP_ANCHORS.some((r) => r.test(beforeSameLine)) || TRIP_AFTER.some((r) => r.test(after));
    if (aLine && !tLine) return { role: "approach", reason: "anchor-line" };
    if (tLine && !aLine) return { role: "trip", reason: "anchor-line" };
    if (isA && !isT) return { role: "approach", reason: "anchor-context" };
    if (isT && !isA) return { role: "trip", reason: "anchor-context" };
    return { role: null, reason: isA && isT ? "both-anchors" : "no-anchor" };
  }
  var EXTRA_WORDS = /(inclus|boost|bonus|pourboire|\btip\b|majoration|supplement|peage|promo|prime|defi|quest|surge|dynamique|minimum)/;
  var GROSS_CUES = /(prix client|paye par (le )?(client|passager)|tarif (client|passager)|avant commission|prix total client)/;
  var NET_CUES = /(vos gains|gains nets?|revenu net|net chauffeur|vous recevrez|vous gagnez|gain estime)/;
  function detectPlatform(t) {
    const f = fold(t);
    const uber = /\buber\s?(x|green|comfort|berline|van|pet|black|pool|share|xl)?\b/.test(f) || /\buberx\b/.test(f);
    const bolt = /\bbolt\b/.test(f);
    if (uber && !bolt) return ocr("uber", "uber", "platform.keyword");
    if (bolt && !uber) return ocr("bolt", "bolt", "platform.keyword");
    return none();
  }
  function parseOffer(rawText) {
    const t = normalizeText(rawText != null ? rawText : "");
    const f = fold(t);
    const warnings = [];
    const platform = detectPlatform(t);
    const { money, legs: legToks } = tokenize(t);
    const extras = [];
    const candidates = [];
    for (const m of money) {
      if (m.rate) continue;
      const [ls, le] = lineBounds(t, m.start);
      const line = fold(t.slice(ls, le));
      if (m.plus || EXTRA_WORDS.test(line)) {
        extras.push({ label: line.slice(0, 40), amount: m.value, raw: m.raw });
        continue;
      }
      candidates.push(m);
    }
    let price = none();
    const ranges = [];
    let badRange = false;
    for (const line of t.split("\n")) {
      const fl = fold(line);
      if (EXTRA_WORDS.test(fl) || /\d{1,2}[:h]\d{2}/.test(line)) continue;
      const rm = line.match(/(?<![\d.,:])(\d{1,4}(?:[.,]\d{1,2})?)\s*€?\s*-\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*€/);
      if (!rm) continue;
      const lo = parseDecimal(rm[1]);
      const hi = parseDecimal(rm[2]);
      if (lo !== null && hi !== null && hi > lo) ranges.push({ lo, raw: rm[0] });
      else badRange = true;
    }
    const distinct = [...new Set(candidates.map((c) => c.value))];
    if (ranges.length === 1) {
      price = ocr(ranges[0].lo, ranges[0].raw, "price.range-low", "medium");
      warnings.push("Prix en fourchette : borne basse retenue");
    } else if (ranges.length > 1 || badRange) {
      warnings.push(badRange ? "Fourchette de prix incoh\xE9rente : prix ambigu" : "Plusieurs fourchettes de prix : prix ambigu");
    } else if (distinct.length === 1) {
      price = ocr(distinct[0], candidates[0].raw, "price.single", "high");
    } else if (distinct.length > 1) {
      const alone = candidates.filter((c) => {
        const [ls, le] = lineBounds(t, c.start);
        return t.slice(ls, le).trim().length <= c.raw.length + 2;
      });
      const aloneDistinct = [...new Set(alone.map((c) => c.value))];
      if (aloneDistinct.length === 1) {
        price = ocr(aloneDistinct[0], alone[0].raw, "price.standalone-line", "medium");
        warnings.push("Plusieurs montants lus : montant isol\xE9 retenu");
      } else {
        warnings.push(`Prix ambigu (${distinct.join(" / ")} \u20AC)`);
      }
    }
    if (price.value !== null && (price.value <= 0 || price.value > 2e3)) {
      warnings.push("Prix hors plage plausible");
      price = none();
    }
    let priceBasis = none();
    const g = GROSS_CUES.test(f);
    const n = NET_CUES.test(f);
    if (g && !n) priceBasis = ocr("gross_before_commission", "indice texte", "basis.cue", "medium");
    if (n && !g) priceBasis = ocr("net_driver", "indice texte", "basis.cue", "medium");
    const legToksF = legToks.filter((x) => !(x.kind === "dur" && x.value > 300));
    const legs = pairLegs(t, legToksF).filter((l) => !(l.min && l.min.hourNoMin && !l.km));
    const roles = [];
    let prevEnd = 0;
    for (const leg of legs) {
      const c = classify(t, leg, prevEnd);
      roles.push({ leg, ...c });
      prevEnd = leg.end;
    }
    const full = roles.filter((r) => r.leg.min && r.leg.km);
    if (full.length === 2) {
      const [r1, r2] = full;
      if (r1.role && !r2.role) {
        r2.role = r1.role === "approach" ? "trip" : "approach";
        r2.reason = "complement";
      } else if (r2.role && !r1.role) {
        r1.role = r2.role === "approach" ? "trip" : "approach";
        r1.reason = "complement";
      }
    }
    const pick = (role, kind) => {
      const found = roles.filter((r) => r.role === role && r.leg[kind]);
      const values = [...new Set(found.map((r) => r.leg[kind].value))];
      if (values.length === 0) return none();
      if (values.length > 1) {
        warnings.push(`${role === "approach" ? "Approche" : "Trajet"} : plusieurs ${kind === "km" ? "distances" : "dur\xE9es"} candidates`);
        return none();
      }
      const tok = found[0].leg[kind];
      if (!tok.unitOk) {
        warnings.push(`Unit\xE9 non support\xE9e : ${tok.raw}`);
        return none();
      }
      const conf = found[0].reason === "anchor-line" ? "high" : "medium";
      return ocr(tok.value, tok.raw, `${role}.${found[0].reason}`, conf);
    };
    const approachKm = pick("approach", "km");
    const approachMin = pick("approach", "min");
    const tripKm = pick("trip", "km");
    const tripMin = pick("trip", "min");
    const unresolved = roles.filter((r) => !r.role && (r.leg.min || r.leg.km));
    if (unresolved.length) warnings.push(`${unresolved.length} distance(s)/dur\xE9e(s) sans r\xF4le identifiable`);
    if (approachKm.value !== null && approachKm.value > 100) warnings.push("Approche > 100 km : \xE0 v\xE9rifier");
    if (tripMin.value !== null && tripKm.value !== null && tripMin.value > 0) {
      const kmh = tripKm.value / tripMin.value * 60;
      if (kmh > 150) warnings.push("Vitesse moyenne implausible (> 150 km/h)");
    }
    let expiresInSec = none();
    let exp = null;
    for (const line of t.split("\n")) {
      exp = line.match(/(?:accepter|accept)[ \t]*\([ \t]*(\d{1,2})[ \t]*\)/i) || line.match(/(?<![\d.,])(\d{1,2})[ \t]*(?:s|sec|secondes?)\b(?![ \t]*\/)/i);
      if (exp) break;
    }
    if (exp) {
      const v = Number(exp[1]);
      if (v > 0 && v <= 60) expiresInSec = ocr(v, exp[0], "expiry.countdown", "low");
    }
    const prod = f.match(/\b(uberx|uber x|uber green|green|comfort|berline|van|xl|uber pet|bolt comfort|bolt xl|economy|executive|premium)\b/);
    const productLabel = prod ? prod[1] : null;
    const haveLegs = [approachKm, approachMin, tripKm, tripMin].filter((x) => x.value !== null).length;
    let status;
    if (price.value === null && haveLegs === 0 && candidates.length === 0) status = "not_offer";
    else if (price.value === null && (distinct.length > 1 || badRange || ranges.length > 1)) status = "ambiguous";
    else if (price.value !== null && haveLegs === 4) status = "ok";
    else status = "partial";
    if (status === "not_offer") warnings.push("Aucune offre reconnue dans le texte");
    return {
      platform,
      layoutId: platform.value ? `${platform.value}.fr.v1` : null,
      parserVersion: PARSER_VERSION,
      price,
      currency: price.value !== null ? "EUR" : null,
      priceBasis,
      approachKm,
      approachMin,
      tripKm,
      tripMin,
      expiresInSec,
      extras,
      productLabel,
      status,
      warnings
    };
  }

  // src/core/analyze.ts
  function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = Math.random() * 16 | 0;
      return (ch === "x" ? r : r & 3 | 8).toString(16);
    });
  }
  function buildFinanceInput(offer, cfg) {
    const plat = offer.platform.value && offer.platform.value !== "unknown" ? offer.platform.value : null;
    const rule = plat ? cfg.platforms[plat] : null;
    let basis = "unknown";
    if (offer.priceBasis.value) basis = offer.priceBasis.value;
    else if (rule) basis = rule.priceBasis;
    return {
      price: offer.price.value,
      priceBasis: basis,
      // Le taux n'est utilisé que si l'utilisateur a confirmé que cette plateforme affiche un montant avant commission.
      commissionRate: rule && rule.priceBasis === "gross_before_commission" ? rule.commissionRate : null,
      approachKm: offer.approachKm.value,
      approachMin: offer.approachMin.value,
      tripKm: offer.tripKm.value,
      tripMin: offer.tripMin.value,
      scenario: cfg.scenario,
      variablePerKm: cfg.cost.variablePerKm,
      fixedPerHour: cfg.cost.fixedPerHour,
      otherCosts: cfg.cost.otherPerOffer
    };
  }
  function applySessionPlatform(offer, cfg) {
    if (offer.platform.value || !cfg.sessionPlatform || cfg.sessionPlatform === "unknown") return offer;
    return { ...offer, platform: { value: cfg.sessionPlatform, provenance: "config", rule: "session-platform" } };
  }
  function hhmmss(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function buildDisplay(a) {
    const v = a.verdict;
    const lvl = v.level === "margin" ? "marge" : "recette";
    const fin0 = a.finance;
    const preCost = v.perHour === null && v.perKm === null && (fin0.revenuePerHour !== null || fin0.revenuePerKm !== null);
    const main2 = v.perHour !== null ? `${fmtNum(v.perHour, 2)} \u20AC/h ${lvl}` : v.perKm !== null ? `${fmtNum(v.perKm, 2)} \u20AC/km ${lvl}` : preCost ? fin0.revenuePerHour !== null ? `${fmtNum(fin0.revenuePerHour, 2)} \u20AC/h recette avant frais` : `${fmtNum(fin0.revenuePerKm, 2)} \u20AC/km recette avant frais` : "";
    const title = `${VERDICT_SYMBOL[v.verdict]} ${VERDICT_LABEL[v.verdict]}${main2 ? " \xB7 " + main2 : ""}`;
    const parts = [];
    if (v.perKm !== null && v.perHour !== null) parts.push(`${fmtNum(v.perKm, 2)} \u20AC/km`);
    if (preCost && fin0.revenuePerHour !== null && fin0.revenuePerKm !== null) parts.push(`${fmtNum(fin0.revenuePerKm, 2)} \u20AC/km avant frais`);
    const fin = a.finance;
    if (fin.P !== null) parts.push(`P ${fmtNum(fin.P, 2)} \u20AC${fin.pIsUpperBound ? " (base ?)" : ""}`);
    if (fin.D !== null) parts.push(`${fmtNum(fin.D, 1)} km`);
    if (fin.T !== null) parts.push(`${fmtNum(fin.T, 0)} min`);
    if (a.input.approachKm !== null || a.input.approachMin !== null) parts.push("approche incluse");
    if (v.verdict === "partiel" || v.verdict === "indisponible" || v.verdict === "faible") {
      const r = v.reasons[0];
      if (r) parts.push(r);
    }
    const plat = a.offer.platform.value ? a.offer.platform.value.toUpperCase() : "plateforme ?";
    parts.push(`${plat} ${hhmmss(a.capturedAt)}`);
    let speech;
    if (v.verdict === "indisponible") speech = "Analyse indisponible.";
    else if (v.perHour !== null) speech = `${VERDICT_LABEL[v.verdict]}. ${Math.round(v.perHour)} euros de l'heure.`;
    else if (preCost && fin0.revenuePerHour !== null) speech = `${VERDICT_LABEL[v.verdict]}. ${Math.round(fin0.revenuePerHour)} euros de l'heure avant frais.`;
    else if (v.perKm !== null) speech = `${VERDICT_LABEL[v.verdict]}. ${fmtNum(v.perKm, 2).replace(",", " euro ")} du kilom\xE8tre.`;
    else speech = `${VERDICT_LABEL[v.verdict]}.`;
    return { title, body: parts.join(" \xB7 "), speech };
  }
  function analyzeText(text, cfg, opts = {}) {
    var _a, _b;
    const now = (_a = opts.now) != null ? _a : () => /* @__PURE__ */ new Date();
    const capturedAt = (_b = opts.capturedAt) != null ? _b : now().toISOString();
    const offer = applySessionPlatform(parseOffer(text), cfg);
    return analyzeParsed(offer, cfg, { ...opts, capturedAt, now });
  }
  function analyzeParsed(offer, cfg, opts = {}) {
    var _a, _b, _c, _d;
    const now = (_a = opts.now) != null ? _a : () => /* @__PURE__ */ new Date();
    const capturedAt = (_b = opts.capturedAt) != null ? _b : now().toISOString();
    const input = buildFinanceInput(offer, cfg);
    const finance = computeFinance(input);
    let verdict = computeVerdict(finance, cfg.thresholds);
    if (offer.status === "not_offer") {
      verdict = { ...verdict, verdict: "indisponible", reasons: ["Aucune offre reconnue", ...verdict.reasons] };
    }
    const expiry = offer.expiresInSec.value;
    const validSec = expiry !== null ? Math.min(expiry, cfg.freshnessSec) : cfg.freshnessSec;
    const validUntil = new Date(new Date(capturedAt).getTime() + validSec * 1e3).toISOString();
    const base = {
      id: (_c = opts.id) != null ? _c : newId(),
      engineVersion: ENGINE_VERSION,
      parserVersion: offer.parserVersion,
      configId: cfg.configId,
      costProfileRef: { id: cfg.cost.id, version: cfg.cost.version },
      thresholdRef: { id: cfg.thresholds.id, version: cfg.thresholds.version },
      thresholdValues: { level: cfg.thresholds.level, perKm: cfg.thresholds.perKm, perHour: cfg.thresholds.perHour },
      capturedAt,
      analyzedAt: now().toISOString(),
      validUntil,
      source: (_d = opts.source) != null ? _d : "shortcut",
      offer,
      input,
      finance,
      verdict
    };
    return { ...base, display: buildDisplay(base) };
  }
  function isFresh(a, now = /* @__PURE__ */ new Date()) {
    return now.getTime() <= new Date(a.validUntil).getTime();
  }
  function shouldDisplay(a, latestRequest, now = /* @__PURE__ */ new Date()) {
    if (latestRequest && latestRequest.id !== a.id && new Date(latestRequest.capturedAt) > new Date(a.capturedAt)) {
      return { show: false, reason: "R\xE9sultat remplac\xE9 par une offre plus r\xE9cente" };
    }
    if (!isFresh(a, now)) return { show: false, reason: "R\xE9sultat p\xE9rim\xE9" };
    return { show: true, reason: "ok" };
  }

  // src/core/config.ts
  function fnv1a(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
  function canonical(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    const o = v;
    return "{" + Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  function buildFastConfig(p, createdAt = (/* @__PURE__ */ new Date()).toISOString()) {
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
      apiBase: p.apiBase
    };
    const configId = "cfg-" + fnv1a(canonical(body));
    return { ...body, configId, createdAt };
  }
  var isPosOrNull = (x) => x === null || typeof x === "number" && Number.isFinite(x) && x >= 0;
  function validateFastConfig(x) {
    var _a;
    const e = [];
    const c = x;
    if (!c || typeof c !== "object") return { ok: false, errors: ["Configuration absente"] };
    if (c.schema !== 1) e.push("Version de sch\xE9ma inconnue");
    if (typeof c.configId !== "string") e.push("configId manquant");
    if (!c.cost || typeof c.cost.id !== "string") e.push("Profil de co\xFBts manquant");
    else {
      if (!isPosOrNull(c.cost.variablePerKm)) e.push("v invalide");
      if (!isPosOrNull(c.cost.fixedPerHour)) e.push("f invalide");
      if (!isPosOrNull(c.cost.otherPerOffer)) e.push("E invalide");
    }
    if (!c.thresholds || !(c.thresholds.perKm > 0) || !(c.thresholds.perHour > 0)) e.push("Seuils invalides (doivent \xEAtre > 0)");
    if (c.thresholds && c.thresholds.level !== "revenue" && c.thresholds.level !== "margin") e.push("Niveau de seuil invalide");
    for (const k of ["uber", "bolt"]) {
      const r = (_a = c.platforms) == null ? void 0 : _a[k];
      if (!r) e.push(`R\xE8gle ${k} manquante`);
      else {
        if (!["net_driver", "gross_before_commission", "unknown"].includes(r.priceBasis)) e.push(`Base ${k} invalide`);
        if (r.commissionRate !== null && !(r.commissionRate >= 0 && r.commissionRate < 1)) e.push(`Commission ${k} invalide`);
      }
    }
    if (!(c.freshnessSec > 0 && c.freshnessSec <= 120)) e.push("Fra\xEEcheur invalide (1 \xE0 120 s)");
    if (!c.scenario) e.push("Sc\xE9nario manquant");
    if (e.length === 0) {
      const { configId, createdAt, ...body } = c;
      const expect = "cfg-" + fnv1a(canonical(body));
      if (expect !== configId) e.push("Empreinte de configuration incoh\xE9rente (fichier modifi\xE9 ?)");
    }
    return e.length ? { ok: false, errors: e } : { ok: true, config: c };
  }
  function demoConfig() {
    return buildFastConfig(
      {
        cost: { id: "demo-cost", version: 1, effectiveFrom: "2026-01-01T00:00:00Z", variablePerKm: 0.2, fixedPerHour: 5, otherPerOffer: 0 },
        thresholds: { id: "demo-th", version: 1, effectiveFrom: "2026-01-01T00:00:00Z", level: "margin", perKm: 1, perHour: 18 },
        platforms: {
          uber: { priceBasis: "net_driver", commissionRate: null },
          bolt: { priceBasis: "unknown", commissionRate: null }
        },
        sessionPlatform: null,
        scenario: { returnKm: null, returnMin: null, waitMin: null },
        freshnessSec: 10,
        voice: true,
        syncMode: "off",
        apiBase: null
      },
      "2026-01-01T00:00:00.000Z"
    );
  }

  // shortcut/runtime.ts
  var SYNC_BATCH = 100;
  var SYNC_MAX_BATCHES = 5;
  var TOKEN_KEY = "vtcperso.deviceToken";
  function createRuntime() {
    const fm = FileManager.local();
    const dir = fm.joinPath(fm.documentsDirectory(), "vtcperso");
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    const path = (n) => fm.joinPath(dir, n);
    const read = (n) => fm.fileExists(path(n)) ? fm.readString(path(n)) : null;
    const dayFile = () => "journal-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".jsonl";
    const unsynced = () => {
      var _a, _b;
      const done = new Set((_a = rt.readJson("synced.json")) != null ? _a : []);
      const out = [];
      for (const f of fm.listContents(dir).filter((x) => x.startsWith("journal-")).sort()) {
        for (const line of ((_b = read(f)) != null ? _b : "").split("\n")) {
          if (!line.includes('"kind":"analysis"')) continue;
          try {
            const a = JSON.parse(line).analysis;
            if (a && !done.has(a.id)) out.push(a);
          } catch {
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
        if (!s) return null;
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      },
      writeJson(n, v) {
        fm.writeString(path(n), JSON.stringify(v));
      },
      appendJournal(line) {
        var _a;
        const f = dayFile();
        const prev = (_a = read(f)) != null ? _a : "";
        fm.writeString(path(f), prev + JSON.stringify(line) + "\n");
      },
      pendingCount() {
        return unsynced().length;
      },
      copyJournal() {
        const files = fm.listContents(dir).filter((f) => f.startsWith("journal-")).sort();
        const all = files.map((f) => {
          var _a;
          return (_a = read(f)) != null ? _a : "";
        }).join("");
        Pasteboard.copy(all);
        return all.split("\n").filter((l) => l.trim()).length;
      },
      async sync(cfg) {
        var _a, _b, _c;
        if (!cfg.apiBase) return "Pas d\u2019adresse serveur configur\xE9e : utilisez l\u2019export du journal.";
        if (!Keychain.contains(TOKEN_KEY)) return "Pas de jeton d\u2019appareil enregistr\xE9.";
        const pending = unsynced();
        if (!pending.length) return "Rien \xE0 synchroniser.";
        const done = new Set((_a = rt.readJson("synced.json")) != null ? _a : []);
        let sent = 0;
        for (let b = 0; b < SYNC_MAX_BATCHES && b * SYNC_BATCH < pending.length; b++) {
          const batch = pending.slice(b * SYNC_BATCH, (b + 1) * SYNC_BATCH);
          const r = new Request(cfg.apiBase.replace(/\/$/, "") + "/ingest");
          r.method = "POST";
          r.timeoutInterval = 8;
          r.headers = { "content-type": "application/json", "x-device-token": Keychain.get(TOKEN_KEY) };
          r.body = JSON.stringify({ analyses: batch });
          try {
            const res = await r.loadJSON();
            if (r.response.statusCode !== 200 || !Array.isArray(res.accepted)) return `\xC9chec : ${(_b = res.error) != null ? _b : r.response.statusCode}. ${sent} envoy\xE9e(s), le reste est conserv\xE9.`;
            for (const id of [...res.accepted, ...(_c = res.rejected) != null ? _c : []]) done.add(id);
            rt.writeJson("synced.json", [...done]);
            sent += res.accepted.length;
          } catch (e) {
            return `R\xE9seau indisponible : ${sent} envoy\xE9e(s), le reste est conserv\xE9 (${String(e).slice(0, 60)})`;
          }
        }
        return `${sent} analyse(s) synchronis\xE9e(s), ${unsynced().length} en attente.`;
      },
      pasteboard: () => Pasteboard.paste(),
      setToken: (t) => Keychain.set(TOKEN_KEY, t),
      hasToken: () => Keychain.contains(TOKEN_KEY),
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
        a.addAction("OK");
        await a.presentAlert();
      },
      async menu(title, options) {
        const a = new Alert();
        a.title = title;
        options.forEach((o) => a.addAction(o));
        a.addCancelAction("Fermer");
        return a.presentSheet();
      },
      complete(output) {
        if (output !== null && output !== void 0) Script.setShortcutOutput(output);
        Script.complete();
      }
    };
    return rt;
  }

  // shortcut/scriptable-entry.ts
  function parseIsoMs(s) {
    if (!s || typeof s !== "string") return null;
    const t = Date.parse(s.trim().replace(" ", "T").replace(/,(\d{1,3})/, ".$1"));
    return Number.isFinite(t) ? t : null;
  }
  function runAnalyze(rt, input) {
    const scriptStart = rt.now();
    const t0ms = parseIsoMs(input.t0);
    const capturedAt = new Date(t0ms != null ? t0ms : scriptStart).toISOString();
    const id = rt.uuid();
    const log = !input.test;
    const prev = rt.readJson("latest.json");
    const prevT = prev && typeof prev.capturedAt === "string" ? Date.parse(prev.capturedAt) : -Infinity;
    if (!(prevT > Date.parse(capturedAt))) rt.writeJson("latest.json", { id, capturedAt });
    const cfgRaw = rt.readJson("config.json");
    const v = cfgRaw ? validateFastConfig(cfgRaw) : null;
    if (!v || !v.ok) {
      const out = {
        show: true,
        speak: false,
        title: "\u26A0\uFE0F Analyse indisponible",
        body: v && !v.ok ? "Configuration invalide : " + v.errors[0] : "Configuration absente : ouvrez VTC Perso dans Scriptable",
        speech: "",
        id,
        verdict: "indisponible",
        configId: null
      };
      if (log) rt.appendJournal({ kind: "error", id, at: capturedAt, message: out.body });
      return out;
    }
    const cfg = v.config;
    const text = typeof input.text === "string" ? input.text : "";
    const a = analyzeText(text, cfg, { id, capturedAt, now: () => new Date(rt.now()), source: "shortcut" });
    const latest = rt.readJson("latest.json");
    const decision = shouldDisplay(a, latest, new Date(rt.now()));
    const scriptEnd = rt.now();
    if (log) {
      rt.appendJournal({ kind: "analysis", analysis: a });
      rt.appendJournal({
        kind: "timing",
        id,
        scriptStartMs: t0ms !== null ? scriptStart - t0ms : void 0,
        scriptEndMs: t0ms !== null ? scriptEnd - t0ms : void 0,
        suppressed: !decision.show
      });
    }
    if (!decision.show) {
      return { show: false, speak: false, title: "", body: decision.reason, speech: "", id, verdict: a.verdict.verdict, configId: cfg.configId };
    }
    return {
      show: true,
      speak: cfg.voice && a.display.speech.length > 0,
      title: a.display.title,
      body: a.display.body,
      speech: a.display.speech,
      id,
      verdict: a.verdict.verdict,
      configId: cfg.configId
    };
  }
  async function runPost(rt, input) {
    var _a;
    const latest = rt.readJson("latest.json");
    const t0 = latest && latest.id === input.id ? Date.parse(latest.capturedAt) : null;
    const tn = (_a = parseIsoMs(input.tNotify)) != null ? _a : rt.now();
    if (input.id) rt.appendJournal({ kind: "timing", id: input.id, afterNotifyMs: t0 !== null ? tn - t0 : void 0 });
    const cfgRaw = rt.readJson("config.json");
    if (cfgRaw && cfgRaw.syncMode === "after_each") return rt.sync(cfgRaw);
    return "ok";
  }
  async function inAppMenu(rt) {
    var _a;
    const choice = await rt.menu("VTC Perso", [
      "Importer la configuration (presse-papiers)",
      "Tester une offre fictive (notification + voix)",
      "Copier le journal dans le presse-papiers",
      "Synchroniser maintenant",
      "Enregistrer le jeton d\u2019appareil (presse-papiers)",
      "Installer la configuration de d\xE9monstration",
      "\xC9tat"
    ]);
    if (choice === 0) {
      const txt = rt.pasteboard();
      let obj = null;
      try {
        obj = JSON.parse(txt != null ? txt : "");
      } catch {
      }
      const v = validateFastConfig(obj);
      if (!v.ok) return rt.alert("Configuration refus\xE9e", v.errors.join("\n"));
      rt.writeJson("config.json", v.config);
      return rt.alert("Configuration enregistr\xE9e", `${v.config.configId}
Co\xFBts v${v.config.cost.version}, seuils v${v.config.thresholds.version}`);
    }
    if (choice === 1) {
      const fake = "OFFRE FICTIVE\nUberX\n12,50 \u20AC\n\xC0 6 min (2,0 km)\nTrajet de 20 min (8,0 km)";
      const out = runAnalyze(rt, { mode: "analyze", text: fake, t0: new Date(rt.now()).toISOString(), test: true });
      rt.notify(out.title, out.body + " (TEST FICTIF)");
      if (out.speak) rt.speak(out.speech);
      return rt.alert(out.title, out.body + "\n\nCe test v\xE9rifie la configuration, la notification et la voix. Il ne mesure pas le parcours r\xE9el.");
    }
    if (choice === 2) {
      const n = rt.copyJournal();
      return rt.alert("Journal copi\xE9", `${n} ligne(s). Collez-les dans la PWA : R\xE9glages > Donn\xE9es > Importer le journal du raccourci.`);
    }
    if (choice === 3) {
      const cfg = rt.readJson("config.json");
      if (!cfg) return rt.alert("Synchronisation", "Configuration absente");
      return rt.alert("Synchronisation", await rt.sync(cfg));
    }
    if (choice === 4) {
      const tok = ((_a = rt.pasteboard()) != null ? _a : "").trim();
      if (!/^vtcd_[A-Za-z0-9_-]{30,}$/.test(tok)) return rt.alert("Jeton refus\xE9", "Le presse-papiers ne contient pas un jeton VTC Perso (vtcd_\u2026).");
      rt.setToken(tok);
      return rt.alert("Jeton enregistr\xE9", "Stock\xE9 dans le trousseau iOS de Scriptable. R\xE9vocable depuis la PWA.");
    }
    if (choice === 5) {
      rt.writeJson("config.json", demoConfig());
      return rt.alert("D\xE9monstration", "Configuration FICTIVE install\xE9e (v=0,20 \u20AC/km, f=5 \u20AC/h, seuils marge 1 \u20AC/km et 18 \u20AC/h). Remplacez-la par la v\xF4tre avant de conduire.");
    }
    if (choice === 6) {
      const cfg = rt.readJson("config.json");
      return rt.alert("\xC9tat", `Configuration : ${cfg ? cfg.configId + " du " + cfg.createdAt.slice(0, 10) : "absente"}
En attente de synchronisation : ${rt.pendingCount()}
Jeton : ${rt.hasToken() ? "oui" : "non"}`);
    }
  }
  async function main() {
    const rt = createRuntime();
    const p = typeof args !== "undefined" ? args.shortcutParameter : void 0;
    const input = typeof p === "string" ? { mode: "analyze", text: p } : p && typeof p === "object" ? p : null;
    if (!input) {
      if (config.runsInApp) await inAppMenu(rt);
      rt.complete(null);
      return;
    }
    try {
      if (input.mode === "post") {
        rt.complete(await runPost(rt, input));
      } else if (input.mode === "sync") {
        const cfg = rt.readJson("config.json");
        rt.complete(cfg ? await rt.sync(cfg) : "Configuration absente");
      } else {
        rt.complete(runAnalyze(rt, input));
      }
    } catch (e) {
      rt.complete({ show: true, speak: false, title: "\u26A0\uFE0F Analyse indisponible", body: "Erreur interne : " + String(e).slice(0, 80), speech: "", id: "", verdict: "indisponible", configId: null });
    }
  }
  return __toCommonJS(scriptable_entry_exports);
})();

await VTCPersoBundle.main();

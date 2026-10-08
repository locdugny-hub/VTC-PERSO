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
    margin = P - variableCost - fixedAllocation - (E ?? 0);
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
function round(x, digits = 2) {
  if (!isNum(x)) return null;
  const k = 10 ** digits;
  return Math.round((x + Number.EPSILON) * k) / k;
}
function fmtEur(x, digits = 2) {
  if (!isNum(x)) return "\u2014";
  return x.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " \u20AC";
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
  const money = [];
  for (const m of t.matchAll(MONEY_RE)) {
    const num = m[2] ?? m[4];
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
      rate: !!(m[3] ?? m[5])
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
  const t = normalizeText(rawText ?? "");
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
  const main = v.perHour !== null ? `${fmtNum(v.perHour, 2)} \u20AC/h ${lvl}` : v.perKm !== null ? `${fmtNum(v.perKm, 2)} \u20AC/km ${lvl}` : preCost ? fin0.revenuePerHour !== null ? `${fmtNum(fin0.revenuePerHour, 2)} \u20AC/h recette avant frais` : `${fmtNum(fin0.revenuePerKm, 2)} \u20AC/km recette avant frais` : "";
  const title = `${VERDICT_SYMBOL[v.verdict]} ${VERDICT_LABEL[v.verdict]}${main ? " \xB7 " + main : ""}`;
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
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  const capturedAt = opts.capturedAt ?? now().toISOString();
  const offer = applySessionPlatform(parseOffer(text), cfg);
  return analyzeParsed(offer, cfg, { ...opts, capturedAt, now });
}
function analyzeParsed(offer, cfg, opts = {}) {
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  const capturedAt = opts.capturedAt ?? now().toISOString();
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
    id: opts.id ?? newId(),
    engineVersion: ENGINE_VERSION,
    parserVersion: offer.parserVersion,
    configId: cfg.configId,
    costProfileRef: { id: cfg.cost.id, version: cfg.cost.version },
    thresholdRef: { id: cfg.thresholds.id, version: cfg.thresholds.version },
    thresholdValues: { level: cfg.thresholds.level, perKm: cfg.thresholds.perKm, perHour: cfg.thresholds.perHour },
    capturedAt,
    analyzedAt: now().toISOString(),
    validUntil,
    source: opts.source ?? "shortcut",
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
    const r = c.platforms?.[k];
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

// src/core/domain.ts
var OFFER_STATUS_LABEL = {
  analysee: "Analys\xE9e",
  acceptee: "Accept\xE9e",
  refusee: "Refus\xE9e",
  annulee: "Annul\xE9e",
  realisee: "R\xE9alis\xE9e",
  encaissee: "Encaiss\xE9e"
};
var STORES = ["vehicles", "costProfiles", "thresholds", "offers", "trips", "sessions", "expenses", "settings"];
function deriveCosts(v) {
  const energyPerKm = v.consumptionPer100 !== null && v.energyUnitPrice !== null ? v.consumptionPer100 / 100 * v.energyUnitPrice : null;
  const variablePerKm = energyPerKm !== null && v.maintenancePerKm !== null ? energyPerKm + v.maintenancePerKm : null;
  const fixedPerHour = v.fixedMonthly !== null && v.plannedHoursMonthly !== null && v.plannedHoursMonthly > 0 ? v.fixedMonthly / v.plannedHoursMonthly : null;
  return { variablePerKm, fixedPerHour, energyPerKm };
}
function defaultSettings(now = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    id: "settings",
    updatedAt: now,
    activeVehicleId: null,
    activeCostProfileId: null,
    activeThresholdId: null,
    platforms: {
      uber: { priceBasis: "unknown", commissionRate: null, confirmed: false },
      bolt: { priceBasis: "unknown", commissionRate: null, confirmed: false }
    },
    sessionPlatform: null,
    scenario: { returnKm: null, returnMin: null, waitMin: null },
    freshnessSec: 10,
    voice: true,
    syncMode: "off",
    apiBase: null,
    aiEnabled: false,
    onboardingDone: false
  };
}

// src/core/history.ts
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
function offerFromAnalysis(a, sessionId = null, timing = null) {
  return {
    id: a.id,
    updatedAt: a.analyzedAt,
    capturedAt: a.capturedAt,
    platform: a.offer.platform.value ?? "unknown",
    source: a.source,
    original: a,
    corrected: null,
    corrections: [],
    status: "analysee",
    statusHistory: [{ status: "analysee", at: a.analyzedAt }],
    sessionId,
    tripId: null,
    timing
  };
}
var ALLOWED = {
  analysee: ["acceptee", "refusee"],
  acceptee: ["annulee", "realisee", "refusee"],
  refusee: ["acceptee"],
  annulee: ["acceptee"],
  realisee: ["encaissee", "annulee"],
  encaissee: ["realisee"]
};
function canTransition(from, to) {
  return ALLOWED[from].includes(to);
}
function setStatus(offer, to, opts = {}) {
  if (offer.status === to) return { offer, trip: opts.trip ?? null };
  if (!canTransition(offer.status, to)) throw new Error(`Transition ${offer.status} -> ${to} non autoris\xE9e`);
  const at = opts.at ?? nowIso();
  let trip = opts.trip ?? null;
  if (to === "realisee" || to === "encaissee") {
    if (!trip) {
      if (typeof opts.confirmedRevenue !== "number" || !(opts.confirmedRevenue >= 0)) {
        throw new Error("Montant r\xE9ellement per\xE7u requis pour une course r\xE9alis\xE9e");
      }
      const a = offer.corrected ?? offer.original;
      trip = {
        id: offer.id + ":trip",
        updatedAt: at,
        offerId: offer.id,
        sessionId: offer.sessionId,
        date: offer.capturedAt,
        platform: offer.platform,
        revenue: opts.confirmedRevenue,
        km: a.finance.D,
        minutes: a.finance.T,
        status: "realisee",
        paidAt: null,
        note: ""
      };
    }
    trip = { ...trip, status: to === "encaissee" ? "encaissee" : "realisee", paidAt: to === "encaissee" ? at : null, updatedAt: at };
  }
  if (to === "annulee" && trip) trip = { ...trip, status: "annulee", updatedAt: at };
  return {
    offer: {
      ...offer,
      status: to,
      statusHistory: [...offer.statusHistory, { status: to, at }],
      tripId: trip ? trip.id : offer.tripId,
      updatedAt: at
    },
    trip
  };
}
var FIELD_TO_INPUT = {
  price: "price",
  priceBasis: "priceBasis",
  commissionRate: "commissionRate",
  approachKm: "approachKm",
  approachMin: "approachMin",
  tripKm: "tripKm",
  tripMin: "tripMin"
};
function applyCorrection(offer, field, value, at = nowIso()) {
  const base = offer.corrected ?? offer.original;
  const input = { ...base.input };
  const parsed = JSON.parse(JSON.stringify(base.offer));
  let before;
  if (field === "platform") {
    before = parsed.platform.value;
    parsed.platform = { value, provenance: "manual" };
  } else {
    const k = FIELD_TO_INPUT[field];
    before = input[k];
    input[k] = value;
    if (field !== "commissionRate") {
      const pf = field;
      parsed[pf] = { value, provenance: "manual" };
    }
  }
  const finance = computeFinance(input);
  const tv = base.thresholdValues;
  const verdict = computeVerdict(finance, { id: "", version: 0, effectiveFrom: "", ...tv });
  const corrected0 = { ...base, offer: parsed, input, finance, verdict, analyzedAt: at };
  const corrected = { ...corrected0, display: buildDisplay(corrected0) };
  return {
    ...offer,
    platform: parsed.platform.value ?? offer.platform,
    corrected,
    corrections: [...offer.corrections, { at, field, before, after: value }],
    updatedAt: at
  };
}
function importJournal(text, existing) {
  const errors = [];
  const byId = /* @__PURE__ */ new Map();
  const timings = /* @__PURE__ */ new Map();
  let skipped = 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  lines.forEach((l, i) => {
    let j;
    try {
      j = JSON.parse(l);
    } catch {
      errors.push(`Ligne ${i + 1} illisible`);
      return;
    }
    if (j.kind === "analysis") {
      const a = sanitizeAnalysis(j.analysis);
      if (!a) {
        errors.push(`Ligne ${i + 1} : analyse invalide ignor\xE9e`);
        return;
      }
      if (existing.has(a.id) || byId.has(a.id)) {
        skipped++;
        return;
      }
      byId.set(a.id, offerFromAnalysis(a));
    } else if (j.kind === "error") {
      skipped++;
    } else if (j.kind === "timing" && typeof j.id === "string") {
      const okNum = (x) => x === void 0 || typeof x === "number" && Number.isFinite(x);
      if (!okNum(j.scriptStartMs) || !okNum(j.scriptEndMs) || !okNum(j.afterNotifyMs)) {
        errors.push(`Ligne ${i + 1} : mesure invalide`);
        return;
      }
      const t = timings.get(j.id) ?? {};
      if (typeof j.scriptStartMs === "number") t.scriptStartMs = j.scriptStartMs;
      if (typeof j.scriptEndMs === "number") t.scriptEndMs = j.scriptEndMs;
      if (typeof j.afterNotifyMs === "number") t.afterNotifyMs = j.afterNotifyMs;
      timings.set(j.id, t);
    } else errors.push(`Ligne ${i + 1} : type inconnu`);
  });
  for (const [id, t] of timings) {
    const o = byId.get(id) ?? existing.get(id);
    if (!o) continue;
    const merged = { ...o, timing: { ...o.timing ?? {}, ...t } };
    byId.set(id, merged);
  }
  return { upserts: [...byId.values()], errors, skipped };
}
function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.ceil(p / 100 * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}
var nn = (x) => x === null || typeof x === "number" && Number.isFinite(x);
var str = (x, max = 300) => typeof x === "string" && x.length <= max;
var isoOk = (x) => typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x));
var PROVS = ["ocr", "gemini", "rule", "manual", "config", "none"];
var VERDICTS = ["favorable", "limite", "faible", "partiel", "indisponible"];
var SOURCES = ["shortcut", "native", "manual", "import", "server", "demo"];
function fieldOk(f, values) {
  if (!f || typeof f !== "object") return false;
  const o = f;
  if (!PROVS.includes(o.provenance)) return false;
  if (values ? !values.includes(o.value) : !nn(o.value)) return false;
  if (o.raw !== void 0 && !str(o.raw, 80)) return false;
  if (o.rule !== void 0 && !str(o.rule, 60)) return false;
  if (o.confidence !== void 0 && !["high", "medium", "low"].includes(o.confidence)) return false;
  return true;
}
function sanitizeAnalysis(x) {
  const a = x;
  if (!a || typeof a !== "object") return null;
  if (!str(a.id, 128) || !/^[A-Za-z0-9:_-]+$/.test(a.id)) return null;
  if (!isoOk(a.capturedAt) || !isoOk(a.analyzedAt) || !isoOk(a.validUntil)) return null;
  if (!SOURCES.includes(a.source)) return null;
  if (!str(a.engineVersion, 40) || !str(a.parserVersion, 40)) return null;
  if (a.configId !== null && !(str(a.configId, 40) && /^cfg-[0-9a-f]{8}$/.test(a.configId))) return null;
  const o = a.offer;
  if (!o || typeof o !== "object") return null;
  if (!fieldOk(o.platform, ["uber", "bolt", "unknown", null]) || !fieldOk(o.priceBasis, ["net_driver", "gross_before_commission", "unknown", null])) return null;
  for (const k of ["price", "approachKm", "approachMin", "tripKm", "tripMin", "expiresInSec"]) if (!fieldOk(o[k])) return null;
  if (!Array.isArray(o.warnings) || !o.warnings.every((w) => str(w, 200))) return null;
  if (!Array.isArray(o.extras) || !o.extras.every((e) => e && str(e.label, 60) && str(e.raw, 60) && typeof e.amount === "number")) return null;
  if (o.productLabel !== null && !str(o.productLabel, 40)) return null;
  const i = a.input;
  if (!i || !["net_driver", "gross_before_commission", "unknown"].includes(i.priceBasis)) return null;
  for (const k of ["price", "commissionRate", "approachKm", "approachMin", "tripKm", "tripMin", "variablePerKm", "fixedPerHour", "otherCosts"]) if (!nn(i[k])) return null;
  if (!i.scenario || !nn(i.scenario.returnKm) || !nn(i.scenario.returnMin) || !nn(i.scenario.waitMin)) return null;
  const f = a.finance;
  if (!f) return null;
  for (const k of ["P", "D", "T", "revenuePerKm", "revenuePerHour", "variableCost", "fixedAllocation", "margin", "marginPerKm", "marginPerHour"]) if (!nn(f[k])) return null;
  if (!Array.isArray(f.notes) || !f.notes.every((n) => str(n, 200)) || !Array.isArray(f.missing) || !f.missing.every((n) => str(n, 60))) return null;
  const v = a.verdict;
  if (!v || !VERDICTS.includes(v.verdict) || !["revenue", "margin"].includes(v.level) || !nn(v.perKm) || !nn(v.perHour) || !nn(v.ratioKm) || !nn(v.ratioHour)) return null;
  if (!Array.isArray(v.reasons) || !v.reasons.every((r) => str(r, 200))) return null;
  const t = a.thresholdValues;
  if (!t || !["revenue", "margin"].includes(t.level) || !(t.perKm > 0) || !(t.perHour > 0)) return null;
  const d = a.display;
  if (!d || !str(d.title, 200) || !str(d.body, 400) || !str(d.speech, 200)) return null;
  return a;
}

// src/core/aggregate.ts
function parisDate(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function periodKey(iso, kind) {
  const day = parisDate(iso);
  if (kind === "day") return day;
  if (kind === "month") return day.slice(0, 7);
  const [y, m, dd] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  const dow = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dow + 3);
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 864e5 + 1) / 7);
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}
function sessionMinutes(s, now = /* @__PURE__ */ new Date()) {
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : now.getTime();
  let ms = Math.max(0, end - start);
  for (const p of s.pauses) {
    const ps = new Date(p.start).getTime();
    const pe = p.end ? new Date(p.end).getTime() : end;
    ms -= Math.max(0, Math.min(pe, end) - Math.max(ps, start));
  }
  return Math.max(0, ms / 6e4);
}
var alive = (xs) => xs.filter((x) => !x.deleted);
function summarize(kind, data, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const map = /* @__PURE__ */ new Map();
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
        social: null
      };
      map.set(key, s);
    }
    return s;
  };
  const kmOdo = /* @__PURE__ */ new Map();
  const kmTr = /* @__PURE__ */ new Map();
  for (const t of alive(data.trips)) {
    if (t.status === "annulee") continue;
    const s = get(periodKey(t.date, kind));
    s.revenueRealized += t.revenue;
    if (t.status === "encaissee") s.revenueCashed += t.revenue;
    s.tripsCount += 1;
    const k = kmTr.get(s.key) ?? { sum: 0, complete: true };
    if (t.km === null) k.complete = false;
    else k.sum += t.km;
    kmTr.set(s.key, k);
  }
  for (const e of alive(data.expenses)) {
    const s = get(periodKey(e.date, kind));
    s.expenses += e.amount;
    s.expensesByCategory[e.category] = (s.expensesByCategory[e.category] ?? 0) + e.amount;
  }
  for (const se of alive(data.sessions)) {
    const s = get(periodKey(se.startedAt, kind));
    s.activityMinutes += sessionMinutes(se, now);
    if (!se.endedAt) s.openSessions += 1;
    const k = kmOdo.get(s.key) ?? { sum: 0, complete: true };
    if (se.odoStart === null || se.odoEnd === null || se.odoEnd < se.odoStart) k.complete = false;
    else k.sum += se.odoEnd - se.odoStart;
    kmOdo.set(s.key, k);
  }
  for (const o of alive(data.offers)) {
    const s = get(periodKey(o.capturedAt, kind));
    s.offers.analysed += 1;
    const v = (o.corrected ?? o.original).verdict.verdict;
    s.offers.byVerdict[v] = (s.offers.byVerdict[v] ?? 0) + 1;
    if (["acceptee", "realisee", "encaissee"].includes(o.status)) s.offers.accepted += 1;
    if (o.status === "refusee") s.offers.refused += 1;
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
    if (s.activityMinutes === 0) s.completeness.push("Aucune session : taux horaire indisponible");
    if (s.openSessions) s.completeness.push(`${s.openSessions} session(s) non cl\xF4tur\xE9e(s)`);
    if (!s.kmOdometer) s.completeness.push("Compteur kilom\xE9trique incomplet : \u20AC/km r\xE9el indisponible");
    const pending = alive(data.offers).filter(
      (o) => periodKey(o.capturedAt, kind) === s.key && o.status === "acceptee" && !o.tripId
    ).length;
    if (pending) s.completeness.push(`${pending} offre(s) accept\xE9e(s) sans course confirm\xE9e (non compt\xE9es)`);
    const soc = opts.social?.[s.key];
    if (soc && soc.base >= 0 && soc.rate >= 0 && soc.rate < 1) {
      const contribution = soc.base * soc.rate;
      s.social = { base: soc.base, rate: soc.rate, contribution, balance: s.result - contribution };
    }
  }
  return [...map.values()].sort((a, b) => a.key < b.key ? 1 : -1);
}

// src/core/backup.ts
var BACKUP_FORMAT = "vtcperso-backup";
var BACKUP_VERSION = 1;
function emptyDataset() {
  return Object.fromEntries(STORES.map((s) => [s, []]));
}
var cents = (x) => Math.round(x * 100);
function summarizeDataset(d) {
  const counts = Object.fromEntries(STORES.map((s) => [s, d[s].length]));
  const live = (xs) => xs.filter((x) => !x.deleted);
  return {
    counts,
    totals: {
      tripRevenue: live(d.trips).reduce((s, t) => s + cents(t.revenue), 0) / 100,
      expenses: live(d.expenses).reduce((s, e) => s + cents(e.amount), 0) / 100,
      offerPrices: live(d.offers).reduce((s, o) => s + cents(o.original.offer.price.value ?? 0), 0) / 100
    },
    relations: {
      tripsWithOffer: d.trips.filter((t) => t.offerId).length,
      offersWithTrip: d.offers.filter((o) => o.tripId).length,
      offersWithSession: d.offers.filter((o) => o.sessionId).length
    }
  };
}
function makeBackup(d, now = (/* @__PURE__ */ new Date()).toISOString()) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, app: "VTC Perso", data: d, summary: summarizeDataset(d) };
}
function parseBackup(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return { ok: false, error: "Fichier JSON illisible" };
  }
  if (b?.format !== BACKUP_FORMAT) return { ok: false, error: "Ce fichier n\u2019est pas une sauvegarde VTC Perso" };
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) return { ok: false, error: `Version ${b.version} non prise en charge` };
  for (const s of STORES) if (!Array.isArray(b.data?.[s])) return { ok: false, error: `Section ${s} manquante` };
  for (const s of STORES) for (const r of b.data[s]) if (typeof r.id !== "string") return { ok: false, error: `Identifiant manquant dans ${s}` };
  const check = summarizeDataset(b.data);
  if (JSON.stringify(check) !== JSON.stringify(b.summary)) return { ok: false, error: "R\xE9sum\xE9 incoh\xE9rent : fichier modifi\xE9 ou incomplet" };
  return { ok: true, backup: b };
}
function verifyRestore(expected, actual, exact = true) {
  const a = summarizeDataset(actual);
  const errs = [];
  for (const s of STORES) {
    if (exact ? a.counts[s] !== expected.counts[s] : a.counts[s] < expected.counts[s]) errs.push(`${s} : ${a.counts[s]} lignes au lieu de ${expected.counts[s]}`);
  }
  if (exact) {
    if (a.totals.tripRevenue !== expected.totals.tripRevenue) errs.push("Total des recettes diff\xE9rent");
    if (a.totals.expenses !== expected.totals.expenses) errs.push("Total des d\xE9penses diff\xE9rent");
    if (a.totals.offerPrices !== expected.totals.offerPrices) errs.push("Total des prix d\u2019offres diff\xE9rent");
    for (const k of ["tripsWithOffer", "offersWithTrip", "offersWithSession"]) if (a.relations[k] !== expected.relations[k]) errs.push(`Relations ${k} diff\xE9rentes`);
  }
  return errs;
}
function csvSafe(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function csvCell(v) {
  if (v === null || v === void 0) return "";
  const s = typeof v === "number" ? String(v).replace(".", ",") : csvSafe(String(v));
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, columns) {
  const head = columns.join(";");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(";"));
  return "\uFEFF" + [head, ...body].join("\n");
}
function offersCsv(d) {
  const rows = d.offers.filter((o) => !o.deleted).map((o) => {
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
      corrigee: o.corrected ? "oui" : "non"
    };
  });
  return toCsv(rows, Object.keys(rows[0] ?? { id: 1 }));
}
function tripsCsv(d) {
  const rows = d.trips.filter((t) => !t.deleted).map((t) => ({ id: t.id, date: t.date, plateforme: t.platform, statut: t.status, recette: t.revenue, km: t.km, minutes: t.minutes, offre: t.offerId }));
  return toCsv(rows, ["id", "date", "plateforme", "statut", "recette", "km", "minutes", "offre"]);
}
function expensesCsv(d) {
  const rows = d.expenses.filter((e) => !e.deleted).map((e) => ({ id: e.id, date: e.date, categorie: e.category, montant: e.amount, note: e.note, source: e.source }));
  return toCsv(rows, ["id", "date", "categorie", "montant", "note", "source"]);
}

// src/core/sync.ts
function newer(a, b) {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  if (!!a.deleted !== !!b.deleted) return !!a.deleted;
  return JSON.stringify(a) > JSON.stringify(b);
}
async function syncOnce(local, remote, batch = 200) {
  const rep = { pushed: 0, pulled: 0, appliedRemote: 0, keptLocal: 0, error: null };
  try {
    const items = await local.outbox();
    for (let i = 0; i < items.length; i += batch) {
      const chunk = items.slice(i, i + batch);
      const rows = [];
      for (const it of chunk) {
        const rec = await local.get(it.store, it.id);
        if (rec) rows.push({ store: it.store, record: rec });
      }
      const acks = await remote.push(rows);
      const ackSet = new Set(acks.map((a) => `${a.store}/${a.id}/${a.updatedAt}`));
      for (const it of chunk) {
        const rec = await local.get(it.store, it.id);
        if (rec && ackSet.has(`${it.store}/${it.id}/${rec.updatedAt}`)) {
          await local.removeOutbox(it);
          rep.pushed++;
        } else if (!rec) await local.removeOutbox(it);
      }
    }
    let cursor = await local.getCursor();
    for (; ; ) {
      const rows = await remote.pull(cursor, batch);
      if (!rows.length) break;
      let maxSeq = cursor;
      for (const r of rows) {
        rep.pulled++;
        const cur = await local.get(r.store, r.record.id);
        const tie = !!cur && cur.updatedAt === r.record.updatedAt && !!cur.deleted === !!r.record.deleted;
        if (tie || newer(r.record, cur)) {
          await local.put(r.store, r.record);
          rep.appliedRemote++;
        } else rep.keptLocal++;
        maxSeq = Math.max(maxSeq, r.serverSeq);
      }
      await local.setCursor(maxSeq);
      cursor = maxSeq;
      if (rows.length < batch) break;
    }
  } catch (e) {
    rep.error = e instanceof Error ? e.message : String(e);
  }
  return rep;
}
export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  ENGINE_VERSION,
  LIMIT_FACTOR,
  OFFER_STATUS_LABEL,
  PARSER_VERSION,
  STORES,
  VERDICT_LABEL,
  VERDICT_SYMBOL,
  analyzeParsed,
  analyzeText,
  applyCorrection,
  applySessionPlatform,
  buildDisplay,
  buildFastConfig,
  buildFinanceInput,
  canTransition,
  canonical,
  computeFinance,
  computeVerdict,
  defaultSettings,
  demoConfig,
  deriveCosts,
  detectPlatform,
  driverRevenue,
  emptyDataset,
  expensesCsv,
  fmtEur,
  fmtNum,
  fnv1a,
  fold,
  importJournal,
  isFresh,
  makeBackup,
  newId,
  newer,
  normalizeText,
  offerFromAnalysis,
  offersCsv,
  parisDate,
  parseBackup,
  parseDecimal,
  parseOffer,
  percentile,
  periodKey,
  round,
  sanitizeAnalysis,
  sessionMinutes,
  setStatus,
  shouldDisplay,
  summarize,
  summarizeDataset,
  syncOnce,
  toCsv,
  tripsCsv,
  validateFastConfig,
  verifyRestore
};

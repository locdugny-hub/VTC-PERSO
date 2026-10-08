// Onglet Historique : filtres, détail des hypothèses et provenances, statuts, corrections.
import { setStatus, applyCorrection, canTransition } from '../../core/history';
import { OFFER_STATUS_LABEL } from '../../core/domain';
import { VERDICT_LABEL } from '../../core/verdict';
import { ENGINE_VERSION } from '../../core/types';
import type { Field } from '../../core/types';
import type { OfferRec, OfferStatus, TripRec, Correction } from '../../core/domain';
import { state } from '../state';
import { esc, eur, num, dt, toast, parseInput, inputVal, VERDICT_CLASS } from '../ui';
import { offerLine, resultCard } from './session';
import { invokeAi, cloudConfigured } from '../cloud';

const PROV: Record<string, string> = { ocr: 'OCR', gemini: 'Gemini', rule: 'Règle', manual: 'Correction manuelle', config: 'Réglage', none: '—' };

let filters = { period: '7', platform: 'all', status: 'all' };

export async function renderHistory(root: HTMLElement) {
  const all = (await state.db.all('offers')).sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  const since = filters.period === 'all' ? 0 : Date.now() - Number(filters.period) * 86400000;
  const list = all.filter(
    (o) =>
      new Date(o.capturedAt).getTime() >= since &&
      (filters.platform === 'all' || o.platform === filters.platform) &&
      (filters.status === 'all' || o.status === filters.status),
  );
  root.innerHTML = `
  <section class="card">
    <h2>Historique des offres</h2>
    <div class="filters">
      <label>Période <select data-f="period"><option value="1">Aujourd'hui</option><option value="7">7 jours</option><option value="30">30 jours</option><option value="all">Tout</option></select></label>
      <label>Plateforme <select data-f="platform"><option value="all">Toutes</option><option value="uber">Uber</option><option value="bolt">Bolt</option><option value="unknown">Inconnue</option></select></label>
      <label>Statut <select data-f="status"><option value="all">Tous</option>${Object.entries(OFFER_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    </div>
    <p class="muted small">${list.length} offre(s). Une offre analysée ou acceptée n'est jamais comptée comme recette : seule une course confirmée l'est.</p>
    ${list.length ? `<ul class="list">${list.map(offerLine).join('')}</ul>` : '<p class="muted">Aucune offre pour ces filtres.</p>'}
  </section>`;
  for (const [k, v] of Object.entries(filters)) (root.querySelector(`[data-f="${k}"]`) as HTMLSelectElement).value = v;
  root.onchange = (e) => {
    const s = e.target as HTMLSelectElement;
    if (s.dataset.f) {
      filters = { ...filters, [s.dataset.f]: s.value };
      renderHistory(root);
    }
  };
}

function fieldRow(label: string, f: Field<unknown>, unit = '') {
  return `<tr><th scope="row">${esc(label)}</th><td>${f.value === null ? '<em>inconnu</em>' : esc(typeof f.value === 'number' ? num(f.value as number, 2) + unit : String(f.value))}</td><td class="muted small">${esc(PROV[f.provenance] ?? f.provenance)}${f.rule ? ' · ' + esc(f.rule) : ''}${f.confidence ? ' · ' + esc(f.confidence) : ''}</td></tr>`;
}

export async function renderOffer(root: HTMLElement, id: string) {
  if (location.hash !== '#/offre/' + encodeURIComponent(id)) return;
  const o = (await state.db.get('offers', id)) as OfferRec | undefined;
  if (!o || o.deleted) {
    root.innerHTML = '<section class="card"><p>Offre introuvable.</p><a href="#/historique">Retour</a></section>';
    return;
  }
  const a = o.corrected ?? o.original;
  const trip = o.tripId ? ((await state.db.get('trips', o.tripId)) as TripRec | undefined) : undefined;
  const nexts = (Object.keys(OFFER_STATUS_LABEL) as OfferStatus[]).filter((s) => canTransition(o.status, s));
  const inp = a.input;
  root.innerHTML = `
  <section class="card">
    <a href="#/historique" class="back">← Historique</a>
    <h2>Offre ${esc(o.platform === 'unknown' ? '' : o.platform.toUpperCase())} du ${dt(o.capturedAt, true)}</h2>
    <p>Statut : <strong>${esc(OFFER_STATUS_LABEL[o.status])}</strong>${trip ? ` · course ${esc({ realisee: 'réalisée', encaissee: 'encaissée', annulee: 'annulée' }[trip.status])} : ${eur(trip.revenue)}` : ''}</p>
    <div class="row">${nexts.map((s) => `<button class="btn ${s === 'refusee' || s === 'annulee' ? 'secondary' : ''}" data-status="${s}">${esc(OFFER_STATUS_LABEL[s])}</button>`).join('')}</div>
    ${resultCard(a)}
    ${o.corrected ? `<p class="muted small">Analyse corrigée. Verdict d'origine : ${esc(VERDICT_LABEL[o.original.verdict.verdict])}.</p>` : ''}
  </section>
  <section class="card">
    <h3>Champs lus et provenance</h3>
    <table class="tbl"><tbody>
      ${fieldRow('Plateforme', a.offer.platform)}
      ${fieldRow('Prix', a.offer.price, ' €')}
      ${fieldRow('Base du prix (lue)', a.offer.priceBasis)}
      ${fieldRow('Approche distance', a.offer.approachKm, ' km')}
      ${fieldRow('Approche durée', a.offer.approachMin, ' min')}
      ${fieldRow('Trajet distance', a.offer.tripKm, ' km')}
      ${fieldRow('Trajet durée', a.offer.tripMin, ' min')}
      ${fieldRow('Échéance affichée', a.offer.expiresInSec, ' s')}
    </tbody></table>
    ${a.offer.extras.length ? `<p class="small">Montants annexes lus (non ajoutés) : ${a.offer.extras.map((x) => esc(x.raw)).join(', ')}</p>` : ''}
    ${a.offer.warnings.length ? `<ul class="small warn">${a.offer.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
  </section>
  <section class="card">
    <h3>Hypothèses et formules</h3>
    <ul class="small">
      <li>Base retenue : ${esc(inp.priceBasis)}${inp.priceBasis === 'gross_before_commission' ? ` · commission ${inp.commissionRate === null ? 'non confirmée' : num(inp.commissionRate * 100, 1) + ' %'}` : ''}</li>
      <li>v = ${inp.variablePerKm === null ? 'non renseigné' : num(inp.variablePerKm, 3) + ' €/km'} · f = ${inp.fixedPerHour === null ? 'non renseigné' : num(inp.fixedPerHour) + ' €/h'} · E = ${inp.otherCosts === null ? 'non renseigné' : eur(inp.otherCosts)}</li>
      <li>Retour simulé : ${inp.scenario.returnKm ? `${num(inp.scenario.returnKm, 1)} km / ${num(inp.scenario.returnMin, 0)} min` : 'non'} · attente incluse : ${inp.scenario.waitMin ? num(inp.scenario.waitMin, 0) + ' min' : 'non'}</li>
      <li>Seuils (${a.thresholdValues.level === 'margin' ? 'marge' : 'recette'}) : ${num(a.thresholdValues.perKm)} €/km et ${num(a.thresholdValues.perHour)} €/h</li>
      <li>Recette/km = P / D ; Recette/h = 60 × P / T ; Marge = P − v × D − f × T / 60 − E</li>
      <li>Coût variable ${eur(a.finance.variableCost)} · allocation fixe ${eur(a.finance.fixedAllocation)}</li>
      <li class="muted">Versions : ${esc(a.engineVersion)} / ${esc(a.parserVersion)} · configuration ${esc(a.configId ?? '—')} · source ${esc(a.source)}${a.engineVersion !== ENGINE_VERSION ? ' · moteur différent de la version actuelle' : ''}</li>
      ${a.finance.notes.map((n) => `<li>${esc(n)}</li>`).join('')}
      ${o.timing ? `<li class="muted">Mesures du raccourci : fin du script à ${esc(o.timing.scriptEndMs ?? '—')} ms, après notification ${esc(o.timing.afterNotifyMs ?? '—')} ms (depuis le début du raccourci)</li>` : ''}
    </ul>
  </section>
  <section class="card">
    <h3>Corriger après coup</h3>
    <p class="muted small">L'analyse d'origine est conservée. Le recalcul utilise les mêmes hypothèses que l'origine.</p>
    <form id="corr" class="grid2">
      <label>Prix (€) <input name="price" inputmode="decimal" value="${inputVal(inp.price)}"></label>
      <label>Base <select name="priceBasis"><option value="net_driver">Net chauffeur</option><option value="gross_before_commission">Avant commission</option><option value="unknown">Inconnue</option></select></label>
      <label>Commission confirmée (%) <small>si avant commission</small><input name="commissionPct" inputmode="decimal" value="${inp.commissionRate === null ? '' : inputVal(Math.round(inp.commissionRate * 10000) / 100)}"></label>
      <label>Approche km <input name="approachKm" inputmode="decimal" value="${inputVal(inp.approachKm)}"></label>
      <label>Approche min <input name="approachMin" inputmode="decimal" value="${inputVal(inp.approachMin)}"></label>
      <label>Trajet km <input name="tripKm" inputmode="decimal" value="${inputVal(inp.tripKm)}"></label>
      <label>Trajet min <input name="tripMin" inputmode="decimal" value="${inputVal(inp.tripMin)}"></label>
      <label>Plateforme <select name="platform"><option value="uber">Uber</option><option value="bolt">Bolt</option><option value="unknown">Inconnue</option></select></label>
      <div class="row"><button class="btn" type="submit">Recalculer</button></div>
    </form>
    ${o.corrections.length ? `<details><summary>${o.corrections.length} correction(s)</summary><ul class="small">${o.corrections.map((c) => `<li>${dt(c.at, true)} · ${esc(c.field)} : ${esc(JSON.stringify(c.before))} → ${esc(JSON.stringify(c.after))}</li>`).join('')}</ul></details>` : ''}
  </section>
  ${cloudConfigured() && state.settings.aiEnabled ? `<section class="card"><h3>Explication (IA)</h3><p class="muted small">Envoie à Gemini les valeurs déjà calculées ci-dessus (pas d'image, pas d'adresse). Gemini ne recalcule rien.</p><button class="btn secondary" data-act="explain">Expliquer ce résultat</button><div id="aiOut"></div></section>` : ''}
  <section class="card"><button class="btn danger" data-act="delete">Supprimer cette offre</button></section>`;
  (root.querySelector('[name=priceBasis]') as HTMLSelectElement).value = inp.priceBasis;
  (root.querySelector('[name=platform]') as HTMLSelectElement).value = o.platform;

  root.onclick = async (e) => {
    const t = e.target as HTMLElement;
    const st = t.dataset.status as OfferStatus | undefined;
    if (st) {
      try {
        let confirmedRevenue: number | undefined;
        if ((st === 'realisee' || st === 'encaissee') && !trip) {
          const ans = prompt('Montant réellement perçu pour cette course (€, net chauffeur) :', a.finance.P !== null && !a.finance.pIsUpperBound ? String(a.finance.P.toFixed(2)).replace('.', ',') : '');
          if (ans === null) return;
          const v = parseInput(ans);
          if (v === null || Number.isNaN(v) || v < 0) return toast('Montant invalide', 'err');
          confirmedRevenue = v;
        }
        const r = setStatus(o, st, { confirmedRevenue, trip: trip ?? null });
        if (r.trip) await state.db.save('trips', r.trip);
        await state.db.save('offers', r.offer);
        toast('Statut : ' + OFFER_STATUS_LABEL[st], 'ok');
        renderOffer(root, id);
      } catch (err) {
        toast(String((err as Error).message), 'err');
      }
    }
    if (t.dataset.act === 'delete' && confirm('Supprimer cette offre de l’historique ?')) {
      await state.db.remove('offers', id);
      location.hash = '#/historique';
    }
    if (t.dataset.act === 'explain') {
      const out = root.querySelector('#aiOut') as HTMLElement;
      out.textContent = 'Envoi…';
      const data = { verdict: a.verdict, finance: a.finance, input: { ...a.input }, thresholds: a.thresholdValues, missing: a.finance.missing };
      const r = await invokeAi({ action: 'explain', data });
      out.innerHTML = r.ok ? `<p>${esc(String(r.data.text))}</p><p class="muted small">Généré par ${esc(String(r.data.model))} à partir des valeurs calculées localement. À vérifier.</p>` : `<p class="warn">${esc(String(r.data.error))}</p>`;
    }
  };
  (root.querySelector('#corr') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    let cur = o;
    const numeric: Correction['field'][] = ['price', 'approachKm', 'approachMin', 'tripKm', 'tripMin'];
    for (const f of numeric) {
      const v = parseInput(String(fd.get(f)));
      if (v !== null && (Number.isNaN(v) || v < 0)) return toast(`Valeur invalide : ${f}`, 'err');
      const before = (cur.corrected ?? cur.original).input[f as keyof typeof inp];
      if (v !== before) cur = applyCorrection(cur, f, v);
    }
    const pct = parseInput(String(fd.get('commissionPct')));
    if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct >= 100)) return toast('Commission invalide', 'err');
    const rate = pct === null ? null : pct / 100;
    if (rate !== (cur.corrected ?? cur.original).input.commissionRate) cur = applyCorrection(cur, 'commissionRate', rate);
    const basis = String(fd.get('priceBasis'));
    if (basis !== (cur.corrected ?? cur.original).input.priceBasis) cur = applyCorrection(cur, 'priceBasis', basis);
    const plat = String(fd.get('platform'));
    if (plat !== cur.platform) cur = applyCorrection(cur, 'platform', plat);
    if (cur === o) return toast('Aucune modification');
    await state.db.save('offers', cur);
    toast('Analyse recalculée', 'ok');
    renderOffer(root, id);
  };
}

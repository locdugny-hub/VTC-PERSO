// Onglet Bilan : recettes confirmées, dépenses réelles, temps d'activité, ratios sur totaux.
import { summarize, parisDate } from '../../core/aggregate';
import type { PeriodKind } from '../../core/aggregate';
import { newId } from '../../core/analyze';
import type { ExpenseCategory, ExpenseRec, TripRec } from '../../core/domain';
import { state } from '../state';
import { esc, eur, num, dur, dt, toast, parseInput, readFileBase64 } from '../ui';
import { invokeAi, cloudConfigured } from '../cloud';

const CATS: ExpenseCategory[] = ['carburant', 'recharge', 'peage', 'parking', 'entretien', 'assurance', 'location', 'lavage', 'telephone', 'autre'];
let kind: PeriodKind = 'week';
const social: Record<string, { base: number; rate: number }> = {};

export async function renderBilan(root: HTMLElement) {
  const data = { trips: await state.db.all('trips'), expenses: await state.db.all('expenses'), sessions: await state.db.all('sessions'), offers: await state.db.all('offers') };
  const sums = summarize(kind, data, { social });
  const today = parisDate(new Date().toISOString()); // date civile de Paris (pas UTC)
  const recentExp = [...data.expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);
  const recentTrips = [...data.trips].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);
  const ai = cloudConfigured() && state.settings.aiEnabled;
  root.innerHTML = `
  <section class="card">
    <h2>Bilan réel</h2>
    <div class="seg" role="radiogroup" aria-label="Période">
      ${(['day', 'week', 'month'] as PeriodKind[]).map((k) => `<button role="radio" aria-checked="${k === kind}" class="seg-btn ${k === kind ? 'on' : ''}" data-kind="${k}">${{ day: 'Jour', week: 'Semaine', month: 'Mois' }[k]}</button>`).join('')}
    </div>
    <p class="muted small">Résultat d'exploitation = recettes de courses confirmées − dépenses réelles de la période (chaque dépense une seule fois). Les allocations estimées utilisées pour juger les offres ne sont pas déduites ici. Ce n'est pas un revenu net définitif (impôt, CFE, TVA… non inclus).</p>
    ${sums.length ? sums.map((s) => `
      <article class="period">
        <h3>${esc(s.key)}</h3>
        <dl class="kv">
          <dt>Recettes réalisées</dt><dd>${eur(s.revenueRealized)} <small>(${s.tripsCount} course(s), dont encaissé ${eur(s.revenueCashed)})</small></dd>
          <dt>Dépenses réelles</dt><dd>${eur(s.expenses)}</dd>
          <dt>Résultat d'exploitation</dt><dd><strong>${eur(s.result)}</strong></dd>
          <dt>Temps d'activité</dt><dd>${dur(s.activityMinutes)}</dd>
          <dt>Résultat / heure</dt><dd>${s.resultPerHour === null ? '—' : num(s.resultPerHour) + ' €/h'}</dd>
          <dt>Résultat / km (compteur)</dt><dd>${s.resultPerKm === null ? '—' : num(s.resultPerKm) + ' €/km'}</dd>
          <dt>Offres analysées</dt><dd>${s.offers.analysed} · acceptées ${s.offers.accepted} · refusées ${s.offers.refused}</dd>
          ${s.social ? `<dt>Solde après cotisations modélisées</dt><dd>${eur(s.social.balance)} <small>(base ${eur(s.social.base)} × ${num(s.social.rate * 100, 1)} % = ${eur(s.social.contribution)} ; hors autres charges)</small></dd>` : ''}
        </dl>
        ${s.completeness.length ? `<ul class="small warn">${s.completeness.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        <details><summary>Modéliser des cotisations pour ${esc(s.key)}</summary>
          <p class="muted small">Saisissez une base déclarable que vous connaissez (chiffre d'affaires de la période) et le taux qui vous concerne. Rien n'est déduit automatiquement ni reconstruit depuis les captures.</p>
          <div class="row"><label class="inline">Base (€) <input class="small" inputmode="decimal" data-sbase="${esc(s.key)}"></label>
          <label class="inline">Taux (%) <input class="small" inputmode="decimal" data-srate="${esc(s.key)}"></label>
          <button class="btn secondary" data-social="${esc(s.key)}">Appliquer</button></div>
        </details>
      </article>`).join('') : '<p class="muted">Aucune donnée. Ajoutez des sessions, courses confirmées et dépenses.</p>'}
    ${ai && sums.length ? `<button class="btn secondary" data-act="ai-summary">Résumer avec l'IA</button><div id="aiSum"></div>` : ''}
  </section>

  <section class="card">
    <h2>Ajouter une dépense</h2>
    <form id="exp" class="grid2">
      <label>Date <input type="date" name="date" value="${today}" required></label>
      <label>Catégorie <select name="category">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label>Montant TTC (€) <input name="amount" inputmode="decimal" required></label>
      <label>Note <input name="note" maxlength="80"></label>
      <div class="row"><button class="btn" type="submit">Enregistrer</button></div>
    </form>
    ${ai ? `<details><summary>Lire un justificatif avec l'IA</summary>
      <p class="muted small">La photo du justificatif est envoyée à Gemini via votre fonction serveur, puis les champs lus remplissent le formulaire. Vous vérifiez avant d'enregistrer. Recadrez pour masquer les informations inutiles.</p>
      <input type="file" accept="image/png,image/jpeg,image/webp" id="receipt"> <button class="btn secondary" data-act="receipt">Lire</button><div id="rcptOut" class="small"></div></details>` : ''}
  </section>

  <section class="card">
    <h2>Dernières dépenses</h2>
    ${recentExp.length ? `<ul class="list">${recentExp.map((e) => `<li class="line"><span>${dt(e.date)} · ${esc(e.category)}${e.note ? ' · ' + esc(e.note) : ''}</span><span class="right">${eur(e.amount)}</span><button class="btn tiny danger" data-del-exp="${esc(e.id)}" aria-label="Supprimer la dépense">Supprimer</button></li>`).join('')}</ul>` : '<p class="muted">Aucune dépense.</p>'}
  </section>

  <section class="card">
    <h2>Dernières courses confirmées</h2>
    ${recentTrips.length ? `<ul class="list">${recentTrips.map((t) => `<li class="line"><span>${dt(t.date)} · ${esc(t.platform)} · ${esc({ realisee: 'réalisée', encaissee: 'encaissée', annulee: 'annulée' }[t.status])}</span><span class="right">${eur(t.revenue)}</span><button class="btn tiny secondary" data-edit-trip="${esc(t.id)}">Montant</button><button class="btn tiny danger" data-del-trip="${esc(t.id)}" aria-label="Supprimer la course">Supprimer</button></li>`).join('')}</ul>` : '<p class="muted">Aucune course confirmée.</p>'}
  </section>

  <section class="card">
    <h2>Ajouter une course confirmée sans offre</h2>
    <form id="trip" class="grid2">
      <label>Date <input type="date" name="date" value="${today}" required></label>
      <label>Plateforme <select name="platform"><option value="uber">Uber</option><option value="bolt">Bolt</option><option value="unknown">Autre</option></select></label>
      <label>Recette perçue (€) <input name="revenue" inputmode="decimal" required></label>
      <label>Statut <select name="status"><option value="realisee">Réalisée</option><option value="encaissee">Encaissée</option></select></label>
      <div class="row"><button class="btn" type="submit">Enregistrer</button></div>
    </form>
  </section>`;

  root.onclick = async (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.kind) {
      kind = t.dataset.kind as PeriodKind;
      renderBilan(root);
    }
    if (t.dataset.delExp && confirm('Supprimer cette dépense ?')) {
      await state.db.remove('expenses', t.dataset.delExp);
      toast('Dépense supprimée', 'ok');
      return renderBilan(root);
    }
    if (t.dataset.delTrip && confirm('Supprimer cette course ? Sa recette ne sera plus comptée.')) {
      const trip = data.trips.find((x) => x.id === t.dataset.delTrip);
      await state.db.remove('trips', t.dataset.delTrip);
      if (trip?.offerId) {
        const o = await state.db.get('offers', trip.offerId);
        if (o) await state.db.save('offers', { ...(o as never as import('../../core/domain').OfferRec), tripId: null });
      }
      toast('Course supprimée', 'ok');
      return renderBilan(root);
    }
    if (t.dataset.editTrip) {
      const trip = data.trips.find((x) => x.id === t.dataset.editTrip);
      if (!trip) return;
      const ans = prompt('Montant réellement perçu (€) :', String(trip.revenue).replace('.', ','));
      if (ans === null) return;
      const v = parseInput(ans);
      if (v === null || Number.isNaN(v) || v < 0) return toast('Montant invalide', 'err');
      await state.db.save('trips', { ...trip, revenue: v });
      toast('Montant corrigé', 'ok');
      return renderBilan(root);
    }
    if (t.dataset.social) {
      const k = t.dataset.social;
      const b = parseInput((root.querySelector(`[data-sbase="${CSS.escape(k)}"]`) as HTMLInputElement).value);
      const r = parseInput((root.querySelector(`[data-srate="${CSS.escape(k)}"]`) as HTMLInputElement).value);
      if (b === null || r === null || Number.isNaN(b) || Number.isNaN(r) || b < 0 || r < 0 || r >= 100) return toast('Base ou taux invalide', 'err');
      social[k] = { base: b, rate: r / 100 };
      renderBilan(root);
    }
    if (t.dataset.act === 'ai-summary') {
      const out = root.querySelector('#aiSum') as HTMLElement;
      const payload = sums.slice(0, 8).map((s) => ({ periode: s.key, recettes: s.revenueRealized, depenses: s.expenses, resultat: s.result, heures: Math.round(s.activityMinutes / 6) / 10, courses: s.tripsCount, offres: s.offers }));
      out.textContent = `Envoi de ${payload.length} période(s) agrégée(s) (aucune adresse, aucune capture)…`;
      const r = await invokeAi({ action: 'summarize', data: payload });
      out.innerHTML = r.ok ? `<p style="white-space:pre-wrap">${esc(String(r.data.text))}</p><p class="muted small">Données utilisées : ${payload.length} période(s), ${payload.reduce((s, p) => s + p.courses, 0)} course(s). Texte généré, à vérifier. Aucune prévision de marché.</p>` : `<p class="warn">${esc(String(r.data.error))}</p>`;
    }
    if (t.dataset.act === 'receipt') {
      const out = root.querySelector('#rcptOut') as HTMLElement;
      const f = await readFileBase64(root.querySelector('#receipt') as HTMLInputElement);
      if (!f) return toast('Choisissez une image', 'err');
      out.textContent = 'Lecture…';
      const r = await invokeAi({ action: 'extract_receipt', imageBase64: f.b64, mime: f.mime });
      if (!r.ok) return (out.innerHTML = `<span class="warn">${esc(String(r.data.error))}</span>`);
      const fl = (r.data.fields ?? {}) as Record<string, unknown>;
      const form = root.querySelector('#exp') as HTMLFormElement;
      if (typeof fl.date === 'string') (form.elements.namedItem('date') as HTMLInputElement).value = fl.date;
      if (typeof fl.category === 'string') (form.elements.namedItem('category') as HTMLSelectElement).value = fl.category;
      if (typeof fl.amountTTC === 'number') (form.elements.namedItem('amount') as HTMLInputElement).value = String(fl.amountTTC).replace('.', ',');
      (form.elements.namedItem('note') as HTMLInputElement).value = typeof fl.vendor === 'string' ? fl.vendor : '';
      form.dataset.source = 'gemini_receipt';
      out.innerHTML = `Champs pré-remplis par Gemini : <strong>vérifiez-les</strong> puis enregistrez.${(r.data.warnings as string[] | undefined)?.length ? ' ' + esc((r.data.warnings as string[]).join(' ; ')) : ''}`;
    }
  };
  (root.querySelector('#exp') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    const amount = parseInput(String(fd.get('amount')));
    if (amount === null || Number.isNaN(amount) || amount <= 0) return toast('Montant invalide', 'err');
    const rec: ExpenseRec = {
      id: newId(),
      updatedAt: '',
      date: new Date(String(fd.get('date')) + 'T12:00:00').toISOString(),
      category: String(fd.get('category')) as ExpenseCategory,
      amount,
      currency: 'EUR',
      vehicleId: state.settings.activeVehicleId,
      note: String(fd.get('note') ?? ''),
      source: form.dataset.source === 'gemini_receipt' ? 'gemini_receipt' : 'manual',
    };
    await state.db.save('expenses', rec);
    toast('Dépense enregistrée', 'ok');
    renderBilan(root);
  };
  (root.querySelector('#trip') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const revenue = parseInput(String(fd.get('revenue')));
    if (revenue === null || Number.isNaN(revenue) || revenue < 0) return toast('Montant invalide', 'err');
    const st = String(fd.get('status')) as TripRec['status'];
    const rec: TripRec = { id: newId(), updatedAt: '', offerId: null, sessionId: null, date: new Date(String(fd.get('date')) + 'T12:00:00').toISOString(), platform: String(fd.get('platform')) as TripRec['platform'], revenue, km: null, minutes: null, status: st, paidAt: st === 'encaissee' ? new Date().toISOString() : null, note: '' };
    await state.db.save('trips', rec);
    toast('Course enregistrée', 'ok');
    renderBilan(root);
  };
}

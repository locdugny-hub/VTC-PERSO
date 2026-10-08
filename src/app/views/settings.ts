// Onglet Réglages : coûts, seuils, plateformes, parcours rapide, raccourci, mesures, compte, IA, données.
import { deriveCosts } from '../../core/domain';
import type { Vehicle } from '../../core/domain';
import { importJournal, percentile } from '../../core/history';
import { makeBackup, parseBackup, verifyRestore, offersCsv, tripsCsv, expensesCsv } from '../../core/backup';
import { syncOnce } from '../../core/sync';
import { STORES } from '../../core/domain';
import { state, saveSettings, saveVehicleAndCosts, saveThresholds, activeVehicle, activeCost, activeThreshold, currentFastConfig, openScope, rememberScope } from '../state';
import { esc, eur, num, toast, copy, download, parseInput, inputVal, readFile, dt } from '../ui';
import { cloudConfigured, currentUser, signInGoogle, signOut, remoteAdapter, publishConfig, createDeviceToken, listDeviceTokens, revokeDeviceToken, aiUsageToday, functionsBase } from '../cloud';
import { migrateScope, LocalDB } from '../db';
import { seedDemo } from '../demo';

const SECTIONS: [string, string][] = [
  ['couts', 'Véhicule et coûts'],
  ['seuils', 'Seuils du verdict'],
  ['plateformes', 'Base des prix Uber / Bolt'],
  ['parcours', 'Parcours rapide'],
  ['raccourci', 'Raccourci iPhone'],
  ['mesures', 'Mesures du temps de réponse'],
  ['compte', 'Compte et synchronisation'],
  ['ia', 'Fonctions IA (Gemini)'],
  ['donnees', 'Données, export, import'],
  ['apropos', 'À propos'],
];

const n = (fd: FormData, k: string) => parseInput(String(fd.get(k) ?? ''));
const bad = (x: number | null) => x !== null && (Number.isNaN(x) || x < 0);

export async function renderSettings(root: HTMLElement, section?: string) {
  // Garde : un rendu asynchrone tardif ne doit pas écraser une autre page affichée entre-temps.
  const expected = section ? `#/reglages/${section}` : '#/reglages';
  if (location.hash !== expected && !(section === undefined && location.hash === '#/reglages/')) return;
  if (!section) {
    root.innerHTML = `<section class="card"><h2>Réglages</h2><ul class="list">${SECTIONS.map(([k, l]) => `<li><a class="line" href="#/reglages/${k}"><span>${esc(l)}</span><span class="right" aria-hidden="true">›</span></a></li>`).join('')}</ul>
    ${state.scope === 'demo' ? '<p class="warn">Mode démonstration : données fictives séparées de vos données.</p>' : ''}</section>`;
    root.onclick = null;
    root.onsubmit = null;
    return;
  }
  const title = SECTIONS.find(([k]) => k === section)?.[1] ?? 'Réglages';
  const body = await sectionHtml(section);
  root.innerHTML = `<section class="card"><a href="#/reglages" class="back">← Réglages</a><h2>${esc(title)}</h2>${body}</section>`;
  bind(root, section);
}

async function sectionHtml(sec: string): Promise<string> {
  const s = state.settings;
  if (sec === 'couts') {
    const v = await activeVehicle();
    const c = await activeCost();
    return `<p class="muted small">Un champ vide signifie « non renseigné » (différent de 0). Chaque enregistrement crée une nouvelle version : les analyses passées gardent leurs hypothèses.</p>
    <form id="f" class="grid2">
      <label>Nom du véhicule <input name="name" value="${esc(v?.name ?? '')}" maxlength="40"></label>
      <label>Énergie <select name="energy">${['diesel', 'essence', 'hybride', 'electrique', 'gpl', 'autre'].map((e) => `<option ${v?.energy === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <label>Consommation (L ou kWh /100 km) <input name="cons" inputmode="decimal" value="${inputVal(v?.consumptionPer100)}"></label>
      <label>Prix de l'énergie (€/L ou €/kWh) <input name="price" inputmode="decimal" value="${inputVal(v?.energyUnitPrice)}"></label>
      <label>Entretien + pneus + usure (€/km) <input name="maint" inputmode="decimal" value="${inputVal(v?.maintenancePerKm)}"></label>
      <label>Coûts fixes mensuels (€) <small>assurance, location/crédit, licence, téléphone…</small><input name="fixed" inputmode="decimal" value="${inputVal(v?.fixedMonthly)}"></label>
      <label>Heures d'activité prévues par mois <input name="hours" inputmode="decimal" value="${inputVal(v?.plannedHoursMonthly)}"></label>
      <label>Autres frais par offre E (€) <small>vide = non renseigné ; 0 = aucun frais confirmé</small><input name="other" inputmode="decimal" value="${inputVal(c?.otherPerOffer)}"></label>
      <div class="row"><button class="btn" type="submit">Enregistrer une nouvelle version</button></div>
    </form>
    ${c ? `<p>Version ${c.version} du ${dt(c.effectiveFrom)} : v = ${c.variablePerKm === null ? 'non renseigné' : num(c.variablePerKm, 3) + ' €/km'} ; f = ${c.fixedPerHour === null ? 'non renseigné' : num(c.fixedPerHour) + ' €/h'} ; E = ${c.otherPerOffer === null ? 'non renseigné' : eur(c.otherPerOffer)}</p>` : '<p class="muted">Aucun profil de coûts.</p>'}`;
  }
  if (sec === 'seuils') {
    const t = await activeThreshold();
    return `<p class="muted small">Favorable : les deux seuils atteints. Limite : chaque ratio atteint au moins 80 % de son seuil. Faible : sinon. Les seuils portent soit sur la recette, soit sur la marge estimée.</p>
    <form id="f" class="grid2">
      <label>Niveau <select name="level"><option value="margin" ${t?.level !== 'revenue' ? 'selected' : ''}>Marge d'exploitation estimée</option><option value="revenue" ${t?.level === 'revenue' ? 'selected' : ''}>Recette chauffeur (avant frais)</option></select></label>
      <label>Seuil €/km <input name="km" inputmode="decimal" required value="${inputVal(t?.perKm)}"></label>
      <label>Seuil €/h <input name="h" inputmode="decimal" required value="${inputVal(t?.perHour)}"></label>
      <div class="row"><button class="btn" type="submit">Enregistrer une nouvelle version</button></div>
    </form>
    ${t ? `<p>Version ${t.version} : ${t.level === 'margin' ? 'marge' : 'recette'} ≥ ${num(t.perKm)} €/km et ≥ ${num(t.perHour)} €/h</p>` : ''}`;
  }
  if (sec === 'plateformes') {
    const row = (p: 'uber' | 'bolt', label: string) => `<fieldset><legend>${label}</legend>
      <label>Le prix affiché sur l'offre est <select name="${p}-basis">
        <option value="unknown" ${s.platforms[p].priceBasis === 'unknown' ? 'selected' : ''}>Je ne sais pas</option>
        <option value="net_driver" ${s.platforms[p].priceBasis === 'net_driver' ? 'selected' : ''}>Ce que je perçois (net chauffeur)</option>
        <option value="gross_before_commission" ${s.platforms[p].priceBasis === 'gross_before_commission' ? 'selected' : ''}>Avant commission de la plateforme</option></select></label>
      <label>Taux de commission confirmé (%) <small>utilisé seulement si « avant commission »</small><input name="${p}-rate" inputmode="decimal" value="${s.platforms[p].commissionRate === null ? '' : inputVal(Math.round(s.platforms[p].commissionRate * 10000) / 100)}"></label>
      <label class="check"><input type="checkbox" name="${p}-ok" ${s.platforms[p].confirmed ? 'checked' : ''}> J'ai vérifié cette base sur mes relevés</label></fieldset>`;
    return `<p class="muted small">Vérifiez sur vos relevés de paiement si le montant de l'offre correspond à ce que vous touchez. Sans confirmation, le verdict reste au mieux « partiel ». Un montant déjà net n'est jamais réduit d'une commission.</p>
    <form id="f">${row('uber', 'Uber')}${row('bolt', 'Bolt')}<button class="btn" type="submit">Enregistrer</button></form>`;
  }
  if (sec === 'parcours') {
    return `<form id="f" class="grid2">
      <label>Validité d'un résultat (s) <small>en l'absence d'échéance lisible</small><input name="fresh" inputmode="numeric" value="${s.freshnessSec}"></label>
      <label>Plateforme supposée si non lisible <select name="plat"><option value="">Ne rien supposer</option><option value="uber" ${s.sessionPlatform === 'uber' ? 'selected' : ''}>Uber</option><option value="bolt" ${s.sessionPlatform === 'bolt' ? 'selected' : ''}>Bolt</option></select></label>
      <label class="check"><input type="checkbox" name="voice" ${s.voice ? 'checked' : ''}> Annonce vocale brève</label>
      <label>Retour à vide simulé : km <input name="rkm" inputmode="decimal" value="${inputVal(s.scenario.returnKm)}"></label>
      <label>Retour à vide simulé : min <input name="rmin" inputmode="decimal" value="${inputVal(s.scenario.returnMin)}"></label>
      <label>Attente incluse (min) <input name="wait" inputmode="decimal" value="${inputVal(s.scenario.waitMin)}"></label>
      <label>Synchronisation depuis le raccourci <select name="sync"><option value="off">Manuelle (recommandé)</option><option value="after_each" ${s.syncMode === 'after_each' ? 'selected' : ''}>Après chaque offre (réseau)</option></select></label>
      <div class="row"><button class="btn" type="submit">Enregistrer</button></div>
    </form><p class="muted small">Toute modification change la version de configuration : réimportez-la dans Scriptable avant de conduire.</p>`;
  }
  if (sec === 'raccourci') {
    const { config, missing, warnings } = await currentFastConfig();
    const last = await state.db.meta<string>('lastExportedConfigId');
    return `<ol class="steps">
      <li>Installez l'app gratuite <strong>Scriptable</strong> (App Store).</li>
      <li><button class="btn secondary" data-act="dl-script">Télécharger VTCPerso.js</button> ou <button class="btn secondary" data-act="copy-script">Copier le script</button>, puis créez le script <strong>VTC Perso</strong> dans Scriptable.</li>
      <li>${config ? `<button class="btn" data-act="copy-cfg">Copier la configuration <code>${esc(config.configId)}</code></button>` : `<span class="warn">Configuration incomplète : ${esc(missing.join(', '))}</span>`} puis, dans Scriptable : VTC Perso › Importer la configuration. ${last && config && last === config.configId ? '<span class="ok">Dernière copie : version actuelle.</span>' : ''}</li>
      <li>Construisez le raccourci « VTC Analyse » (16 actions) : <a href="./docs/RACCOURCI.html" target="_blank" rel="noopener">procédure exacte</a>.</li>
      <li>AssistiveTouch › Actions personnalisées › Toucher une fois › VTC Analyse. Placez le bouton loin de « Accepter ».</li>
      <li>Faites le <a href="#/session">test guidé à l'arrêt</a> puis le protocole de validation.</li>
    </ol>
    ${warnings.length ? `<ul class="small warn">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${cloudConfigured() && state.userId && config ? `<p class="small">Variante serveur (sans Scriptable) : <button class="btn secondary" data-act="publish">Publier cette configuration sur votre compte</button></p>` : ''}`;
  }
  if (sec === 'mesures') {
    const offers = (await state.db.all('offers')).filter((o) => o.timing);
    const end = offers.map((o) => o.timing!.scriptEndMs).filter((x): x is number => typeof x === 'number');
    const notif = offers.map((o) => o.timing!.afterNotifyMs).filter((x): x is number => typeof x === 'number');
    const st = (v: number[]) => (v.length ? `n = ${v.length} · médiane ${percentile(v, 50)} ms · p95 ${percentile(v, 95)} ms · ≤ 1 s : ${Math.round((100 * v.filter((x) => x <= 1000).length) / v.length)} % · ≤ 2 s : ${Math.round((100 * v.filter((x) => x <= 2000).length) / v.length)} %` : 'aucune mesure');
    return `<p class="muted small">Mesures horodatées par le raccourci, depuis le DÉBUT du raccourci (et non depuis la pression). Le délai pression → début du raccourci et l'affichage réel de la bannière se mesurent en vidéo : voir le protocole.</p>
    <dl class="kv"><dt>Fin du calcul</dt><dd>${st(end)}</dd><dt>Après l'action notification</dt><dd>${st(notif)}</dd></dl>
    <button class="btn secondary" data-act="dl-timing" ${offers.length ? '' : 'disabled'}>Exporter les mesures (CSV)</button>`;
  }
  if (sec === 'compte') {
    if (!cloudConfigured()) return `<p>Mode local uniquement : aucune adresse Supabase n'est configurée dans ce déploiement. Toutes les fonctions locales restent disponibles ; sauvegardez avec l'export JSON.</p>`;
    const u = state.userId ? { email: state.userEmail } : null;
    const pending = (await state.db.outbox()).length;
    const tokens = u ? await listDeviceTokens() : [];
    return u
      ? `<p>Connecté : <strong>${esc(u.email ?? '')}</strong> · ${pending} modification(s) en attente d'envoi.</p>
         <div class="row"><button class="btn" data-act="sync">Synchroniser maintenant</button><button class="btn secondary" data-act="migrate">Copier mes données locales dans ce compte</button><button class="btn secondary" data-act="logout">Se déconnecter</button></div>
         <p class="muted small">L'offre gratuite Supabase n'inclut pas de sauvegarde automatique et met le projet en pause après 7 jours d'inactivité : gardez des exports JSON.</p>
         <h3>Jetons d'appareil (raccourci)</h3>
         <p class="muted small">Un jeton permet au raccourci d'envoyer ses analyses (et à la variante serveur de calculer). Il est stocké haché côté serveur, limité à 30 requêtes/min, révocable.</p>
         <div class="row"><input id="tokLabel" placeholder="iPhone 12 Pro Max" maxlength="60"><button class="btn secondary" data-act="newtok">Créer un jeton</button></div>
         <div id="newTok"></div>
         <ul class="small">${tokens.map((t) => `<li>${esc(t.label)} · créé ${dt(t.created_at)} · ${t.revoked_at ? 'révoqué' : `dernier usage ${dt(t.last_used_at)} <button class="btn tiny danger" data-revoke="${esc(t.id)}">Révoquer</button>`}</li>`).join('')}</ul>
         <p class="muted small">Adresse à utiliser dans le raccourci : <code>${esc(functionsBase() + '/device-api')}</code></p>`
      : `<p>Connexion facultative : elle active la sauvegarde cloud, la synchronisation et les fonctions IA. L'usage local n'exige aucun compte.</p><button class="btn" data-act="login">Se connecter avec Google</button>`;
  }
  if (sec === 'ia') {
    const used = state.userId ? await aiUsageToday() : null;
    return `<p>Désactivées par défaut, jamais dans le parcours de conduite. Quand vous les utilisez, la PWA envoie à votre fonction serveur Supabase, qui appelle l'API Gemini de Google :</p>
    <ul class="small"><li>Expliquer un résultat : les valeurs déjà calculées de l'offre (pas d'image, pas d'adresse).</li><li>Résumer un bilan : les totaux agrégés des périodes.</li><li>Lire un justificatif : l'image que vous choisissez (recadrez-la).</li></ul>
    <p class="small warn">Conditions Google (Gemini API Additional Terms, 23/03/2026) : pour l'EEE, les règles de données des services payants s'appliquent aussi au quota gratuit ; une clause réserve aux services payants les clients API « mis à disposition d'utilisateurs » dans l'EEE. L'application de cette clause à un outil strictement personnel est une question d'interprétation : lisez les conditions avant d'activer.</p>
    <label class="check"><input type="checkbox" id="aiOn" ${s.aiEnabled ? 'checked' : ''} ${cloudConfigured() ? '' : 'disabled'}> Activer les fonctions IA</label>
    ${used !== null ? `<p class="small">Appels IA aujourd'hui : ${used} (limite fixée côté serveur ; à la limite, les appels s'arrêtent sans bascule payante).</p>` : ''}`;
  }
  if (sec === 'donnees') {
    return `<h3>Sauvegarde</h3>
    <div class="row"><button class="btn" data-act="export">Exporter tout (JSON)</button><label class="btn secondary file">Importer une sauvegarde<input type="file" accept="application/json,.json" id="imp" hidden></label></div>
    <h3>Exports CSV</h3>
    <div class="row"><button class="btn secondary" data-act="csv-offers">Offres</button><button class="btn secondary" data-act="csv-trips">Courses</button><button class="btn secondary" data-act="csv-exp">Dépenses</button></div>
    <h3>Journal du raccourci</h3>
    <p class="muted small">Dans Scriptable : VTC Perso › Copier le journal, puis collez ici. Import idempotent (pas de doublon).</p>
    <textarea id="journal" rows="4" placeholder='{"kind":"analysis",...}'></textarea>
    <div class="row"><button class="btn secondary" data-act="journal">Importer le journal</button><label class="btn secondary file">Fichier .jsonl<input type="file" accept=".jsonl,.txt,application/json" id="jfile" hidden></label></div>
    <h3>Démonstration</h3>
    <p class="muted small">Ouvre un espace séparé rempli de données FICTIVES. Vos données ne sont pas touchées.</p>
    <div class="row">${state.scope === 'demo' ? '<button class="btn secondary" data-act="leave-demo">Quitter la démonstration</button>' : '<button class="btn secondary" data-act="demo">Ouvrir la démonstration</button>'}</div>
    <h3>Effacement</h3>
    <button class="btn danger" data-act="wipe">Effacer les données de cet appareil (${esc(state.scope)})</button>`;
  }
  return `<p>VTC Perso ${esc(__APP_VERSION__)} · moteur et parseurs versionnés dans chaque analyse.</p>
  <p class="small">Outil personnel d'analyse : il n'accepte ni ne refuse aucune course et ne constitue pas un conseil fiscal ou juridique. Aucune affiliation avec Uber ou Bolt.</p>
  <p class="small">Stockage : ${esc(state.scope)} · ${navigator.onLine ? 'en ligne' : 'hors connexion'}.</p>`;
}


function bind(root: HTMLElement, sec: string) {
  const form = root.querySelector('#f') as HTMLFormElement | null;
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        if (sec === 'couts') {
          const vals = { cons: n(fd, 'cons'), price: n(fd, 'price'), maint: n(fd, 'maint'), fixed: n(fd, 'fixed'), hours: n(fd, 'hours'), other: n(fd, 'other') };
          if (Object.values(vals).some(bad)) return toast('Valeurs invalides (nombres positifs attendus)', 'err');
          const cur = await activeVehicle();
          const v: Omit<Vehicle, 'id' | 'updatedAt'> & { id?: string } = {
            id: cur?.id,
            name: String(fd.get('name') || 'Véhicule'),
            energy: String(fd.get('energy')) as Vehicle['energy'],
            consumptionPer100: vals.cons,
            energyUnitPrice: vals.price,
            maintenancePerKm: vals.maint,
            fixedMonthly: vals.fixed,
            plannedHoursMonthly: vals.hours,
          };
          const d = deriveCosts({ ...v, id: '', updatedAt: '' } as Vehicle);
          const p = await saveVehicleAndCosts(v, vals.other);
          toast(`Version ${p.version} : v = ${num(d.variablePerKm, 3)} €/km, f = ${num(d.fixedPerHour)} €/h`, 'ok');
        }
        if (sec === 'seuils') {
          const km = n(fd, 'km');
          const h = n(fd, 'h');
          if (km === null || h === null || !(km > 0) || !(h > 0)) return toast('Seuils strictement positifs requis', 'err');
          const t = await saveThresholds(String(fd.get('level')) as 'margin' | 'revenue', km, h);
          toast(`Seuils version ${t.version} enregistrés`, 'ok');
        }
        if (sec === 'plateformes') {
          const plat = { ...state.settings.platforms };
          for (const p of ['uber', 'bolt'] as const) {
            const basis = String(fd.get(`${p}-basis`)) as 'unknown' | 'net_driver' | 'gross_before_commission';
            const rate = n(fd, `${p}-rate`);
            if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate >= 100)) return toast('Taux invalide', 'err');
            const ok = fd.get(`${p}-ok`) === 'on';
            if (ok && basis === 'unknown') return toast('Choisissez une base avant de la confirmer', 'err');
            if (ok && basis === 'gross_before_commission' && rate === null) return toast('Taux de commission requis pour un prix avant commission', 'err');
            plat[p] = { priceBasis: basis, commissionRate: rate === null ? null : rate / 100, confirmed: ok };
          }
          await saveSettings({ platforms: plat });
          toast('Bases des prix enregistrées', 'ok');
        }
        if (sec === 'parcours') {
          const fresh = n(fd, 'fresh');
          if (fresh === null || !(fresh >= 1 && fresh <= 120)) return toast('Validité entre 1 et 120 s', 'err');
          const rkm = n(fd, 'rkm'), rmin = n(fd, 'rmin'), wait = n(fd, 'wait');
          if ([rkm, rmin, wait].some(bad)) return toast('Valeurs invalides', 'err');
          if ((rkm === null) !== (rmin === null)) return toast('Retour simulé : renseignez km ET minutes, ou aucun', 'err');
          const plat = String(fd.get('plat'));
          await saveSettings({
            freshnessSec: Math.round(fresh),
            voice: fd.get('voice') === 'on',
            sessionPlatform: plat === 'uber' || plat === 'bolt' ? plat : null,
            scenario: { returnKm: rkm, returnMin: rmin, waitMin: wait },
            syncMode: fd.get('sync') === 'after_each' ? 'after_each' : 'off',
          });
          toast('Enregistré : réimportez la configuration dans Scriptable', 'ok');
        }
        renderSettings(root, sec);
      } catch (err) {
        toast((err as Error).message, 'err');
      }
    };

  root.onchange = async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'aiOn') {
      await saveSettings({ aiEnabled: t.checked });
      toast(t.checked ? 'Fonctions IA activées' : 'Fonctions IA désactivées', 'ok');
    }
    if (t.id === 'imp') {
      const txt = await readFile(t);
      if (!txt) return;
      const p = parseBackup(txt);
      if (!p.ok) return toast(p.error, 'err');
      const before = (await state.db.dataset()) as never as Record<string, unknown[]>;
      const wasEmpty = Object.values(before).every((rows) => rows.length === 0 || rows.every((r) => (r as { id: string }).id === 'settings'));
      if (!confirm(`Importer ${Object.entries(p.backup.summary.counts).map(([k, v]) => `${v} ${k}`).join(', ')} ? Les enregistrements plus récents déjà présents sont conservés.`)) return;
      for (const s of STORES) {
        const rows = p.backup.data[s] as never[];
        const keep: never[] = [];
        for (const r of rows as { id: string; updatedAt: string }[]) {
          const cur = await state.db.get(s, r.id);
          if (!cur || cur.updatedAt < r.updatedAt) keep.push(r as never);
        }
        await state.db.saveMany(s, keep, { keepTimestamp: true });
      }
      const errs = verifyRestore(p.backup.summary, (await state.db.dataset()) as never, wasEmpty);
      await openScope(state.scope);
      toast(errs.length ? 'Import terminé avec écarts : ' + errs.join(' ; ') : 'Import vérifié : comptes, relations et totaux identiques', errs.length ? 'err' : 'ok');
    }
    if (t.id === 'jfile') {
      const txt = await readFile(t);
      if (txt) await doJournal(txt);
    }
  };

  root.onclick = async (e) => {
    const t = e.target as HTMLElement;
    const act = t.dataset.act;
    if (t.dataset.revoke) {
      await revokeDeviceToken(t.dataset.revoke);
      toast('Jeton révoqué', 'ok');
      return renderSettings(root, sec);
    }
    if (!act) return;
    try {
      if (act === 'dl-script' || act === 'copy-script') {
        const r = await fetch('./VTCPerso.js');
        const txt = await r.text();
        if (act === 'dl-script') download('VTCPerso.js', txt, 'text/javascript');
        else toast((await copy(txt)) ? 'Script copié' : 'Copie impossible', 'ok');
      }
      if (act === 'copy-cfg') {
        const { config } = await currentFastConfig();
        if (config && (await copy(JSON.stringify(config)))) {
          await state.db.setMeta('lastExportedConfigId', config.configId);
          toast('Configuration copiée', 'ok');
          renderSettings(root, sec);
        }
      }
      if (act === 'publish') {
        const { config } = await currentFastConfig();
        if (config) {
          await publishConfig(config);
          toast('Configuration publiée pour la variante serveur', 'ok');
        }
      }
      if (act === 'dl-timing') {
        const offers = (await state.db.all('offers')).filter((o) => o.timing);
        const csv = '﻿id;capture;plateforme;verdict;fin_calcul_ms;apres_notification_ms\n' + offers.map((o) => [o.id, o.capturedAt, o.platform, o.original.verdict.verdict, o.timing!.scriptEndMs ?? '', o.timing!.afterNotifyMs ?? ''].join(';')).join('\n');
        download('vtcperso-mesures.csv', csv, 'text/csv');
      }
      if (act === 'login') await signInGoogle();
      if (act === 'logout') {
        await signOut();
        state.userId = null;
        state.userEmail = null;
        rememberScope('local');
        await openScope('local');
        toast('Déconnecté : données du compte conservées sur cet appareil, séparées', 'ok');
        renderSettings(root, sec);
      }
      if (act === 'sync') {
        const r = await syncOnce(state.db, remoteAdapter());
        toast(r.error ? `Synchronisation interrompue (${r.error}) : rien n'est perdu, reprise au prochain essai` : `Envoyé ${r.pushed}, reçu ${r.appliedRemote}`, r.error ? 'err' : 'ok');
        await openScope(state.scope);
        renderSettings(root, sec);
      }
      if (act === 'migrate') {
        const local = await LocalDB.open('local');
        const res = await migrateScope(local, state.db);
        local.close();
        toast(`${res.copied} élément(s) copiés vers le compte (${res.skippedNewer} déjà plus récents). Synchronisez pour les envoyer.`, 'ok');
        renderSettings(root, sec);
      }
      if (act === 'newtok') {
        const label = (root.querySelector('#tokLabel') as HTMLInputElement).value || 'iPhone';
        const tok = await createDeviceToken(label);
        (root.querySelector('#newTok') as HTMLElement).innerHTML = `<p class="warn small">Jeton affiché une seule fois. Copiez-le puis, dans Scriptable : VTC Perso › Enregistrer le jeton d'appareil.</p><code class="token">${esc(tok)}</code> <button class="btn tiny" data-copytok="1">Copier</button>`;
        (root.querySelector('[data-copytok]') as HTMLElement).onclick = async () => toast((await copy(tok)) ? 'Jeton copié' : 'Copie impossible', 'ok');
        await saveSettings({ apiBase: functionsBase() + '/device-api' });
      }
      if (act === 'export') {
        const b = makeBackup((await state.db.dataset()) as never);
        download(`vtcperso-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
        await state.db.setMeta('lastBackupAt', b.exportedAt);
      }
      if (act === 'csv-offers') download('vtcperso-offres.csv', offersCsv((await state.db.dataset(false)) as never), 'text/csv');
      if (act === 'csv-trips') download('vtcperso-courses.csv', tripsCsv((await state.db.dataset(false)) as never), 'text/csv');
      if (act === 'csv-exp') download('vtcperso-depenses.csv', expensesCsv((await state.db.dataset(false)) as never), 'text/csv');
      if (act === 'journal') await doJournal((root.querySelector('#journal') as HTMLTextAreaElement).value);
      if (act === 'demo') {
        await openScope('demo');
        await seedDemo(state.db);
        await openScope('demo');
        location.hash = '#/session';
        toast('Démonstration : données fictives', 'info');
      }
      if (act === 'leave-demo') {
        await openScope(state.userId ? 'u-' + state.userId : 'local');
        location.hash = '#/session';
      }
      if (act === 'wipe' && confirm('Effacer définitivement les données de cet appareil pour cet espace ? Exportez d’abord une sauvegarde.')) {
        await state.db.clearAll();
        await openScope(state.scope);
        toast('Données effacées', 'ok');
        renderSettings(root, sec);
      }
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };
}

async function doJournal(text: string) {
  const existing = new Map((await state.db.all('offers', true)).map((o) => [o.id, o]));
  const r = importJournal(text, existing);
  await state.db.saveMany('offers', r.upserts, { keepTimestamp: false });
  toast(`${r.upserts.length} élément(s) importé(s), ${r.skipped} déjà présent(s)${r.errors.length ? ', ' + r.errors.length + ' ligne(s) ignorée(s)' : ''}`, r.errors.length ? 'info' : 'ok');
}

export { currentUser };

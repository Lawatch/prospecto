import { api, meta } from '../api.js';
import { confirmDialog, esc, fmtDate, on, toast, toastError, withBusy } from '../ui.js';

const TABS = { profil: 'Profil', pieces: 'CV et pièces jointes', messagerie: 'Messagerie', envoi: 'Envoi et relances', sources: 'Sources de données', scoring: 'Scoring', opposition: "Liste d'opposition", donnees: 'Données', securite: 'Sécurité' };

export default async function settings(el, { query, refreshCounts }) {
  const m = await meta();
  let tab = TABS[query.tab] ? query.tab : 'profil';
  let data;

  async function load() {
    data = await api.get('/api/settings');
    draw();
  }

  function draw() {
    el.innerHTML = `<div class="page-head"><div><h1>Paramètres et connexions</h1></div></div>
      <div class="tabs">${Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div>
      <div id="tab"></div>`;
    const t = el.querySelector('#tab');
    ({ profil, pieces, messagerie, envoi, sources, scoring, opposition, donnees, securite })[tab](t);
  }

  const field = (name, label, value, { type = 'text', help = '', rows } = {}) => `<div class="field"><label>${label}</label>${rows ? `<textarea name="${name}" rows="${rows}">${esc(value ?? '')}</textarea>` : `<input type="${type}" name="${name}" value="${esc(value ?? '')}">`}${help ? `<div class="help">${help}</div>` : ''}</div>`;

  async function saveSetting(key, form) {
    const out = {};
    for (const i of form.querySelectorAll('[name]')) {
      if (i.type === 'checkbox' && i.dataset.multi !== undefined) { out[i.name] = out[i.name] || []; if (i.checked) out[i.name].push(i.value); }
      else if (i.type === 'checkbox') out[i.name] = i.checked;
      else if (i.type === 'number') out[i.name] = Number(i.value);
      else out[i.name] = i.value;
    }
    await api.put(`/api/settings/${key}`, out);
    toast('Paramètres enregistrés', 'success');
    refreshCounts();
  }

  function profil(t) {
    const p = data.settings.profile;
    t.innerHTML = `<form class="card" id="f"><h2>Profil central</h2>
      <p class="small muted">Ces informations alimentent les variables des templates (<code>{{ma_presentation}}</code>, <code>{{mes_realisations}}</code>…). Elles ne sont jamais complétées ni reformulées automatiquement : seul ce que vous écrivez ici est utilisé.</p>
      <div class="form-grid">
        ${field('full_name', 'Prénom et nom', p.full_name)}
        ${field('title', 'Titre professionnel', p.title, { help: 'Utilisé dans l\'objet de certains modèles' })}
        ${field('email', 'E-mail', p.email, { type: 'email' })}
        ${field('phone', 'Téléphone', p.phone)}
        ${field('city', 'Ville de résidence', p.city)}
        ${field('linkedin_url', 'Profil LinkedIn (URL)', p.linkedin_url, { type: 'url' })}
        <div class="full">${field('target_position', 'Poste visé (formulation insérée dans les messages)', p.target_position, { help: 'ex. « un poste de responsable d\'exploitation ou de directeur adjoint »' })}</div>
        <div class="full">${field('presentation', 'Présentation (2 à 4 phrases)', p.presentation, { rows: 4, help: 'ex. « Fort·e de 8 ans en exploitation hôtelière, dont 3 comme adjoint·e de direction d\'un hôtel de 120 chambres… »' })}</div>
        <div class="full">${field('skills', 'Compétences clés', p.skills, { rows: 2, help: 'Séparées par des virgules' })}</div>
        <div class="full">${field('achievements', 'Réalisations chiffrées', p.achievements, { rows: 4, help: 'Une par ligne, commencez par « – ». Uniquement des faits que vous pouvez justifier.' })}</div>
        ${field('availability', 'Disponibilité', p.availability)}
        ${field('cv_url', 'Lien vers votre CV en ligne (facultatif)', p.cv_url, { type: 'url' })}
        <div class="full">${field('keywords', 'Mots-clés de compatibilité (scoring)', p.keywords, { help: 'Retrouvés dans le nom, le groupe ou les signaux d\'un établissement, ils améliorent son score.' })}</div>
        <div class="full">${field('signature', 'Signature', p.signature, { rows: 5, help: 'Laissez vide pour la générer à partir des champs ci-dessus.' })}</div>
      </div><button class="primary">Enregistrer le profil</button></form>`;
    t.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); saveSetting('profile', e.target).catch(toastError); });
  }

  async function pieces(t) {
    const list = await api.get('/api/attachments');
    t.innerHTML = `<div class="card"><h2>CV et pièces jointes</h2>
      <p class="small muted">Formats acceptés : PDF (recommandé), Word, ODT, images. 10 Mo maximum par fichier. Les pièces jointes « par défaut » sont ajoutées à chaque candidature.</p>
      <div class="row" style="margin-bottom:14px"><input type="text" id="label" placeholder="Libellé (ex. CV 2026)" style="max-width:260px"><input type="file" id="file" accept=".pdf,.doc,.docx,.odt,.png,.jpg,.jpeg"><button class="primary" id="up" data-busy="Envoi…">Ajouter</button></div>
      ${list.length ? `<table><thead><tr><th>Libellé</th><th>Fichier</th><th>Taille</th><th>Par défaut</th><th></th></tr></thead><tbody>
        ${list.map((a) => `<tr><td>${esc(a.label)}</td><td class="small"><a href="/api/attachments/${a.id}/file" target="_blank">${esc(a.filename)}</a></td><td class="small">${Math.round(a.size / 1024)} Ko</td>
          <td><input type="checkbox" data-default="${a.id}" ${a.is_default ? 'checked' : ''}></td><td><button class="sm danger" data-del="${a.id}">Supprimer</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune pièce jointe.</p>'}</div>`;
    t.querySelector('#up').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const file = t.querySelector('#file').files[0];
      if (!file) return toastError(new Error('Choisissez un fichier'));
      try { await api.upload('/api/attachments', file, { 'X-Filename': encodeURIComponent(file.name), 'X-Label': encodeURIComponent(t.querySelector('#label').value || file.name) }); toast('Pièce jointe ajoutée', 'success'); draw(); } catch (err) { toastError(err); }
    }));
    on(t, 'change', '[data-default]', async (e, cb) => { await api.patch(`/api/attachments/${cb.dataset.default}`, { is_default: cb.checked }); });
    on(t, 'click', '[data-del]', async (e, b) => { if (await confirmDialog('Supprimer', 'Supprimer cette pièce jointe ?', { danger: true, okLabel: 'Supprimer' })) { try { await api.del(`/api/attachments/${b.dataset.del}`); draw(); } catch (err) { toastError(err); } } });
  }

  function messagerie(t) {
    const c = data.connections;
    const s = data.settings.sending;
    const provider = (key, title, guide) => {
      const conn = c[key];
      const client = data.clients[key];
      return `<div class="card"><div class="card-head"><h2>${title}</h2>${conn.connected ? `<span class="badge success">Connecté : ${esc(conn.email)}</span>` : '<span class="badge">Non connecté</span>'}</div>
        <details ${client ? '' : 'open'}><summary class="small" style="cursor:pointer">Identifiants de l'application OAuth ${client ? '(configurés)' : '(à configurer une seule fois)'}</summary>
          <div class="small muted" style="margin:8px 0">${guide}<br>Adresse de redirection à déclarer : <code>${esc(conn.redirect_uri)}</code></div>
          <form class="form-grid" data-client="${key}">
            ${field('client_id', 'Identifiant client (Client ID)', client?.client_id || '')}
            ${field('client_secret', `Secret client${key === 'outlook' ? ' (facultatif)' : ''}`, '', { type: 'password', help: client?.has_secret ? 'Déjà enregistré (chiffré). Laissez vide pour le conserver.' : '' })}
            <div class="full"><button class="sm">Enregistrer les identifiants</button></div>
          </form></details>
        <div class="actions" style="margin-top:12px">${conn.connected ? `<button data-disconnect="${key}">Déconnecter</button>` : ''}<button class="primary" data-connect="${key}" ${client ? '' : 'disabled'}>${conn.connected ? 'Reconnecter' : 'Connecter'} ${title.split(' ')[0]}</button>
          ${s.provider === key ? '<span class="badge primary">Messagerie d\'envoi active</span>' : conn.connected ? `<button class="sm" data-use="${key}">Utiliser pour l'envoi</button>` : ''}</div></div>`;
    };
    t.innerHTML = `
      <div class="alert info">Aucun mot de passe de messagerie n'est demandé pour Gmail et Outlook : la connexion passe par l'autorisation officielle (OAuth). Les jetons sont stockés chiffrés sur cet ordinateur.</div>
      ${provider('gmail', 'Gmail / Google Workspace', 'Dans <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a> : créez un projet, activez « Gmail API », configurez l\'écran de consentement (type Externe, ajoutez votre adresse comme utilisateur test), puis créez un identifiant OAuth de type « Application de bureau ». Voir le guide pas à pas dans docs/CONNEXION-MESSAGERIE.md.')}
      <div class="card"><label class="inline"><input type="checkbox" id="detect" ${s.gmail_detect_replies ? 'checked' : ''}> Détecter les réponses et les rejets (Gmail : lecture des seules métadonnées — expéditeur et date — des fils de vos candidatures)</label><div class="small muted">Nécessite de reconnecter Gmail après activation.</div></div>
      ${provider('outlook', 'Outlook / Microsoft 365', 'Dans le <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">portail Microsoft Entra</a> : « Inscriptions d\'applications » → Nouvelle inscription (comptes personnels et professionnels), plateforme « Applications mobiles et de bureau » avec l\'URI de redirection ci-dessous, autorisation déléguée Mail.Send.')}
      <div class="card"><div class="card-head"><h2>SMTP (autre messagerie)</h2>${c.smtp.connected ? `<span class="badge success">${esc(c.smtp.email)}</span>` : '<span class="badge">Non configuré</span>'}</div>
        <p class="small muted">Pour une messagerie professionnelle sans API (OVH, Ionos, o2switch…). Utilisez un mot de passe d'application si votre fournisseur le propose. Il est stocké chiffré. Copie dans « Envoyés » non garantie selon le fournisseur.</p>
        <form class="form-grid" id="smtp">${field('host', 'Serveur SMTP', data.smtp?.host)}${field('port', 'Port', data.smtp?.port || 587, { type: 'number' })}${field('user', 'Identifiant', data.smtp?.user)}${field('password', 'Mot de passe', '', { type: 'password', help: data.smtp ? 'Laissez vide pour conserver l\'actuel.' : '' })}${field('from', 'Adresse d\'expédition', data.smtp?.from, { type: 'email' })}
          <div class="full actions"><button class="sm">Enregistrer</button><button type="button" class="sm" id="smtp-test">Tester la connexion</button>${s.provider === 'smtp' ? '<span class="badge primary">Messagerie d\'envoi active</span>' : c.smtp.connected ? '<button type="button" class="sm" data-use="smtp">Utiliser pour l\'envoi</button>' : ''}</div></form></div>
      <div class="card"><h2>Tester l'envoi</h2><p class="small muted">Envoie un e-mail de test à votre propre adresse avec la messagerie active (${esc(s.provider)}).</p>
        <div class="row"><input type="email" id="test-to" placeholder="${esc(data.sending.account || 'votre adresse')}" style="max-width:320px"><button id="test" data-busy="Envoi…">Envoyer un test</button></div></div>`;
    on(t, 'submit', '[data-client]', async (e, f) => {
      e.preventDefault();
      try { await api.put(`/api/secrets/oauth_client_${f.dataset.client}`, { value: { client_id: f.client_id.value.trim(), client_secret: f.client_secret.value.trim() } }); toast('Identifiants enregistrés (chiffrés)', 'success'); load(); } catch (err) { toastError(err); }
    });
    on(t, 'click', '[data-connect]', async (e, b) => {
      try {
        const { url } = await api.post(`/api/oauth/${b.dataset.connect}/start`);
        window.open(url, '_blank', 'noopener');
        toast('Autorisez l\'accès dans l\'onglet ouvert, puis revenez ici.', 'info', 8000);
        const iv = setInterval(async () => { const d = await api.get('/api/settings'); if (d.connections[b.dataset.connect].connected && !data.connections[b.dataset.connect].connected) { clearInterval(iv); data = d; draw(); refreshCounts(); toast('Messagerie connectée', 'success'); } }, 3000);
        setTimeout(() => clearInterval(iv), 300000);
      } catch (err) { toastError(err); }
    });
    on(t, 'click', '[data-disconnect]', async (e, b) => { await api.post(`/api/oauth/${b.dataset.disconnect}/disconnect`); load(); refreshCounts(); });
    on(t, 'click', '[data-use]', async (e, b) => { await api.put('/api/settings/sending', { provider: b.dataset.use }); load(); refreshCounts(); });
    t.querySelector('#detect').addEventListener('change', async (e) => { await api.put('/api/settings/sending', { gmail_detect_replies: e.target.checked }); toast(e.target.checked ? 'Activé : reconnectez Gmail pour accorder l\'autorisation.' : 'Désactivé'); load(); });
    t.querySelector('#smtp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await api.put('/api/secrets/smtp', { value: { host: f.host.value.trim(), port: Number(f.port.value), user: f.user.value.trim(), password: f.password.value, from: f.from.value.trim() } }); toast('SMTP enregistré', 'success'); load(); } catch (err) { toastError(err); }
    });
    t.querySelector('#smtp-test').addEventListener('click', async () => { try { await api.post('/api/mail/smtp-test'); toast('Connexion SMTP réussie', 'success'); } catch (err) { toastError(err); } });
    t.querySelector('#test').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { const r = await api.post('/api/mail/test', { to: t.querySelector('#test-to').value || undefined }); toast(`E-mail de test envoyé à ${r.to}`, 'success'); } catch (err) { toastError(err); }
    }));
  }

  function envoi(t) {
    const s = data.settings.sending;
    const f = data.settings.followup;
    t.innerHTML = `<form class="card" id="send"><h2>Plafonds et sécurité d'envoi</h2>
      <p class="small muted">Plafonds appliqués à tout envoi. Ils sont en plus limités automatiquement aux quotas publiés par le fournisseur (ex. Gmail grand public : 400/jour retenus sur 500). Un volume modéré et régulier protège votre réputation d'expéditeur.</p>
      <div class="form-grid">
        ${field('daily_cap', 'Messages maximum par jour', s.daily_cap, { type: 'number', help: `Actuellement effectif : ${data.sending.daily_cap}/jour` })}
        ${field('campaign_cap', 'Messages maximum par campagne', s.campaign_cap, { type: 'number' })}
        ${field('min_interval_seconds', 'Intervalle minimal entre deux envois de la file (secondes)', s.min_interval_seconds, { type: 'number' })}
        ${field('pause_after_errors', 'Mettre la campagne en pause après N erreurs consécutives', s.pause_after_errors, { type: 'number' })}
        <div class="full"><label class="inline"><input type="checkbox" name="opt_out_footer" ${s.opt_out_footer ? 'checked' : ''}> Ajouter une mention d'opposition sous la signature (et l'en-tête List-Unsubscribe)</label></div>
        <div class="full">${field('opt_out_text', 'Texte de la mention', s.opt_out_text)}</div>
      </div><button class="primary">Enregistrer</button></form>
      <form class="card" id="fu"><h2>Relances</h2><div class="form-grid">
        ${field('delay_days', 'Délai avant relance (jours)', f.delay_days, { type: 'number' })}
        ${field('max_followups', 'Nombre maximum de relances par candidature', f.max_followups, { type: 'number' })}
      </div><button class="primary">Enregistrer</button></form>`;
    t.querySelector('#send').addEventListener('submit', (e) => { e.preventDefault(); saveSetting('sending', e.target).then(load).catch(toastError); });
    t.querySelector('#fu').addEventListener('submit', (e) => { e.preventDefault(); saveSetting('followup', e.target).catch(toastError); });
  }

  function sources(t) {
    const s = data.settings.search;
    const key = (name, title, help) => `<div class="card"><div class="card-head"><h2>${title}</h2>${data.secrets[name] ? '<span class="badge success">Clé enregistrée</span>' : '<span class="badge">Non configuré</span>'}</div>
      <p class="small muted">${help}</p><div class="row"><input type="password" data-key-input="${name}" placeholder="${data.secrets[name] ? '•••••••• (laisser vide pour conserver)' : 'Coller la clé API'}" style="max-width:420px"><button data-key="${name}">Enregistrer</button>${data.secrets[name] ? `<button class="danger" data-key-del="${name}">Supprimer</button>` : ''}</div></div>`;
    t.innerHTML = `
      <div class="card"><h2>Sources gratuites (actives par défaut)</h2>
        <div class="small"><p><b>OpenStreetMap / Overpass</b> — établissements, adresses, sites, téléphones, enseignes. Licence ODbL (attribution affichée).</p>
        <p><b>Recherche d'entreprises (INSEE SIRENE / INPI RNE)</b> — entité légale, dirigeants déclarés, effectifs, nombre d'établissements.</p>
        <p><b>Base Adresse Nationale / Nominatim</b> — géocodage de la ville de départ.</p>
        <p><b>Sites officiels</b> — 6 pages publiques au plus par site (accueil, contact, mentions légales, recrutement), robots.txt respecté, 1 requête/seconde.</p></div>
        <form id="srch" class="form-grid">
          ${field('contact_email', 'Votre e-mail pour les services OpenStreetMap', s.contact_email, { type: 'email', help: 'Recommandé par la politique d\'usage de Nominatim.' })}
          ${field('default_radius_km', 'Rayon de recherche par défaut (km)', s.default_radius_km, { type: 'number' })}
          <div class="full"><label class="inline"><input type="checkbox" name="respect_robots" ${s.respect_robots !== false ? 'checked' : ''}> Respecter robots.txt des sites analysés (fortement recommandé)</label></div>
          <div class="full"><button class="primary sm">Enregistrer</button></div></form></div>
      ${key('google_places_key', 'Google Places API (facultatif, payant au-delà du quota gratuit)', 'Améliore la couverture et les sites web/téléphones. Clé à créer dans Google Cloud (API « Places API (New) »), avec facturation activée. Fixez un plafond de budget dans la console Google.')}
      ${key('hunter_key', 'Hunter.io (facultatif)', 'Recherche d\'adresses professionnelles publiques par domaine et vérification. Offre gratuite limitée (quelques dizaines de requêtes par mois).')}`;
    t.querySelector('#srch').addEventListener('submit', (e) => { e.preventDefault(); saveSetting('search', e.target).catch(toastError); });
    on(t, 'click', '[data-key]', async (e, b) => {
      const v = t.querySelector(`[data-key-input="${b.dataset.key}"]`).value.trim();
      if (!v) return;
      await api.put(`/api/secrets/${b.dataset.key}`, { value: v }); toast('Clé enregistrée (chiffrée)', 'success'); load();
    });
    on(t, 'click', '[data-key-del]', async (e, b) => { await api.put(`/api/secrets/${b.dataset.keyDel}`, { value: null }); load(); });
  }

  function scoring(t) {
    const s = data.settings.scoring;
    const labels = { fit: 'Adéquation type d\'établissement', size: 'Taille / complexité', position: 'Poste accessible', signals: "Signaux d'opportunité", contact: 'Qualité des coordonnées', distance: 'Distance', profile: 'Compatibilité profil (mots-clés)' };
    t.innerHTML = `<form class="card" id="f"><h2>Critères de scoring</h2>
      <div class="field"><label>Types d'établissement ciblés</label><div class="checks">${Object.entries(m.types).filter(([k]) => k !== 'autre').map(([k, v]) => `<label><input type="checkbox" data-multi name="target_types" value="${k}" ${s.target_types.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div></div>
      ${field('preferred_radius_km', 'Rayon préféré (km) — au-delà, le score diminue progressivement', s.preferred_radius_km, { type: 'number' })}
      <h3>Pondérations (points)</h3><div class="form-grid">${Object.entries(labels).map(([k, v]) => `<div class="field"><label>${v}</label><input type="number" min="0" max="50" data-weight="${k}" value="${s.weights[k]}"></div>`).join('')}</div>
      <p class="small muted">Le score final est ramené sur 100. Les scores de tous les établissements sont recalculés à l'enregistrement.</p>
      <button class="primary">Enregistrer et recalculer</button></form>`;
    t.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const weights = {};
      for (const i of t.querySelectorAll('[data-weight]')) weights[i.dataset.weight] = Number(i.value) || 0;
      await api.put('/api/settings/scoring', { target_types: [...t.querySelectorAll('[name=target_types]:checked')].map((c) => c.value), preferred_radius_km: Number(t.querySelector('[name=preferred_radius_km]').value), weights }).catch(toastError);
      toast('Scores recalculés', 'success');
    });
  }

  async function opposition(t) {
    const list = await api.get('/api/opposition');
    t.innerHTML = `<div class="card"><h2>Liste d'opposition</h2>
      <p class="small muted">Aucune adresse, aucun domaine ni aucun établissement de cette liste ne peut recevoir de message, même par erreur. Conservée même si vous supprimez vos données.</p>
      <form class="row" id="f" style="margin-bottom:12px"><input type="text" name="value" placeholder="adresse@domaine.fr ou domaine.fr" style="max-width:320px" required><input type="text" name="reason" placeholder="Motif (ex. demande STOP)" style="max-width:280px"><button class="primary">Ajouter</button></form>
      ${list.length ? `<table><thead><tr><th>Adresse / domaine / établissement</th><th>Motif</th><th>Date</th><th></th></tr></thead><tbody>${list.map((o) => `<tr><td>${esc(o.email || o.domain || o.establishment_name || `Établissement n° ${o.establishment_id}`)}</td><td class="small">${esc(o.reason || '')}</td><td class="small">${fmtDate(o.created_at)}</td><td><button class="sm ghost" data-del="${o.id}">Retirer</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Liste vide.</p>'}</div>`;
    t.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = e.target.value.value.trim().toLowerCase();
      try { await api.post('/api/opposition', v.includes('@') ? { email: v, reason: e.target.reason.value } : { domain: v, reason: e.target.reason.value }); draw(); } catch (err) { toastError(err); }
    });
    on(t, 'click', '[data-del]', async (e, b) => { if (await confirmDialog('Retirer de la liste', 'Ne retirez une entrée que si la personne a explicitement accepté d\'être recontactée.', { okLabel: 'Retirer' })) { await api.del(`/api/opposition/${b.dataset.del}`); draw(); } });
  }

  async function donnees(t) {
    const backups = await api.get('/api/backups');
    t.innerHTML = `<div class="grid cols-2">
      <div class="card"><h2>Export</h2><p class="small muted">Toutes vos données (hors clés, jetons et mots de passe).</p><div class="actions"><a class="btn" href="/api/export.json">Exporter tout (JSON)</a><a class="btn" href="/api/establishments/export.csv?in_list=">Établissements (CSV)</a></div></div>
      <div class="card"><h2>Sauvegardes</h2><p class="small muted">Une sauvegarde automatique par jour (14 conservées), dans le dossier <code>data/sauvegardes</code>.</p><button id="bk">Sauvegarder maintenant</button>
        <div class="small" style="margin-top:8px">${backups.slice(0, 5).map((b) => `<div>${esc(b.file)} · ${Math.round(b.size / 1024)} Ko</div>`).join('')}</div></div>
      <div class="card"><h2>Suppression</h2><p class="small muted">Une sauvegarde est faite avant toute suppression. La liste d'opposition est toujours conservée.</p>
        <div class="field"><label>Portée</label><select id="scope"><option value="non_listed">Résultats de recherche non retenus (hors liste, jamais contactés)</option><option value="older_than">Données plus anciennes que N jours</option><option value="all">Toutes les données de prospection</option></select></div>
        <div class="field"><input type="number" id="days" value="365" min="1" style="max-width:120px"> jours (pour « plus anciennes que »)</div>
        <div class="row"><input type="text" id="confirm" placeholder="Tapez SUPPRIMER" style="max-width:200px"><button class="danger" id="purge">Supprimer</button></div></div></div>`;
    t.querySelector('#bk').addEventListener('click', async () => { await api.post('/api/backup'); toast('Sauvegarde effectuée', 'success'); draw(); });
    t.querySelector('#purge').addEventListener('click', async () => {
      try { const r = await api.post('/api/data/purge', { scope: t.querySelector('#scope').value, days: Number(t.querySelector('#days').value), confirm: t.querySelector('#confirm').value }); toast(`Suppression effectuée${r.deleted != null ? ` (${r.deleted} établissement(s))` : ''}`, 'success'); refreshCounts(); } catch (err) { toastError(err); }
    });
  }

  function securite(t) {
    t.innerHTML = `<form class="card" id="f" style="max-width:520px"><h2>Mot de passe de l'application</h2>
      ${field('current', 'Mot de passe actuel', '', { type: 'password' })}${field('password', 'Nouveau mot de passe (8 caractères minimum)', '', { type: 'password' })}
      <button class="primary">Changer</button></form>
      <div class="card"><h2>Protection des données</h2><div class="small">
        <p>• L'application n'est accessible que depuis cet ordinateur (adresse 127.0.0.1).</p>
        <p>• Les jetons de messagerie, clés API et mots de passe SMTP sont chiffrés (AES-256-GCM) avec une clé locale stockée dans <code>data/cle-locale.key</code>, séparée de la base.</p>
        <p>• Conservez une copie du dossier <code>data</code> (sauvegarde) : sans la clé locale, les connexions devront être refaites.</p></div></div>`;
    t.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api.post('/api/auth/password', { current: e.target.current.value, password: e.target.password.value }); toast('Mot de passe modifié', 'success'); e.target.reset(); } catch (err) { toastError(err); }
    });
  }

  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; history.replaceState(null, '', `#/parametres?tab=${tab}`); draw(); });
  await load();
}

import { get, logEvent, now, update } from '../db.js';
import { getSetting } from '../settings.js';
import { domainOf } from '../util.js';
import { getEstablishment, addSignals, listContacts, recomputeScore, setStatus } from './establishments.js';
import { matchCompany, mapSireneResult, dirigeantsToContacts } from './sirene.js';
import { analyzeWebsite } from './website.js';
import { hasHunterKey, hunterDomainSearch } from './hunter.js';
import { checkMx, refreshReliability, upsertContact } from './contacts.js';

// Enrichissement d'un établissement à partir de sources publiques et traçables.
// Chaque étape est indépendante : une source en échec n'empêche pas les autres.
export async function enrichEstablishment(id, { steps = ['sirene', 'website', 'mx'] } = {}) {
  const report = { steps: {}, added_contacts: 0 };
  let est = getEstablishment(id);
  if (!est) throw Object.assign(new Error('Établissement introuvable'), { status: 404 });

  if (steps.includes('sirene')) {
    try {
      const match = await matchCompany(est);
      if (match) {
        const mapped = mapSireneResult(match.company, match.etab, null);
        const fields = {};
        for (const k of ['siren', 'siret', 'legal_name', 'naf', 'headcount_range', 'sites_count', 'company_category']) if (mapped[k] != null && est[k] == null) fields[k] = mapped[k];
        if (!est.group_name && mapped.group_name) fields.group_name = mapped.group_name;
        if (!est.postcode && mapped.postcode) fields.postcode = mapped.postcode;
        if (!est.city && mapped.city) fields.city = mapped.city;
        const sources = est.sources;
        if (!sources.some((s) => s.ref === mapped.source.ref)) sources.push({ ...mapped.source, collected_at: now(), match_confidence: match.confidence });
        fields.sources = sources;
        update('establishments', id, fields);
        let added = 0;
        for (const c of dirigeantsToContacts(mapped.dirigeants, mapped.source.url)) { upsertContact(est, c); added++; }
        report.steps.sirene = { ok: true, message: `Entreprise rapprochée : ${mapped.legal_name} (SIREN ${mapped.siren}, confiance ${Math.round(match.confidence * 100)} %) — ${added} dirigeant(s) déclaré(s)` };
      } else {
        report.steps.sirene = { ok: true, message: 'Aucune entité légale correspondante trouvée avec certitude' };
      }
    } catch (err) {
      report.steps.sirene = { ok: false, message: err.message };
    }
    est = getEstablishment(id);
  }

  if (steps.includes('website')) {
    if (!est.website) {
      report.steps.website = { ok: true, message: 'Pas de site officiel connu : ajoutez-le sur la fiche pour lancer l\'analyse' };
    } else {
      try {
        const res = await analyzeWebsite(est.website, { respectRobots: getSetting('search').respect_robots !== false });
        if (res.error && !res.emails.length) throw new Error(`Site inaccessible (${res.error})`);
        for (const e of res.emails) {
          upsertContact(est, {
            email: e.email,
            role: e.kind === 'rh' ? 'Service recrutement / RH' : e.kind === 'direction' ? 'Direction' : e.kind === 'generique' ? 'Adresse générique' : null,
            role_category: e.kind === 'rh' ? 'rh' : e.kind === 'direction' ? 'direction_etablissement' : e.kind === 'generique' ? 'generique' : undefined,
            email_status: e.same_domain ? 'publiee' : 'non_verifiee',
            source: 'Site officiel',
            source_url: e.source_url,
            collected_at: res.collected_at,
          });
          report.added_contacts++;
        }
        for (const p of res.people) {
          upsertContact(est, { first_name: p.first_name, last_name: p.last_name, role: p.role, role_category: p.role_category, source: 'Site officiel', source_url: p.source_url, notes: `Extrait : « ${p.snippet} »` });
        }
        const fields = {};
        if (res.contact_form_url && !est.contact_form_url) fields.contact_form_url = res.contact_form_url;
        const generic = res.emails.find((e) => e.kind === 'generique' && e.same_domain);
        if (generic && !est.generic_email) fields.generic_email = generic.email;
        if (res.sirets.length && !est.siret) {
          const siret = res.sirets.find((s) => s.length === 14);
          if (siret) fields.siret = siret;
        }
        const sources = est.sources;
        if (!sources.some((s) => s.source === 'Site officiel')) sources.push({ source: 'Site officiel', ref: domainOf(est.website), url: est.website, collected_at: res.collected_at });
        fields.sources = sources;
        update('establishments', id, fields);
        if (res.signals.length) addSignals(id, res.signals.map((s) => ({ ...s, collected_at: res.collected_at })));
        const visited = res.pages.filter((p) => p.ok).length;
        const blocked = res.pages.filter((p) => p.note === 'robots.txt').length;
        report.steps.website = { ok: true, message: `${visited} page(s) analysée(s)${blocked ? `, ${blocked} exclue(s) par robots.txt` : ''} : ${res.emails.length} adresse(s), ${res.people.length} personne(s) citée(s), ${res.signals.length} signal(aux)` };
      } catch (err) {
        report.steps.website = { ok: false, message: err.message };
      }
    }
    est = getEstablishment(id);
  }

  if (steps.includes('hunter') && hasHunterKey() && est.domain) {
    try {
      const found = await hunterDomainSearch(est.domain);
      for (const h of found) {
        upsertContact(est, { ...h, email_status: h.verified ? 'verifiee' : 'publiee', source: 'Hunter.io', confidence: h.confidence });
        report.added_contacts++;
      }
      report.steps.hunter = { ok: true, message: `${found.length} adresse(s) trouvée(s) via Hunter.io` };
    } catch (err) {
      report.steps.hunter = { ok: false, message: err.message };
    }
  }

  if (steps.includes('mx')) {
    const contacts = listContacts(id).filter((c) => c.email && c.mx_ok == null);
    for (const c of contacts) {
      const mx = await checkMx(c.email);
      if (mx != null) update('contacts', c.id, { mx_ok: mx, ...(mx === 0 ? { email_status: 'invalide' } : {}) });
    }
    report.steps.mx = { ok: true, message: `${contacts.length} domaine(s) de messagerie contrôlé(s)` };
  }

  est = getEstablishment(id);
  refreshReliability(est);
  update('establishments', id, { enriched_at: now(), updated_at: now() });
  const hasEmail = get("SELECT 1 AS x FROM contacts WHERE establishment_id = ? AND email IS NOT NULL AND email_status != 'invalide'", id);
  if (est.status === 'identifie') setStatus(id, hasEmail ? 'contact_a_verifier' : 'identifie');
  recomputeScore(id);
  logEvent('establishment', id, 'enrichi', report);
  return report;
}

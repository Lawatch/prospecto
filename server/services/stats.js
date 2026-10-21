import { all, get } from '../db.js';
import { TYPE_LABELS, TEMPLATE_CATEGORIES } from './catalog.js';

const POSITIVE = ['reponse_positive', 'entretien'];
const REPLIED = ['reponse_a_qualifier', 'reponse_positive', 'reponse_neutre', 'reponse_negative', 'entretien', 'refus', 'ne_plus_contacter'];

function pct(a, b) {
  return b ? Math.round((a / b) * 1000) / 10 : null;
}

function breakdown(groupExpr, labelFn) {
  const rows = all(`SELECT ${groupExpr} AS k,
      count(*) AS sent,
      sum(CASE WHEN m.outcome IN (${REPLIED.map((o) => `'${o}'`).join(',')}) THEN 1 ELSE 0 END) AS replied,
      sum(CASE WHEN m.outcome IN (${POSITIVE.map((o) => `'${o}'`).join(',')}) THEN 1 ELSE 0 END) AS positive,
      sum(CASE WHEN m.outcome = 'entretien' OR e.status = 'entretien' THEN 1 ELSE 0 END) AS interviews,
      sum(CASE WHEN m.delivery_status = 'rejete' THEN 1 ELSE 0 END) AS bounced
    FROM messages m JOIN establishments e ON e.id = m.establishment_id
    WHERE m.status = 'envoyee' AND m.kind = 'initial'
    GROUP BY k ORDER BY sent DESC`);
  return rows.map((r) => ({ key: r.k, label: labelFn(r.k), ...r, reply_rate: pct(r.replied, r.sent), positive_rate: pct(r.positive, r.sent), interview_rate: pct(r.interviews, r.sent) }));
}

export function computeStats() {
  const n = (sql, ...p) => get(sql, ...p).n;
  const identified = n('SELECT count(*) AS n FROM establishments');
  const inList = n('SELECT count(*) AS n FROM establishments WHERE in_list = 1');
  const qualified = n('SELECT count(*) AS n FROM establishments WHERE in_list = 1 AND score >= 50');
  const usableContacts = n("SELECT count(DISTINCT establishment_id) AS n FROM contacts WHERE email IS NOT NULL AND email_status != 'invalide'");
  const prepared = n("SELECT count(*) AS n FROM messages WHERE status != 'ignoree'");
  const pending = n("SELECT count(*) AS n FROM messages WHERE status IN ('a_valider','brouillon')");
  const validated = n("SELECT count(*) AS n FROM messages WHERE validated_at IS NOT NULL");
  const sent = n("SELECT count(*) AS n FROM messages WHERE status = 'envoyee' AND kind = 'initial'");
  const followupsSent = n("SELECT count(*) AS n FROM messages WHERE status = 'envoyee' AND kind = 'relance'");
  const bounced = n("SELECT count(*) AS n FROM messages WHERE status = 'envoyee' AND delivery_status = 'rejete'");
  const errors = n("SELECT count(*) AS n FROM messages WHERE status = 'erreur'");
  const replied = n(`SELECT count(*) AS n FROM messages WHERE status = 'envoyee' AND kind = 'initial' AND (outcome IN (${REPLIED.map((o) => `'${o}'`).join(',')})
                     OR EXISTS (SELECT 1 FROM messages r WHERE r.parent_message_id = messages.id AND r.outcome IN (${REPLIED.map((o) => `'${o}'`).join(',')})))`);
  const positive = n(`SELECT count(*) AS n FROM messages WHERE status = 'envoyee' AND kind = 'initial' AND (outcome IN ('reponse_positive','entretien')
                     OR EXISTS (SELECT 1 FROM messages r WHERE r.parent_message_id = messages.id AND r.outcome IN ('reponse_positive','entretien')))`);
  const interviews = n("SELECT count(*) AS n FROM establishments WHERE status = 'entretien'");
  const replySync = !!get("SELECT 1 AS x FROM settings WHERE key = 'sending' AND value LIKE '%\"gmail_detect_replies\":true%'");
  return {
    funnel: {
      identified, in_list: inList, qualified, usable_contacts: usableContacts, prepared, pending_validation: pending, validated, sent,
      followups_sent: followupsSent, errors,
      // « Délivré » n'est connu qu'en l'absence de rejet détecté, et seulement si la détection des rejets est active.
      delivered_known: replySync ? sent - bounced : null,
      bounced, replied, positive, interviews,
      reply_rate: pct(replied, sent), positive_rate: pct(positive, sent), interview_rate: pct(interviews, sent),
    },
    by_type: breakdown('e.type', (k) => TYPE_LABELS[k] || 'Inconnu'),
    by_template: breakdown('m.template_name', (k) => k || 'Sans modèle'),
    by_category: breakdown('m.template_category', (k) => TEMPLATE_CATEGORIES[k] || k || '—'),
    by_role: breakdown("coalesce((SELECT c.role_category FROM contacts c WHERE c.id = m.contact_id), 'generique')", (k) => ({ proprietaire: 'Propriétaire / exploitant', direction_generale: 'Direction générale', direction_etablissement: "Direction d'établissement", direction_operations: 'Direction des opérations', rh: 'Ressources humaines', commercial: 'Commercial', generique: 'Adresse générique', autre: 'Autre' })[k] || k),
    daily: all(`SELECT substr(created_at, 1, 10) AS day, sum(ok) AS ok, sum(1 - ok) AS failed FROM send_log WHERE created_at >= ? GROUP BY day ORDER BY day`, new Date(Date.now() - 30 * 86400_000).toISOString()),
  };
}

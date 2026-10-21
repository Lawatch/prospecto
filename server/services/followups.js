import { all } from '../db.js';
import { getSetting } from '../settings.js';
import { isOpposed } from './contacts.js';

// Relances dues : messages initiaux envoyés, sans réponse, au-delà du délai configuré.
// Exclus : réponse reçue, refus, entretien, opposition, adresse rejetée, plafond de relances atteint.
export function dueFollowups() {
  const { delay_days: delay, max_followups: max } = getSetting('followup');
  const cutoff = new Date(Date.now() - (Number(delay) || 8) * 86400_000).toISOString();
  const rows = all(`SELECT m.*, e.name AS establishment_name, e.status AS establishment_status, e.do_not_contact, e.city,
      (SELECT count(*) FROM messages r WHERE r.parent_message_id = m.id AND r.status = 'envoyee') AS followups_sent,
      (SELECT r.id FROM messages r WHERE r.parent_message_id = m.id AND r.status IN ('a_valider','brouillon','validee')) AS pending_followup_id,
      (SELECT max(r.sent_at) FROM messages r WHERE r.parent_message_id = m.id AND r.status = 'envoyee') AS last_followup_at
    FROM messages m JOIN establishments e ON e.id = m.establishment_id
    WHERE m.kind = 'initial' AND m.status = 'envoyee' AND m.outcome = 'aucune' AND m.delivery_status != 'rejete'
      AND e.status NOT IN ('reponse','entretien','refus','ne_plus_contacter') AND e.do_not_contact = 0
    ORDER BY m.sent_at`);
  return rows
    .filter((r) => r.followups_sent < (Number(max) || 1))
    .filter((r) => !isOpposed(r.to_email, r.establishment_id))
    .map((r) => {
      const reference = r.last_followup_at || r.sent_at;
      const dueAt = new Date(Date.parse(reference) + (Number(delay) || 8) * 86400_000).toISOString();
      return { ...r, due_at: dueAt, is_due: reference <= cutoff };
    });
}

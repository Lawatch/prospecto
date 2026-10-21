import { TYPE_LABELS } from './catalog.js';

export const VARIABLES = {
  entreprise: "Nom de l'établissement",
  type_etablissement: "Type d'établissement (ex. : hôtel)",
  ville: 'Ville',
  site_web: 'Site web',
  groupe: 'Groupe ou enseigne',
  accroche: "Élément pertinent et vérifiable sur l'entreprise (fiche prospect)",
  salutation: 'Formule d\'appel (« Madame Dupont, » ou « Madame, Monsieur, »)',
  destinataire_nom: 'Prénom et nom du destinataire',
  destinataire_prenom: 'Prénom du destinataire',
  destinataire_fonction: 'Fonction du destinataire',
  poste_vise: 'Poste visé (profil)',
  mon_nom: 'Mon nom',
  mon_titre: 'Mon titre professionnel',
  ma_presentation: 'Ma présentation (profil)',
  mes_competences: 'Mes compétences (profil)',
  mes_realisations: 'Mes réalisations (profil)',
  disponibilite: 'Ma disponibilité (profil)',
  mon_telephone: 'Mon téléphone',
  mon_email: 'Mon e-mail',
  mon_linkedin: 'Mon profil LinkedIn',
  lien_cv: 'Lien vers mon CV',
  date_message_initial: 'Date du premier envoi (relances)',
  objet_initial: 'Objet du premier message (relances)',
};

const SECTION_RE = /\{\{([#^])\s*([a-z_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function buildVariables({ establishment = {}, contact = null, profile = {}, extra = {} }) {
  const fullName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : '';
  let salutation = 'Madame, Monsieur,';
  if (contact?.last_name && contact?.civility === 'Mme') salutation = `Madame ${contact.last_name},`;
  else if (contact?.last_name && contact?.civility === 'M.') salutation = `Monsieur ${contact.last_name},`;
  else if (contact?.last_name && contact?.first_name) salutation = `Bonjour ${contact.first_name} ${contact.last_name},`;
  const type = TYPE_LABELS[establishment.type];
  return {
    entreprise: establishment.name || '',
    type_etablissement: type && establishment.type !== 'autre' ? type.toLowerCase() : '',
    ville: establishment.city || '',
    site_web: establishment.website || '',
    groupe: establishment.group_name || establishment.brand || '',
    accroche: establishment.hook || '',
    salutation,
    destinataire_nom: fullName,
    destinataire_prenom: contact?.first_name || '',
    destinataire_fonction: contact?.role && contact.role_category !== 'generique' ? contact.role : '',
    poste_vise: profile.target_position || '',
    mon_nom: profile.full_name || '',
    mon_titre: profile.title || '',
    ma_presentation: profile.presentation || '',
    mes_competences: profile.skills || '',
    mes_realisations: profile.achievements || '',
    disponibilite: profile.availability || '',
    mon_telephone: profile.phone || '',
    mon_email: profile.email || '',
    mon_linkedin: profile.linkedin_url || '',
    lien_cv: profile.cv_url || '',
    ...extra,
  };
}

// Rendu « façon Mustache » : {{variable}}, {{#variable}}bloc si renseignée{{/variable}}, {{^variable}}bloc sinon{{/variable}}.
// Aucune valeur n'est inventée : une variable vide reste vide et est signalée.
export function render(template, vars) {
  const used = {};
  const missing = new Set();
  const unknown = new Set();
  const filled = (name) => {
    if (!(name in vars)) { unknown.add(name); return false; }
    return String(vars[name] ?? '').trim() !== '';
  };
  let out = String(template ?? '');
  for (let i = 0; i < 5 && SECTION_RE.test(out); i++) {
    SECTION_RE.lastIndex = 0;
    out = out.replace(SECTION_RE, (m, kind, name, inner) => {
      const ok = filled(name);
      if (ok) used[name] = vars[name];
      return (kind === '#' ? ok : !ok) ? inner : '';
    });
    SECTION_RE.lastIndex = 0;
  }
  out = out.replace(VAR_RE, (m, name) => {
    if (!(name in vars)) { unknown.add(name); return m; }
    const v = String(vars[name] ?? '').trim();
    if (!v) missing.add(name);
    else used[name] = v;
    return v;
  });
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { text: out, used, missing: [...missing], unknown: [...unknown] };
}

export function findUnresolved(text) {
  return [...String(text || '').matchAll(/\{\{[^}]*\}\}|\{\{|\}\}/g)].map((m) => m[0]);
}

export function buildSignature(profile) {
  if (profile.signature && profile.signature.trim()) return profile.signature.trim();
  return [profile.full_name, profile.title, profile.phone, profile.email, profile.linkedin_url].filter((s) => s && String(s).trim()).join('\n');
}

export const DEFAULT_TEMPLATES = [
  {
    name: 'Direction adjointe – hôtel',
    category: 'direction_adjointe',
    target_types: ['hotel', 'apart_hotel', 'residence_tourisme'],
    subject: 'Candidature spontanée – Direction adjointe – {{entreprise}}',
    body: `{{salutation}}

{{#accroche}}{{accroche}} C'est ce qui m'a donné envie de vous écrire directement.

{{/accroche}}{{^accroche}}Je me permets de vous adresser ma candidature spontanée pour {{entreprise}}.

{{/accroche}}{{ma_presentation}}

Je souhaiterais mettre cette expérience au service de votre établissement, sur un poste de directeur adjoint ou de responsable d'exploitation, si un tel besoin existe aujourd'hui ou se présente prochainement.
{{#mes_realisations}}
Quelques éléments concrets de mon parcours :
{{mes_realisations}}
{{/mes_realisations}}
{{#lien_cv}}Mon CV est consultable ici : {{lien_cv}}
{{/lien_cv}}
Je serais ravi·e d'en échanger lors d'un appel ou d'un rendez-vous à votre convenance.

Bien cordialement,`,
  },
  {
    name: "Direction d'établissement",
    category: 'direction_etablissement',
    target_types: [],
    subject: "Candidature – Direction d'établissement – {{entreprise}}",
    body: `{{salutation}}

{{#accroche}}{{accroche}}

{{/accroche}}{{ma_presentation}}

Je vous adresse ma candidature spontanée pour un poste de direction d'établissement au sein de {{entreprise}}{{#groupe}} ou du groupe {{groupe}}{{/groupe}}. Le pilotage d'un centre de profit (chiffre d'affaires, masse salariale, qualité de service et satisfaction client) est au cœur de mon parcours.
{{#mes_realisations}}
{{mes_realisations}}
{{/mes_realisations}}
{{#lien_cv}}Vous trouverez mon CV ici : {{lien_cv}}
{{/lien_cv}}
Je reste à votre disposition pour un échange.

Bien cordialement,`,
  },
  {
    name: 'Gestion opérationnelle',
    category: 'gestion_operationnelle',
    target_types: [],
    subject: 'Candidature – Gestion opérationnelle – {{entreprise}}',
    body: `{{salutation}}

{{#accroche}}{{accroche}}

{{/accroche}}{{ma_presentation}}

{{#mes_competences}}Mes points forts au quotidien : {{mes_competences}}.

{{/mes_competences}}Je serais intéressé·e par un rôle de gestion opérationnelle au sein de {{entreprise}}, aux côtés de la direction.
{{#lien_cv}}
Mon CV : {{lien_cv}}
{{/lien_cv}}
Seriez-vous disponible pour un court échange dans les prochaines semaines ?

Bien cordialement,`,
  },
  {
    name: "Responsable d'exploitation",
    category: 'responsable_exploitation',
    target_types: [],
    subject: "Candidature – Responsable d'exploitation – {{entreprise}}",
    body: `{{salutation}}

{{#accroche}}{{accroche}}

{{/accroche}}Je vous contacte au sujet d'un éventuel poste de responsable d'exploitation au sein de {{entreprise}}.

{{ma_presentation}}
{{#mes_realisations}}
{{mes_realisations}}
{{/mes_realisations}}
{{#lien_cv}}Mon CV est disponible ici : {{lien_cv}}
{{/lien_cv}}
Je serais ravi·e d'en discuter avec vous.

Bien cordialement,`,
  },
  {
    name: 'Gestion de centre de profit – groupe',
    category: 'centre_de_profit',
    target_types: ['groupe_hotelier'],
    subject: 'Candidature – Gestion de centre de profit – {{entreprise}}',
    body: `{{salutation}}

{{#accroche}}{{accroche}}

{{/accroche}}{{ma_presentation}}

Je souhaiterais rejoindre {{#groupe}}le groupe {{groupe}}{{/groupe}}{{^groupe}}{{entreprise}}{{/groupe}} pour prendre la responsabilité d'un centre de profit : pilotage du compte d'exploitation, management des équipes et développement du chiffre d'affaires.
{{#mes_realisations}}
{{mes_realisations}}
{{/mes_realisations}}
{{#lien_cv}}Mon CV : {{lien_cv}}
{{/lien_cv}}
Je reste à votre disposition pour en échanger.

Bien cordialement,`,
  },
  {
    name: 'Développement commercial',
    category: 'developpement_commercial',
    target_types: [],
    subject: 'Candidature – Développement commercial – {{entreprise}}',
    body: `{{salutation}}

{{#accroche}}{{accroche}}

{{/accroche}}{{ma_presentation}}

Je vous propose ma candidature pour contribuer au développement commercial de {{entreprise}} (clientèle affaires, groupes, séminaires, partenariats).
{{#lien_cv}}
Mon CV : {{lien_cv}}
{{/lien_cv}}
Au plaisir d'échanger avec vous,

Bien cordialement,`,
  },
  {
    name: 'Candidature spontanée générale',
    category: 'generale',
    target_types: [],
    subject: 'Candidature spontanée – {{mon_titre}}',
    body: `{{salutation}}

Je me permets de vous adresser ma candidature spontanée pour {{entreprise}}{{#ville}}, à {{ville}}{{/ville}}.

{{#accroche}}{{accroche}}

{{/accroche}}{{ma_presentation}}

Je recherche {{poste_vise}} et serais heureux·se d'échanger avec vous sur vos besoins actuels ou à venir.
{{#lien_cv}}
Mon CV : {{lien_cv}}
{{/lien_cv}}
Bien cordialement,`,
  },
  {
    name: 'Relance courtoise',
    category: 'relance',
    kind: 'relance',
    target_types: [],
    subject: 'Re: {{objet_initial}}',
    body: `{{salutation}}

Je me permets de revenir vers vous au sujet de ma candidature envoyée le {{date_message_initial}} pour {{entreprise}}.

Si un poste correspondant à mon profil venait à s'ouvrir, ou si un échange de quelques minutes vous semblait utile, je serais ravi·e d'en discuter.

Je vous remercie par avance de votre retour, même négatif.

Bien cordialement,`,
  },
];

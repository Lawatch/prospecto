# Architecture, intégrations, coûts et limites

## 0. Deux façons d'utiliser Prospecto

| | Version en ligne (recommandée sur un poste de travail) | Version installée |
|---|---|---|
| Accès | https://lawatch.github.io/prospecto/ | Raccourci bureau, `http://127.0.0.1:3737` |
| Installation | Aucune | Node.js + installateur |
| Données | Base SQLite (WebAssembly) dans le navigateur (IndexedDB), sauvegarde téléchargeable | Fichier `data/prospecto.sqlite` |
| Recherche | OpenStreetMap, SIRENE, géocodage IGN, Google Places (option) appelés depuis le navigateur | Idem, depuis le serveur local |
| Sites des établissements | Texte copié-collé (les navigateurs interdisent la lecture directe) | Lecture automatique (robots.txt respecté) |
| Envoi | Brouillon pré-rempli dans Gmail/Outlook web, ou Gmail API (jeton d'une heure) | Gmail API, Outlook (Graph), SMTP, ou messagerie web |

Le code est le même : `scripts/build-web.mjs` compile les routes et services de `server/` pour le navigateur, en remplaçant les modules propres à Node par les adaptateurs de `browser/` (SQLite via sql.js, fichiers stockés dans la base, DNS via DNS-over-HTTPS, MIME pour Gmail). La publication sur GitHub Pages est automatique (`.github/workflows/pages.yml`) après les tests.

## 1. Choix d'architecture (version installée)

**Application web locale**, installée sur votre ordinateur et ouverte dans votre navigateur.

| Couche | Choix | Pourquoi |
|---|---|---|
| Interface | Application web monopage (HTML/CSS/JavaScript natif, sans étape de compilation) | Rapide, aucune dépendance front-end à maintenir, fonctionne dans tout navigateur récent |
| Serveur | Node.js 22+ avec Express 5 | Une seule technologie, un seul processus, installation simple sous Windows/macOS/Linux |
| Base de données | SQLite (module intégré `node:sqlite`), fichier `data/prospecto.sqlite` | Persistante, sans serveur à administrer, sauvegardable par simple copie |
| Envoi | API Gmail, Microsoft Graph (OAuth 2.0 + PKCE) ou SMTP | API officielles, pas de mot de passe de messagerie |
| Lancement | Raccourci bureau → lanceur qui démarre le service en arrière-plan s'il ne tourne pas, puis ouvre le navigateur | « Deux clics », aucun terminal |

**Pourquoi local plutôt qu'hébergé en ligne ?**

- Coût d'exploitation nul (pas d'hébergement, pas de base managée).
- Vos données (prospects, candidatures, jetons de messagerie) ne quittent pas votre ordinateur, sauf vers les services que vous appelez explicitement.
- La connexion OAuth Gmail/Outlook en mode « application de bureau » fonctionne nativement avec une adresse locale (`127.0.0.1`), sans nom de domaine ni certificat.
- Limite : l'application n'est utilisable que depuis l'ordinateur où elle est installée. Un hébergement (VPS, ~5 €/mois) resterait possible plus tard : le code est le même, il faudrait ajouter HTTPS, un nom de domaine et passer les applications OAuth en type « Web ».

### Organisation du code

```
server/
  index.js            démarrage, sauvegarde quotidienne, file d'envoi
  app.js              routes HTTP, en-têtes de sécurité
  auth.js             mot de passe local (scrypt), sessions, protection CSRF
  crypto.js           chiffrement AES-256-GCM des secrets
  db.js               schéma SQLite et accès aux données
  routes/             API REST (prospects, messagerie, administration, tâches)
  services/
    geocode.js        géocodage (Base Adresse Nationale, Nominatim)
    osm.js            recherche OpenStreetMap (Overpass)
    sirene.js         API Recherche d'entreprises (SIRENE / RNE)
    places.js         Google Places (facultatif)
    website.js        analyse du site officiel (robots.txt respecté)
    hunter.js         Hunter.io (facultatif)
    enrich.js         enrichissement d'un établissement
    establishments.js fusion des doublons, statuts, score
    contacts.js       contacts, indice de fiabilité, contrôle MX, liste d'opposition
    scoring.js        score explicable
    templates.js      variables et rendu des modèles
    campaigns.js      génération des messages et contrôles avant envoi
    mailer.js         envoi (Gmail, Outlook, SMTP), garde-fous, file d'envoi, détection des réponses
    followups.js      relances dues
    stats.js          indicateurs
public/               interface (pages dans public/js/pages)
launcher/             lanceur et raccourcis
test/                 tests unitaires et de bout en bout (faux services externes)
```

### Données (tables principales)

`establishments` (avec sources et date de collecte), `contacts` (source, URL, fiabilité, statut de l'adresse), `templates`, `campaigns`, `messages` (statut, validation, envoi, résultat), `events` (historique de toutes les actions), `opposition`, `send_log` (plafonds), `search_results`.

## 2. Intégrations

| Service | Usage | Clé | Coût | Statut |
|---|---|---|---|---|
| OpenStreetMap / Overpass | Établissements, adresses, sites, téléphones, enseignes, étoiles, chambres | Non | Gratuit (usage raisonnable) | Intégré |
| Recherche d'entreprises (api.gouv.fr) | Entité légale, SIRET, effectif, nombre d'établissements, dirigeants déclarés, holding | Non | Gratuit (7 req/s) | Intégré |
| Base Adresse Nationale (IGN) / Nominatim | Géocodage du point de départ | Non | Gratuit | Intégré |
| Sites officiels des établissements | Adresses publiées, mentions légales, formulaire de contact, signaux (recrutement, rénovation…) | Non | Gratuit | Intégré (6 pages max., robots.txt respecté, 1 req/s) |
| Google Places API (New) | Couverture complémentaire, sites et téléphones | Oui | Quota mensuel gratuit, puis facturation à l'usage (niveau « Enterprise » pour site/téléphone) : vérifiez la grille en vigueur et fixez un plafond de budget | Intégré, facultatif |
| Hunter.io | Adresses publiques par domaine, vérification | Oui | Offre gratuite limitée (quelques dizaines de requêtes/mois), puis abonnement | Intégré, facultatif |
| Gmail API | Envoi, fil de relance, détection des réponses/rejets (métadonnées) | OAuth | Gratuit | Intégré |
| Microsoft Graph | Envoi Outlook / Microsoft 365 | OAuth | Gratuit | Intégré |
| SMTP | Autres messageries | Mot de passe d'application (chiffré) | Selon fournisseur | Intégré |

**Coût récurrent minimal : 0 €.** Coûts éventuels : Google Places au-delà du quota gratuit, abonnement Hunter.

## 3. Limites des sources de données (à connaître)

- **OpenStreetMap** : couverture bonne pour les hôtels en France, mais inégale ; le site web et le téléphone manquent souvent pour les petits établissements. Les noms de groupe (« operator ») sont rarement renseignés.
- **SIRENE** : liste les *entités légales* (dont des SCI ou holdings rattachées au code NAF hôtelier) ; l'enseigne commerciale n'est pas toujours renseignée, et les coordonnées GPS peuvent être approximatives. Le rapprochement avec un établissement OSM est fait par nom et proximité, avec un indice de confiance affiché ; il peut échouer.
- **Dirigeants (RNE)** : ce sont les mandataires *légaux* (président de SAS, gérant…). Dans un groupe, ce n'est pas forcément la personne qui recrute sur le site. Aucune adresse e-mail n'est fournie — et l'application n'en devine jamais.
- **Sites officiels** : beaucoup de sites n'affichent qu'une adresse générique (contact@, reservation@) ou un formulaire. Les sites entièrement générés en JavaScript peuvent ne rien exposer à l'analyse. Les signaux détectés (recrutement, ouverture…) sont des extraits de texte à vérifier, jamais la preuve d'un poste vacant.
- **Contrôle MX** : prouve que le *domaine* reçoit des e-mails, pas que la *boîte* existe. Une adresse n'est marquée « vérifiée » que par vous ou par Hunter.
- **Google Places** : les conditions Google interdisent de conserver durablement la plupart des contenus (seul l'identifiant `place_id` peut l'être sans limite ; les autres contenus au plus 30 jours). Pensez à purger ou rafraîchir ces données (Paramètres > Données).
- **« Délivré »** : un envoi accepté par Gmail/Outlook n'est pas une garantie de remise. L'application ne compte des e-mails « délivrés » qu'avec la détection des rejets Gmail activée, et seulement au sens « aucun rejet détecté ».
- **Réponses** : la détection automatique n'existe que pour Gmail (métadonnées des fils de vos candidatures). Pour Outlook/SMTP, qualifiez les réponses à la main dans l'Historique.

## 4. Conformité (RGPD, prospection, conditions d'utilisation)

- Seules des données **professionnelles publiques** sont collectées, avec leur **source et date de collecte**.
- Les envois sont **individuels et validés un par un** ; une mention d'opposition (« répondez STOP ») et l'en-tête `List-Unsubscribe` sont ajoutés par défaut.
- La **liste d'opposition** (adresse, domaine ou établissement) bloque tout envoi, annule les messages en attente et survit à la suppression des données.
- **Plafonds** quotidiens et par campagne, intervalle minimal entre deux envois de la file, pause automatique après erreurs répétées, arrêt de la file en cas de quota atteint : aucune technique de contournement des protections anti-spam.
- **Export** complet (JSON/CSV) et **suppression** (résultats non retenus, données anciennes, tout) depuis Paramètres > Données.
- Robots.txt respecté, une requête par seconde par site, quelques pages publiques seulement : pas de scraping massif. Les annuaires dont les conditions interdisent l'extraction automatique (Pages Jaunes, LinkedIn…) ne sont **pas** utilisés.

## 5. Sécurité

- Serveur accessible uniquement depuis l'ordinateur (`127.0.0.1`).
- Mot de passe d'application (haché scrypt), session de 30 jours, limitation des tentatives.
- Protection CSRF (en-tête obligatoire sur toute modification), Content-Security-Policy stricte, échappement systématique des données externes à l'affichage.
- Jetons OAuth, clés API et mot de passe SMTP chiffrés en AES-256-GCM avec une clé locale (`data/cle-locale.key`) distincte de la base. Ce chiffrement protège une copie isolée de la base ; il ne protège pas contre quelqu'un ayant un accès complet à votre session Windows.
- Sauvegarde automatique quotidienne de la base (14 conservées) et avant toute suppression.

## 6. Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 1 — MVP | Recherche par zone et mots-clés, import CSV, liste de prospects, contacts, templates à variables, génération, écran de validation, envoi réel, historique et statuts | **Livré** |
| 2 — Enrichissement | Identification des décideurs (RNE + site), scoring explicable, signaux, relances, statistiques de conversion, file d'envoi pour volumes plus importants | **Livré** (version initiale) |
| 2 — reste à faire | Détection des réponses pour Outlook (Microsoft Graph `Mail.ReadBasic`) ; vérification d'adresse sans Hunter | À intégrer |
| 3 — Optimisation | Suggestions d'amélioration des templates selon les résultats, recommandations de ciblage, alertes sur nouvelles ouvertures ou offres d'emploi, aide à la rédaction de l'accroche par IA (avec relecture obligatoire) | À intégrer |

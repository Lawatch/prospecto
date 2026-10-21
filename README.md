# Prospecto

Application web personnelle de **prospection et de candidatures spontanées** : recherche d'établissements par zone, identification des décideurs, génération de candidatures personnalisées, **validation humaine de chaque e-mail avant envoi**, envoi depuis votre messagerie, suivi, relances et statistiques.

Pensée pour la recherche d'un poste à responsabilités en hôtellerie (direction adjointe, responsable d'exploitation, centre de profit…), mais configurable pour d'autres secteurs (types d'établissement, codes NAF, étiquettes OpenStreetMap, modèles).

> **Aucun e-mail ne part sans votre clic.** La préparation d'une campagne ne déclenche jamais d'envoi ; chaque message passe par l'écran de validation.

## Ouvrir Prospecto (rien à installer)

**👉 https://lawatch.github.io/prospecto/**

Ouvrez ce lien dans Chrome, Edge ou Firefox, puis ajoutez-le à vos favoris. Pour une icône sur le bureau sans rien installer : faites glisser le petit cadenas situé à gauche de l'adresse vers le bureau (cela crée un simple raccourci internet).

- **Aucune installation, aucun droit administrateur** : tout fonctionne dans le navigateur.
- **Vos données restent dans ce navigateur**, sur cet ordinateur. Téléchargez régulièrement une sauvegarde (Paramètres > Données et sauvegarde) : un seul fichier, que vous pourrez restaurer sur un autre ordinateur.
- **Envoi** : chaque candidature s'ouvre pré-remplie dans votre Gmail ou votre Outlook (dans le navigateur) ; vous cliquez sur « Envoyer », puis vous confirmez dans Prospecto. Aucun mot de passe ni configuration.
- N'ouvrez Prospecto que dans **un seul onglet** à la fois (l'application le vérifie).

Différences avec la version installée : les sites des établissements ne peuvent pas être lus automatiquement par un navigateur (protection CORS). Sur la fiche d'un établissement, utilisez « Coller le texte du site » : Prospecto extrait les adresses, les noms et les signaux du texte copié. L'envoi SMTP et la connexion Outlook directe n'existent que dans la version installée.

## Version installée (facultative, pour un ordinateur personnel)

1. Installez **Node.js** version LTS (22 ou plus récent) : <https://nodejs.org/fr/download>.
2. Téléchargez ce dossier (bouton « Code > Download ZIP » sur GitHub) et décompressez-le dans un emplacement stable, par exemple `Documents\Prospecto`.
3. Lancez l'installateur :
   - **Windows** : double-cliquez sur `Installer-Windows.bat`. Un raccourci **Prospecto** est créé sur le bureau (et, si vous le souhaitez, au démarrage de Windows).
   - **macOS** : clic droit sur `Installer-macOS.command` > Ouvrir.
   - **Linux** : `./installer-linux.sh`.
4. Au premier lancement, choisissez un mot de passe (il protège vos données ; vous restez connecté 30 jours).

### Utilisation quotidienne : deux clics

Double-cliquez sur l'icône **Prospecto** du bureau : le service démarre en arrière-plan (s'il ne tourne pas déjà) et l'application s'ouvre dans votre navigateur à l'adresse <http://127.0.0.1:3737>. Vous pouvez aussi l'ajouter à vos favoris.
Pour arrêter le service : `launcher\Arreter-Prospecto.vbs` (Windows) ou `node launcher/launcher.js --stop`.

## Premiers pas

1. **Paramètres > Profil** : présentation, compétences, réalisations chiffrées, signature. Ces textes alimentent les modèles ; rien n'est inventé ni reformulé automatiquement.
2. **Paramètres > CV et pièces jointes** : ajoutez votre CV (PDF).
3. **Paramètres > Messagerie** : connectez Gmail, Outlook ou un serveur SMTP — guide pas à pas : [docs/CONNEXION-MESSAGERIE.md](docs/CONNEXION-MESSAGERIE.md). Envoyez-vous un e-mail de test.
4. **Recherche** : ville de départ, rayon, types d'établissement → sélectionnez les résultats pertinents → « Ajouter et enrichir ».
5. **Prospects / fiche établissement** : vérifiez les contacts trouvés (source et fiabilité affichées), corrigez-les, rédigez une **accroche** fondée sur un fait vérifiable.
6. **Campagnes > Nouvelle campagne** : choisissez le poste visé ; les messages sont générés et placés « En attente de validation ».
7. **Validation** : relisez et modifiez chaque message (destinataire, objet, corps, signature, pièces jointes), puis « Envoyer cet e-mail », « Enregistrer comme brouillon », « Ignorer ce prospect » ou « Passer au suivant ». Option : « Valider pour la file » puis lancer l'envoi groupé des seuls messages validés depuis **Campagnes** (cadencé, plafonné).
8. **Historique** : qualifiez les réponses (positive, négative, entretien, refus, ne plus contacter). **Relances** : préparez les relances dues, elles repassent par la validation. **Statistiques** : taux de réponse et d'entretien par type d'établissement, modèle et fonction ciblée.

## Ce qui est livré

| Fonction | État |
|---|---|
| Recherche par zone/rayon/types/mots-clés (OpenStreetMap + SIRENE, Google Places en option), carte, dédoublonnage entre sources et entre recherches, source et date de collecte | Opérationnel |
| Liste de prospects : filtres, tris, actions groupées, import/export CSV, fiche détaillée, historique des actions | Opérationnel |
| Décideurs : dirigeants déclarés (RNE), personnes citées sur le site officiel (mentions légales), adresses publiées sur le site, Hunter.io en option ; fiabilité, statut d'adresse, contrôle MX, correction manuelle | Opérationnel |
| Score sur 100 explicable (7 critères pondérables), signaux d'opportunité signalés comme « à vérifier » | Opérationnel |
| Modèles avec variables et blocs conditionnels, profil central, aperçu en direct, pièces jointes, 7 modèles + 1 relance fournis | Opérationnel |
| Génération de campagne : choix du modèle et de l'interlocuteur, contrôles (variables non remplacées, doublons, opposition, adresse invalide ou non vérifiée, domaine incohérent…) | Opérationnel |
| Écran de validation un par un, modification directe, mode série, file d'envoi des seuls messages validés | Opérationnel |
| Envoi Gmail / Outlook / SMTP, plafonds jour/campagne, anti-double envoi, pause automatique après erreurs, résultat incertain signalé | Opérationnel — voir « Tests » |
| Relances dans le même fil, exclusions automatiques ; détection des réponses et rejets (Gmail) | Opérationnel |
| Tableau de bord, statistiques (envoyé ≠ délivré, réponse ≠ positive) | Opérationnel |
| Liste d'opposition, export, suppression, sauvegardes quotidiennes, chiffrement des secrets | Opérationnel |
| Détection des réponses Outlook, recommandations de ciblage, optimisation des modèles selon les résultats, alertes | À intégrer (phase 3) |

Architecture détaillée, coûts et **limites des sources** : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tests

```bash
npm install
npm test
```

29 tests automatisés : unitaires (rendu des modèles, extraction sur les sites, robots.txt, correspondances OSM/SIRENE, scoring…) et **de bout en bout** via l'API HTTP réelle de l'application, contre de faux services reproduisant le format des API externes : recherche multi-sources et fusion des doublons, enrichissement depuis un site (robots.txt respecté), génération sans envoi, contrôles bloquants, envoi unique même en cas de double clic, liste d'opposition, pause après 3 erreurs, résultat incertain, file d'envoi limitée aux messages validés, plafond quotidien, relance dans le même fil, statistiques, export sans secrets.

**À vérifier sur votre ordinateur** (l'environnement de développement n'avait pas accès à Internet) : premier appel réel aux API OpenStreetMap, SIRENE et géocodage, et premier envoi réel. Faites une recherche sur votre ville et envoyez-vous l'e-mail de test (Paramètres > Messagerie) avant toute campagne.

## Dépannage

- **L'icône n'ouvre rien** : vérifiez que Node.js est installé (`node -v` dans une invite de commandes), puis consultez `data/prospecto.log`.
- **« Port déjà utilisé »** : Prospecto tourne déjà ; ouvrez <http://127.0.0.1:3737>.
- **Mot de passe de l'application oublié** : arrêtez Prospecto, ouvrez une invite de commandes dans le dossier et tapez `npm run reset-password` ; vous pourrez en choisir un nouveau (vos données sont conservées).
- **Gmail se déconnecte au bout de 7 jours** : publiez l'application OAuth (voir le guide de connexion).
- **Données** : tout est dans le dossier `data/` (base, pièces jointes, sauvegardes, clé de chiffrement). Copiez ce dossier pour sauvegarder ou changer d'ordinateur.

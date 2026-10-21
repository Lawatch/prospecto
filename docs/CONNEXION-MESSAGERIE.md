# Connecter votre messagerie (une seule fois)

Prospecto envoie les candidatures **depuis votre propre adresse**, via l'API officielle de votre messagerie. Votre mot de passe n'est jamais demandé : vous autorisez l'application sur la page de connexion de Google ou Microsoft.

## Gmail / Google Workspace (≈ 10 minutes)

1. Ouvrez <https://console.cloud.google.com/> et créez un projet (ex. « Prospecto »).
2. Menu **API et services > Bibliothèque** : recherchez **Gmail API** et cliquez sur **Activer**.
3. **API et services > Écran de consentement OAuth** (ou « Google Auth Platform ») :
   - type d'utilisateur **Externe** (ou **Interne** pour un compte Google Workspace d'entreprise) ;
   - nom de l'application : Prospecto ; adresse d'assistance : la vôtre ;
   - **Utilisateurs test** : ajoutez votre propre adresse Gmail.
4. **API et services > Identifiants > Créer des identifiants > ID client OAuth** :
   - type d'application : **Application de bureau** ;
   - copiez l'**ID client** et le **Code secret du client**.
5. Dans Prospecto : **Paramètres > Messagerie > Gmail**, collez les deux valeurs, **Enregistrer**, puis **Connecter Gmail**. Acceptez l'écran Google (il signale une application « non validée » : c'est normal, c'est la vôtre).
6. **Paramètres > Messagerie > Tester l'envoi** : vous devez recevoir l'e-mail de test.

> **Important — mode « Test » de Google** : tant que l'application reste en statut « Test », Google invalide l'autorisation au bout de **7 jours** ; il faut alors cliquer de nouveau sur « Reconnecter Gmail ». Pour éviter cela, sur l'écran de consentement, cliquez sur **Publier l'application** (statut « En production ») : pour un usage personnel, vous continuerez à voir l'avertissement « application non validée » à la connexion, mais l'autorisation n'expirera plus.

Option : **Détecter les réponses et les rejets** (Paramètres > Messagerie) ajoute l'autorisation `gmail.metadata` (expéditeur et date des messages, sans leur contenu), puis **reconnectez Gmail**.

## Outlook / Microsoft 365 (≈ 10 minutes)

1. Ouvrez <https://entra.microsoft.com/> > **Applications > Inscriptions d'applications > Nouvelle inscription**.
2. Nom : Prospecto ; types de comptes : **Comptes dans un annuaire organisationnel et comptes Microsoft personnels**.
3. URI de redirection : plateforme **Client public / natif (mobile et bureau)**, valeur affichée dans Prospecto (`http://localhost:3737/oauth/microsoft/callback`).
4. **Autorisations de l'API > Ajouter > Microsoft Graph > Autorisations déléguées** : `Mail.Send`, `User.Read`, `offline_access`.
5. Copiez l'**ID d'application (client)** dans Prospecto (Paramètres > Messagerie > Outlook), **Enregistrer**, **Connecter Outlook**.

Un compte Microsoft 365 d'entreprise peut exiger l'accord d'un administrateur.

## SMTP (OVH, Ionos, o2switch…)

Renseignez le serveur, le port (587 en général, 465 en SSL), l'identifiant et un **mot de passe d'application** si votre fournisseur le propose. Le mot de passe est chiffré. Selon le fournisseur, la copie des messages dans « Envoyés » n'est pas automatique.

## Plafonds conseillés

| Messagerie | Limite du fournisseur | Plafond retenu par Prospecto | Conseil |
|---|---|---|---|
| Gmail grand public | ~500 / jour | 400 max. | 20 à 40 candidatures / jour |
| Google Workspace | ~2 000 / jour | 1 500 max. | 30 à 60 / jour |
| Outlook.com | ~300 / jour | 250 max. | 20 à 40 / jour |

Des candidatures personnalisées, en volume modéré et régulier, sont mieux délivrées et mieux lues qu'un envoi massif.

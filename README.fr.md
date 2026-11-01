# Métis Server

**Vos documents de recherche et vos routines d’audit, sur votre propre machine.**

[English](README.md) · [Configuration](docs/configuration.md) · [Sauvegardes](docs/backup.md)

Cette première version publique réunit un espace de documents versionnés, des
travaux persistants, un connecteur MCP authentifié et un Security Center autonome.
Elle ne dépend ni d’Atlas, ni d’un compte Plagnito, ni d’un Raspberry Pi prédéfini.

## Installation en quelques commandes

```sh
git clone https://github.com/Plagnito/metis-server.git
cd metis-server
docker compose up -d --build
docker compose logs metis
```

Ouvrez **http://localhost:4880**, récupérez le code d’installation dans les journaux,
puis créez votre administrateur. Le code est utilisable une seule fois.

Dans **Configuration** :

1. Choisissez les modules, le nom et le fuseau de votre instance.
2. Indiquez les dépôts GitHub que vous autorisez, un par ligne.
3. Pour les dépôts privés, renseignez un jeton à permissions fines ou votre GitHub App.
4. Choisissez OpenAI, Anthropic ou une API compatible, puis le modèle et sa clé.
5. Enregistrez et testez les connexions.
6. Dans **Routines**, choisissez un dépôt, un horaire et les limites avant activation.

Aucun fichier à modifier pour commencer. Aucun appel IA au premier démarrage et
aucune routine active par défaut. Le test de connexion IA effectue un petit appel
au fournisseur choisi.

Avec Node.js 24 ou plus récent, vous pouvez aussi lancer simplement `npm start`.
Sous Windows, `Start-Metis.cmd` ouvre le serveur dans un terminal. Il n’y a aucune
dépendance npm de production à installer ni de frontend à compiler.

## Une première version d’analyse statique

Le serveur lit le code à un commit précis et conserve ses observations, les fichiers
lus et les preuves. Il **n’exécute aucun code du dépôt** : pas de shell, installation
de dépendances, tests, correction automatique, création ou fusion de PR. Le runner
isolé est prévu comme extension ultérieure.

Les signalements doivent être relus. La gravité est déclarée ; une preuve textuelle
ne devient pas un test exécuté. Les rapports indiquent leur couverture et leurs
limites. Une PR fusionnée passe dans le suivi des corrections, sans être assimilée
à une revalidation indépendante.

Les adaptateurs IA ont été vérifiés avec des réponses simulées. Le test intégré
confirme les droits et l’appel d’outils du modèle que vous configurez réellement.
La connexion d’un client MCP et l’accès API des routines autonomes sont deux
configurations distinctes.

## Données, accès et routines

La base, les identifiants et la clé d’instance restent dans votre volume de données.
Les secrets sont chiffrés au repos ; l’administrateur de la machine conserve le
contrôle du serveur et de sa clé. Les extraits de code lus pour un audit sont
transmis au fournisseur IA configuré. Certains fichiers sensibles usuels sont
exclus, sans prétendre détecter tous les secrets pouvant se trouver dans du code.

Le port Docker est lié à la boucle locale. Pour un accès distant, configurez un
proxy ou tunnel HTTPS puis l’adresse publique de votre instance.

Le tableau de bord gère vos clés MCP et applications OAuth. Les clés peuvent
être limitées à la lecture, à l’écriture et à l’un des modules, puis révoquées.
L’instance appartient à un administrateur ; ce n’est pas une plateforme de clients
indépendants partageant la même base.

Une routine vise un dépôt et un horaire quotidien. La file persiste sur disque et
un seul travail s’exécute à la fois. Les budgets limitent appels, jetons, lectures,
quantité de source et durée. Le serveur réserve une borne de consommation avant
un appel puis la rapproche de l’usage déclaré. Il ne s’agit pas d’un plafond en
euros garanti. Les erreurs et interruptions restent visibles, sans être présentées
comme un audit réussi.

## Mettre à jour, sauvegarder, vérifier

```sh
git pull --ff-only
docker compose up -d --build
```

Faites une sauvegarde avant une mise à jour. Le [guide de sauvegarde](docs/backup.md)
explique comment conserver la base et sa clé, vérifier le manifeste puis restaurer
dans un dossier neuf.

Pour les développeurs :

```sh
npm test
npm run check:release
```

Les tests n’utilisent que des données synthétiques et des fournisseurs simulés.
Le [compte rendu de validation](docs/validation.md) distingue les vérifications
effectuées des compatibilités restant à confirmer sur du matériel ou des comptes réels.

Le module de recherche couvre documents, versions, travaux et notes. Il n’importe
pas automatiquement la base Atlas et ne reproduit pas son registre scientifique
complet, ses missions inter-agents ou l’installation personnelle de Métis Lab.

Licence **AGPLv3 uniquement**, choisie par le propriétaire du projet.

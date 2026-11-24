# Solex Live — Version 2

Suivi en direct et chronométrage pour l'endurance Solex (6 h à 24 h).

- **Carte live** (fond satellite ou plan) : le Solex, sa vitesse, le fil d'Ariane et l'état (En piste / Aux stands / Arrêté / Alerte).
- **Chronométrage automatique**, avec interpolation du passage de ligne entre deux points GPS : tour en cours, dernier et meilleur tour, secteurs, tableau des tours, export CSV.
- **Arrêts aux stands** : heure d'entrée et de sortie, durée et temps total.
- **Alertes** : arrêt (< 3 km/h pendant 10 s hors stands) et perte de signal, avec bandeau, marqueur, alarme sonore et acquittement.
- **Écran stands** géant, **thème Plein soleil**, **réglages** des alertes.
- **Éditeur de circuit** : tracé, ligne d'arrivée, portes secteur, zone des stands, import et export.
- **Simulateur** intégré pour essayer sans rouler.
- **V2 — course en ligne** :
  - **téléphone embarqué** : page émetteur avec GPS, écran maintenu allumé et file d'attente en cas de coupure réseau ;
  - **appairage par QR code** ;
  - **historique gardé sur le serveur** : on reprend la course sur n'importe quel PC avec tout l'historique (tours, arrêts, incidents) ;
  - **isolation par équipe**.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir ensuite http://localhost:5173. `npm test` lance les tests et `npm run build` produit la version de production dans `dist/`.

Sans serveur configuré, la course en ligne fonctionne en **mode test local** : tout reste dans le navigateur, et deux onglets du même navigateur peuvent jouer le stand et le téléphone.

## Mise en place du serveur (Supabase, gratuit) — une seule fois

1. Créer un compte sur [supabase.com](https://supabase.com), puis un projet (nom libre, région Europe, par exemple Paris).
2. Dans le projet : **SQL Editor → New query**, coller tout le contenu de [`supabase/schema.sql`](supabase/schema.sql), puis **Run**.
3. Récupérer, dans **Project Settings → API** (ou le bouton **Connect**) :
   - l'**URL du projet** (`https://xxxx.supabase.co`) ;
   - la **clé publique** (*publishable key* `sb_publishable_…`, ou l'ancienne clé *anon public*). **Jamais** la clé secrète ou *service_role*.
4. **Sur votre PC** : copier `.env.example` en `.env.local`, y coller ces deux valeurs, puis relancer `npm run dev`.
5. **Sur Render** : service → **Environment**, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_KEY`, puis **Manual Deploy**. Les valeurs sont intégrées au site au moment de la construction.

La clé publique peut se trouver dans le site : les tables sont fermées et tout passe par des fonctions qui exigent les identifiants de la course.

## Le jour de la course

1. **PC stand** : onglet Live, choisir le circuit, saisir le nom de l'équipe dans « Course en ligne », puis **Créer**.
2. **Téléphone embarqué** : scanner le QR code (« 📱 Appairer le téléphone »), ouvrir le lien, puis **Démarrer l'émission**. Autoriser la localisation précise.
   - Téléphone branché sur une batterie, page ouverte et au premier plan, écran allumé. La page demande elle-même à garder l'écran allumé.
   - Le bouton « Tester sans rouler » fait rouler un Solex simulé sur le circuit de la course, pour vérifier la liaison depuis le stand.
3. **Copier le lien stand** et le garder en lieu sûr (SMS, mail à l'équipe…).
   - PC planté ? On ouvre ce lien sur un autre PC : toute la course est reconstruite en quelques secondes et le suivi continue.
   - Le même PC rouvert reprend automatiquement la dernière course.
4. **Lien spectateur** : suivi en lecture seule, pour la famille ou une autre tablette.

Liens et sécurité :
- Les liens contiennent les identifiants de la course après le `#` : ils ne sont jamais transmis à l'hébergeur.
- Le lien stand et le lien téléphone permettent d'écrire. Le lien spectateur permet seulement de lire.
- Chaque équipe a ses propres identifiants aléatoires : les équipes ne voient pas les données des autres.

## Application Android « Solex Émetteur » (recommandée pour le téléphone embarqué)

Le dossier [`emetteur-android/`](emetteur-android) contient une application Android (Expo) qui remplace la page émetteur web. Elle a deux avantages :

- **envoi écran éteint** : un service Android natif (`modules/solex-tracker`, en Kotlin), signalé par la notification « Solex Live — émission en cours », lit le GPS chaque seconde, garde la file d'attente dans un fichier et envoie lui-même les points. Il ne dépend pas de l'écran de l'application. Testé en arrière-plan, écran éteint, en veille profonde (Doze) et pendant une coupure réseau ;
- **appairage** : on scanne le QR code du PC stand directement depuis l'application.

Elle envoie les points au même serveur, avec la même file d'attente en cas de coupure réseau. Le PC stand et la reprise de course ne changent pas.

**Installation** : copier `solex-emetteur.apk` (à la racine du projet, non envoyé sur GitHub) sur le téléphone (câble USB, Google Drive, e-mail…) et l'ouvrir. Android demande d'autoriser l'installation d'applications « de sources inconnues » pour l'application utilisée (Fichiers, Drive…).

**Réglages au premier lancement** :
1. localisation **« Toujours autoriser »** et **position exacte** ;
2. bouton **« Désactiver l'économie de batterie pour l'appli »**, puis **Autoriser** ;
3. sur certains téléphones (Xiaomi, Huawei, Samsung, Oppo…), autoriser aussi le **démarrage automatique** et le **fonctionnement en arrière-plan** dans les réglages de l'appli. Voir https://dontkillmyapp.com.

**Usage** : Scanner le QR code → Démarrer l'émission → on peut éteindre l'écran. **Ne pas fermer l'application depuis la liste des applis récentes.**

**Reconstruire l'APK** (après une modification) :

```powershell
cd emetteur-android
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease
```

L'APK est produit dans `emetteur-android/android/app/build/outputs/apk/release/app-release.apk`.

## Mise en ligne (GitHub + Render)

1. Envoyer le dossier sur GitHub, sans `node_modules`, `dist`, `.claude` ni `.env.local`.
2. Sur Render : **New → Blueprint**, choisir le dépôt (`render.yaml` configure tout), puis renseigner les deux variables Supabase.
3. Chaque envoi sur GitHub redéploie automatiquement le site.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/lib/tracker.js` | Moteur de suivi : il calcule tours, secteurs, arrêts, état et alertes à partir des points GPS. `replay()` reconstruit une course entière (24 h ≈ 86 000 points, environ 0,1 s). |
| `src/lib/api.js` | Accès au serveur (Supabase) ou mode test local. Gère aussi les liens de course. |
| `src/lib/liveSource.js` | PC stand : charge l'historique, le rejoue, puis récupère les nouveaux points chaque seconde. |
| `src/lib/uplink.js` | Téléphone : file d'attente des points, gardée dans le téléphone, envoyée par paquets. |
| `src/components/Transmitter.jsx` | Page émetteur du téléphone. |
| `src/components/OnlinePanel.jsx` | Création ou reprise d'une course, QR code et liens. |
| `src/lib/simulator.js` | Solex virtuel (1 point GPS par seconde). |
| `src/lib/geo.js` | Géométrie (distances, passage des portes, zone des stands). |
| `supabase/schema.sql` | Tables et fonctions du serveur. |

## Limites connues

- **iPhone** : la position n'est envoyée que si la page est **au premier plan**, écran allumé. Ne pas verrouiller le téléphone.
- **Délai d'affichage** : environ 1 à 2 s entre le téléphone et le stand.
- **Acquittement** : il est propre à chaque écran. Acquitter sur un PC ne coupe pas l'alarme des autres.
- **Modifications du circuit** en cours de course : elles sont partagées si on a le lien stand, et tous les PC recalculent l'historique avec le nouveau circuit.
- **À venir** : vue direction de course avec toutes les équipes sur une même carte.

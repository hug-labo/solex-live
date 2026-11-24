# Solex Live — Version 1

Suivi en direct et chronométrage pour l'endurance Solex. Cette **V1** fonctionne entièrement dans le navigateur, sans serveur ni compte. Elle contient :

- la **carte live** (fond satellite ou plan), avec le Solex, sa vitesse, le fil d'Ariane des 30 dernières secondes et l'état (En piste / Aux stands / Arrêté / Alerte) ;
- l'**éditeur de circuit** : tracé, ligne de départ/arrivée, portes secteur (triées automatiquement dans l'ordre de passage), zone des stands, sauvegarde automatique, export et import JSON ;
- le **chronométrage automatique**, avec interpolation du franchissement entre deux points GPS : tour en cours, dernier tour, meilleur tour, secteurs et tableau des tours ;
- les **alertes** : arrêt (< 3 km/h pendant 10 s hors stands) et perte de signal (6 s sans données), avec bandeau clignotant, marqueur sur la carte, alarme sonore répétée et bouton d'acquittement ;
- l'**écran des stands** (bouton « ⛶ Écran stands ») : plein écran avec chrono géant, écart et meilleur tour, Échap pour quitter ;
- l'**écart en direct** sur le meilleur tour, à chaque porte franchie ;
- le **thème « Plein soleil »**, clair et à fort contraste ;
- les **réglages des alertes** (seuil, délais, fil d'Ariane), modifiables en cours de session ;
- l'**export CSV** des tours, lisible dans Excel en français ;
- le **simulateur** : vitesse réglable de 40 à 110 km/h (ralentit dans les virages), accélération du temps ×1 à ×10, panne, passage aux stands, coupure du signal.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir ensuite http://localhost:5173. Commandes utiles :

- `npm test` : tests du moteur de chrono et d'alertes ;
- `npm run build` : version de production dans `dist/`, à déployer sur n'importe quel hébergement statique (Vercel, Render Static Site, Netlify, OVH…).

## Mise en ligne (GitHub + Render)

1. Créer un dépôt sur GitHub et y envoyer le dossier, **sans** `node_modules` ni `dist` (le `.gitignore` les exclut).
2. Sur Render : **New → Blueprint**, choisir le dépôt. Le fichier `render.yaml` configure tout. Sinon, **New → Static Site** avec :
   - Build Command : `npm install && npm run build`
   - Publish Directory : `dist`
3. Chaque envoi sur GitHub redéploie automatiquement le site.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/lib/tracker.js` | Moteur de suivi : il reçoit les points GPS et calcule tours, secteurs, état et alertes. Il ne dépend ni de React ni de la carte. |
| `src/lib/simulator.js` | Solex virtuel qui émet des points GPS à 1 Hz. |
| `src/lib/geo.js` | Géométrie : distances, intersection avec les portes, point dans un polygone. |
| `src/lib/storage.js` | Sauvegarde des circuits dans le navigateur, import et export. |
| `src/lib/sound.js` | Alarme sonore générée par Web Audio. |
| `src/components/` | Interface : carte, tableau de bord, éditeur, bandeau d'alerte. |

## Remarques

- **Son** : les navigateurs bloquent le son tant que l'utilisateur n'a pas cliqué sur la page. Cliquer sur « Activer le son » en arrivant aux stands.
- **Modifications du circuit** : elles s'appliquent au suivi en revenant sur l'onglet Live, et la session en cours est alors remise à zéro.
- **Tours avec arrêt aux stands** : ils sont marqués « stand » et exclus du meilleur tour.

## Suite prévue (V2)

Page émetteur pour le téléphone embarqué (GPS + Wake Lock), appairage par QR code et relais temps réel (Supabase), avec isolation par équipe. Le simulateur et le téléphone alimenteront le même `RaceTracker.push()`.

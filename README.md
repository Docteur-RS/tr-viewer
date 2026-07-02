# TR Viewer

Visualisation de relevés de transactions Trade Republic, avec graphiques et suivi par ETF.

## Lancer

```bash
# Option 1
npx serve .

# Option 2
python3 -m http.server 8080
```

Puis ouvrir http://localhost:8080 dans le navigateur.

## Utilisation

- Le fichier `transaction.csv` est chargé automatiquement au démarrage
- Pour importer un autre CSV, utiliser le bouton "Importer CSV" dans la sidebar
- Le CSV doit être au format exporté par Trade Republic

## Vues

### Dashboard
Vue d'ensemble du portfolio : KPIs (valeur, investi, P&L, dépôts, intérêts, frais), graphique de la valeur dans le temps vs montant investi, répartition par ETF, et tableau des positions cliquable.

### Par ETF
Fiche détaillée pour chaque ETF : KPIs, graphique d'évolution du prix et des parts cumulées, historique des transactions. Accessible via la sidebar ou en cliquant sur une ligne du tableau des positions.

### Transactions
Historique complet filtrable par catégorie (Tout / Trading / Cash).

## Stack

- Vanilla HTML/CSS/JS, aucune dépendance build
- [Chart.js](https://www.chartjs.org/) pour les graphiques
- [PapaParse](https://www.papaparse.com/) pour le parsing CSV
- Polices : Instrument Serif, DM Sans, JetBrains Mono

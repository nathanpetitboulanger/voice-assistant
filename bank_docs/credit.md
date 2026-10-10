# Crédit : prêt personnel, auto, travaux, immobilier, simulation

Contenu d'exemple pour la démo : les taux, montants et délais de cette fiche sont
fictifs.

## Clarifier le projet

L'objet du crédit (voiture, travaux, achat immobilier, projet personnel), le montant,
la durée souhaitée, et pour l'immobilier l'apport et les revenus mensuels nets.

## Les options

- Prêt personnel : de 1 000 à 75 000 euros, sur 12 à 84 mois, TAEG fixe de 5,9 %.
- Prêt auto, véhicule neuf ou d'occasion : de 3 000 à 75 000 euros, sur 12 à 84 mois,
  TAEG fixe de 4,9 %.
- Prêt travaux : de 1 500 à 75 000 euros, sur 12 à 120 mois, TAEG fixe de 4,5 %.
  Pour la rénovation énergétique : TAEG de 3,9 %, et éco-prêt à taux zéro possible
  jusqu'à 50 000 euros sous conditions.
- Prêt immobilier : de 50 000 à 1 000 000 d'euros, sur 7 à 25 ans, taux indicatif de
  3,4 % hors assurance. Apport conseillé : 10 % du prix. Les mensualités de tous les
  crédits ne doivent pas dépasser 35 % des revenus. Étudié avec un conseiller.
- L'assistant ne propose pas de crédit renouvelable.

## Étapes

1. Simulation immédiate et sans engagement (simulate_loan) : mensualité, taux, coût
   total.
2. Prêt personnel, auto ou travaux : l'assistant peut déposer la demande
   (start_request, type loan_application). Réponse de principe par SMS sous 48 heures,
   contrat lisible avec un lecteur d'écran, signature électronique. Délai de
   rétractation : 14 jours.
3. Prêt immobilier : rendez-vous avec un conseiller crédit immobilier
   (start_request, type appointment, ou transfer_to_advisor, équipe mortgage). Pièces :
   3 derniers bulletins de salaire, dernier avis d'imposition, 3 mois de relevés de
   compte, compromis de vente. Délai de réflexion de 10 jours après réception de l'offre.

## Mention obligatoire

Après toute simulation ou proposition de crédit à la consommation, dire : « Un crédit
vous engage et doit être remboursé. Vérifiez vos capacités de remboursement avant de
vous engager. »

## Difficultés de remboursement

Report ou baisse d'échéances possibles : passer la main à un conseiller
(transfer_to_advisor, équipe advisor).

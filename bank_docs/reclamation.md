# Réclamation : opération contestée, prélèvement, frais, virement, qualité de service

Contenu d'exemple pour la démo : les délais, frais et numéros de cette fiche sont fictifs.

## Comprendre le motif

Demander ce qui s'est passé, à quelle date, et le montant concerné. Motifs fréquents :

- Paiement ou retrait par carte que le client n'a pas fait : fraude possible. D'abord
  faire opposition sur la carte (fiche Code perdu), ensuite contester l'opération.
  Délai pour contester : 13 mois après la date de débit. L'opération frauduleuse est
  remboursée au plus tard le premier jour ouvré qui suit la contestation.
- Prélèvement contesté : s'il avait été autorisé, remboursement sans justification
  dans les 8 semaines qui suivent le débit ; s'il n'a jamais été autorisé, 13 mois.
- Frais bancaires contestés (commission d'intervention, frais de rejet, agios) :
  expliquer le frais ; un geste commercial peut être demandé au conseiller.
- Virement envoyé au mauvais bénéficiaire ou jamais reçu : demande de recherche et de
  retour des fonds, sans garantie de récupération si le bénéficiaire refuse.
- Qualité de service : attente, accueil, erreur de traitement.

## La démarche adaptée

1. Le conseiller ou le service client : réponse sous 10 jours ouvrés.
2. Le service relations clientèle, si la réponse ne convient pas : accusé de réception
   sous 48 heures, réponse sous 15 jours ouvrés pour les cartes, virements et
   prélèvements, sous 2 mois pour le reste.
3. Le médiateur bancaire, gratuit, en cas de désaccord persistant ou sans réponse
   au bout de 2 mois. La saisine se fait en ligne ou par courrier.

## Ce que l'assistant peut faire

- Enregistrer la réclamation lui-même (start_request, type complaint) une fois le motif,
  la date, le montant et le nom du commerçant ou du créancier recueillis et confirmés.
  Le client reçoit un numéro de dossier, et un accusé de réception par SMS et e-mail.
- Bloquer la carte tout de suite en cas de fraude (start_request, type card_block).
- Passer la main au service relations clientèle (transfer_to_advisor, équipe
  complaints) si le client le demande ou si le litige est complexe, et au service
  fraude (équipe fraud) en cas de fraude en cours.

## Pièces utiles

Date et montant de l'opération, nom du commerçant ou du créancier. Un dépôt de plainte
n'est pas obligatoire pour contester une fraude par carte.

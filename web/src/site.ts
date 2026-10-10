// The public site's content: no figures here (rates, fees, delays), the assistant
// gives them from the bank's procedure sheets (bank_docs/), so they can't drift apart.

export const BRAND = "Banque Populaire";

export type Topic = {
  id: string;
  title: string;
  text: string;
  questions: string[]; // asked to the assistant, in writing, when tapped
};

export const TOPICS: Topic[] = [
  {
    id: "code_perdu",
    title: "Carte ou code perdu",
    text:
      "Code oublié, mot de passe, carte perdue ou volée : l'assistant vous guide, fait " +
      "opposition avec votre accord, et ne vous demande jamais votre code.",
    questions: ["J'ai perdu ma carte bancaire", "J'ai oublié le code de ma carte"],
  },
  {
    id: "credit",
    title: "Crédit",
    text:
      "Voiture, travaux, logement : cinq questions, une simulation immédiate et sans " +
      "engagement, puis un conseiller crédit vous rappelle.",
    questions: [
      "Je voudrais emprunter 10 000 euros pour une voiture",
      "Comment fonctionne un prêt travaux ?",
    ],
  },
  {
    id: "reclamation",
    title: "Réclamation",
    text:
      "Opération inconnue, frais ou prélèvement contestés : l'assistant recueille les " +
      "faits, transmet votre réclamation et vous remet un récapitulatif en PDF.",
    questions: [
      "On m'a prélevé des frais que je ne comprends pas",
      "Je ne reconnais pas une opération sur mon compte",
    ],
  },
  {
    id: "gestion_privee",
    title: "Épargne et patrimoine",
    text:
      "Livrets, assurance vie, gestion privée : l'assistant vous explique les options " +
      "et vous met en relation avec le bon conseiller.",
    questions: ["J'ai hérité, que faire de cet argent ?", "Quelle épargne pour mettre de côté ?"],
  },
];

// Under the greeting of a new text chat.
export const SUGGESTIONS = [
  "J'ai perdu ma carte",
  "Simuler un crédit",
  "Faire une réclamation",
  "Épargner",
];

// From the need to « c'est fait » (bank_assistant.py's five steps).
export const STEPS = [
  { title: "Vous dites", text: "Votre besoin, avec vos mots, à voix haute ou par écrit." },
  {
    title: "Il explique",
    text: "D'après les fiches de la banque, sans jargon. Un mot inconnu ? Il l'explique.",
  },
  {
    title: "Il agit",
    text: "Simulation, opposition, réclamation : il le fait pour vous, avec votre accord.",
  },
  {
    title: "Il transmet",
    text: "À un conseiller qui a tout le contexte : vous n'avez rien à répéter.",
  },
];

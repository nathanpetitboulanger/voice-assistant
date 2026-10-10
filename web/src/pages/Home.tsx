import {
  ArrowRight,
  AudioLines,
  Calculator,
  CreditCard,
  Keyboard,
  Lock,
  MessageSquareWarning,
  Mic,
  PiggyBank,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Intent } from "../assistant/Assistant";
import { STEPS, TOPICS } from "../site";
import { Footer } from "./Footer";

const TOPIC_ICONS: Record<string, LucideIcon> = {
  code_perdu: CreditCard,
  credit: Calculator,
  reclamation: MessageSquareWarning,
  gestion_privee: PiggyBank,
};

type Props = {
  onAssistant: (intent: Omit<Intent, "id">) => void;
  onAccessibility: () => void;
};

export function Home({ onAssistant, onAccessibility }: Props) {
  const ask = (message: string) => onAssistant({ mode: "text", message });

  return (
    <div className="page" data-route="accueil">
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-text">
            <p className="eyebrow">
              <AudioLines aria-hidden="true" /> Assistant accessible, 24 h/24
            </p>
            <h1 tabIndex={-1}>Une question ? Dites-la simplement.</h1>
            <p className="hero-lead">
              Notre assistant vous répond à voix haute ou par écrit, et va jusqu'au bout
              de vos démarches : réclamation, carte ou code perdu, crédit, épargne.
            </p>
            <div className="hero-actions">
              <button className="btn light big" onClick={() => onAssistant({ mode: "voice" })}>
                <Mic aria-hidden="true" />
                Parler à l'assistant
              </button>
              <button className="btn outline-light big" onClick={() => onAssistant({ mode: "text" })}>
                <Keyboard aria-hidden="true" />
                Écrire à l'assistant
              </button>
            </div>
            <p className="hero-note">
              Pensé pour les personnes aveugles et malvoyantes : rien à chercher à l'écran,
              tout se fait à la voix.
            </p>
          </div>

          {/* An example of conversation: decoration only. */}
          <div className="hero-demo" aria-hidden="true">
            <p className="demo-bubble user">J'ai perdu ma carte, je crois qu'on me l'a volée.</p>
            <p className="demo-bubble assistant">
              Je peux la bloquer tout de suite. Je bloque votre carte, c'est définitif :
              d'accord ?
            </p>
            <p className="demo-bubble user">Oui, d'accord.</p>
            <p className="demo-chip">
              <ShieldCheck /> Opposition sur la carte · n° OPP 34 15 87
            </p>
          </div>
        </div>
      </section>

      <div className="container">
        <aside className="urgent" aria-labelledby="urgent-title">
          <TriangleAlert aria-hidden="true" />
          <div>
            <h2 id="urgent-title">Carte perdue ou volée ?</h2>
            <p>L'assistant fait opposition pour vous, à toute heure, avec votre accord.</p>
          </div>
          <button
            className="btn danger"
            onClick={() => ask("J'ai perdu ma carte bancaire, je veux faire opposition.")}
          >
            Faire opposition
            <ArrowRight aria-hidden="true" />
          </button>
        </aside>

        <section className="section" aria-labelledby="topics-title">
          <h2 id="topics-title" className="section-title">
            Ce que l'assistant fait pour vous
          </h2>
          <p className="section-lead">
            Touchez une question : l'assistant y répond par écrit, d'après les fiches de la
            banque.
          </p>
          <div className="topics">
            {TOPICS.map((topic) => {
              const Icon = TOPIC_ICONS[topic.id];
              return (
                <article key={topic.id} className="card topic" aria-labelledby={`topic-${topic.id}`}>
                  <span className="topic-icon">
                    <Icon aria-hidden />
                  </span>
                  <h3 id={`topic-${topic.id}`}>{topic.title}</h3>
                  <p>{topic.text}</p>
                  <ul className="questions">
                    {topic.questions.map((q) => (
                      <li key={q}>
                        <button className="question" onClick={() => ask(q)}>
                          <span>« {q} »</span>
                          <ArrowRight aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section className="section" aria-labelledby="steps-title">
          <h2 id="steps-title" className="section-title">
            De votre besoin à « c'est fait »
          </h2>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="step">
                <span className="step-number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section split">
          <article className="card feature" aria-labelledby="a11y-title">
            <h2 id="a11y-title">Accessible, de bout en bout</h2>
            <ul className="ticks">
              <li>Pilotage 100 % vocal : vous pouvez couper la parole à l'assistant.</li>
              <li>Compatible avec les lecteurs d'écran, au clavier comme au toucher.</li>
              <li>Chaque nombre est répété, pour corriger une erreur tout de suite.</li>
              <li>Récapitulatifs en PDF accessible, lisibles avec un lecteur d'écran.</li>
            </ul>
            <button className="btn secondary" onClick={onAccessibility}>
              Taille du texte et contraste
              <ArrowRight aria-hidden="true" />
            </button>
          </article>
          <article className="card feature security" aria-labelledby="security-title">
            <h2 id="security-title">
              <Lock aria-hidden="true" /> Votre sécurité
            </h2>
            <p>
              L'assistant ne vous demandera jamais votre code secret, votre mot de passe ou
              un code reçu par SMS. Si quelqu'un vous les demande, c'est probablement une
              fraude : faites opposition.
            </p>
            <button
              className="btn outline-light"
              onClick={() => ask("On m'a demandé mon code par téléphone, est-ce normal ?")}
            >
              Un doute ? Demandez à l'assistant
              <ArrowRight aria-hidden="true" />
            </button>
          </article>
        </section>
      </div>

      <Footer />
    </div>
  );
}

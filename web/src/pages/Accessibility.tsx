import { useSettings, type Settings } from "../settings";
import { Footer } from "./Footer";

const SIZES: { value: Settings["textSize"]; label: string }[] = [
  { value: "normal", label: "Normale" },
  { value: "large", label: "Grande" },
  { value: "xlarge", label: "Très grande" },
];

export function Accessibility() {
  const { settings, update } = useSettings();

  return (
    <div className="page" data-route="accessibilite">
      <div className="container narrow">
        <header className="page-head">
          <h1 tabIndex={-1}>Accessibilité</h1>
          <p className="lead">Réglez l'affichage et l'assistant. C'est retenu sur cet appareil.</p>
        </header>

        <section className="card settings" aria-label="Réglages">
          <fieldset>
            <legend>Taille du texte</legend>
            <div className="options">
              {SIZES.map((size) => (
                <label key={size.value} className={`option size-${size.value}`}>
                  <input
                    type="radio"
                    name="text-size"
                    checked={settings.textSize === size.value}
                    onChange={() => update({ textSize: size.value })}
                  />
                  <span>{size.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              checked={settings.contrast}
              onChange={(e) => update({ contrast: e.target.checked })}
            />
            <span>
              Contraste renforcé
              <small>Texte plus foncé, bordures plus épaisses.</small>
            </span>
          </label>

          <fieldset>
            <legend>Quand j'ouvre l'assistant</legend>
            <div className="options">
              <label className="option">
                <input
                  type="radio"
                  name="mode"
                  checked={settings.mode === "voice"}
                  onChange={() => update({ mode: "voice" })}
                />
                <span>Je lui parle</span>
              </label>
              <label className="option">
                <input
                  type="radio"
                  name="mode"
                  checked={settings.mode === "text"}
                  onChange={() => update({ mode: "text" })}
                />
                <span>Je lui écris</span>
              </label>
            </div>
          </fieldset>

          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              checked={settings.pushToTalk}
              onChange={(e) => update({ pushToTalk: e.target.checked })}
            />
            <span>
              Pièce bruyante
              <small>
                À la voix, je touche « Parler », je pose ma question, puis je touche
                « Envoyer ». À partir du prochain appel.
              </small>
            </span>
          </label>
        </section>

        <section className="card prose" aria-labelledby="commitments">
          <h2 id="commitments">Nos engagements</h2>
          <ul className="ticks">
            <li>
              À la voix, l'assistant ne parle jamais de ce qui est affiché : tout se fait sans
              regarder l'écran.
            </li>
            <li>
              Vous pouvez lui couper la parole en parlant, en touchant « Interrompre », ou avec
              la touche Échap sur un clavier.
            </li>
            <li>
              Par écrit, les réponses sont lues par votre lecteur d'écran une fois écrites, en
              entier.
            </li>
            <li>
              Il répète chaque nombre que vous lui donnez, et lit les numéros de référence par
              groupes de chiffres.
            </li>
            <li>
              Les récapitulatifs PDF sont balisés (PDF/UA) : titres et tableaux lus dans l'ordre.
            </li>
            <li>Le site se parcourt au clavier, et suit les réglages sombre ou clair de votre appareil.</li>
          </ul>
        </section>
      </div>
      <Footer />
    </div>
  );
}

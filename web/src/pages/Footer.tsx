import { BRAND } from "../site";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <p className="footer-brand">{BRAND} · Assistant</p>
        <p>
          Prototype de démonstration : les taux, frais, délais et numéros cités sont
          fictifs, et aucune demande n'est réellement transmise à un conseiller.
        </p>
        <p>
          Les échanges avec l'assistant sont traités par un service d'intelligence
          artificielle (OpenAI). N'y donnez jamais un code, un mot de passe ou un numéro de
          carte.
        </p>
      </div>
    </footer>
  );
}

import { APP_CHAIN } from "@/chain";
import { tallGrassAddress } from "@/generated";

function shortAddr(a: string): string {
  return a.slice(0, 5) + "\u2026" + a.slice(-4);
}

export function Identity() {
  const address =
    tallGrassAddress[APP_CHAIN.id as keyof typeof tallGrassAddress];
  const explorer = APP_CHAIN.blockExplorers?.default.url;
  const contractHref =
    address && explorer ? `${explorer}/address/${address}` : undefined;

  return (
    <footer className="identity">
      <div className="identity-meta">
        <div className="group">
          <span>
            <span className="k">source</span>
            <a
              className="v act"
              href="https://github.com/0xfffxfff/tall-grass-hidden-from-view"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/0xfffxfff/tall-grass-hidden-from-view
            </a>
          </span>
          <span>
            <span className="k">license</span>
            <span className="v">GPL-3.0</span>
          </span>
          <span>
            <span className="k">also published</span>
            <a
              className="v act"
              href="https://github.com/0xfffxfff/tall-grass-hidden-from-view/tree/main/fhe-wasm"
              target="_blank"
              rel="noopener noreferrer"
            >
              fhe-wasm (TFHE&nbsp;&rarr;&nbsp;WASM, Apache&nbsp;2.0)
            </a>
          </span>
        </div>
        <div className="group">
          <span>
            <span className="k">contract ({APP_CHAIN.name.toLowerCase()})</span>
            {contractHref ? (
              <a
                className="v act"
                href={contractHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shortAddr(address)}
              </a>
            ) : (
              <span className="v">{address ? shortAddr(address) : "\u2014"}</span>
            )}
          </span>
        </div>
        <div className="group">
          <a href="/report/tech-spec" className="act">technical&nbsp;spec</a>
          <a href="/report/digital-exhibit" className="act">digital&nbsp;exhibit</a>
        </div>
      </div>
    </footer>
  );
}

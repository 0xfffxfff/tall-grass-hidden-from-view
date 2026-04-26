export function Identity() {
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
            <span className="k">contract</span>
            <span className="v">0x9f3&hellip;a04c</span>
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

export function Identity() {
  return (
    <footer className="identity">
      <div className="identity-meta">
        <div className="group">
          <span>
            <span className="k">source</span>
            <span className="v">github.com/0xfff/tall-grass</span>
          </span>
          <span>
            <span className="k">license</span>
            <span className="v">GPL-3.0</span>
          </span>
          <span>
            <span className="k">also published</span>
            <span className="v">fhe-wasm (TFHE&nbsp;&rarr;&nbsp;WASM, Apache&nbsp;2.0)</span>
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

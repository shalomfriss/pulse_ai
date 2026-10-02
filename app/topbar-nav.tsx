const moreLinks = [
  ["/signals", "Signals"],
  ["/company-analysis", "Company Analysis"],
  ["/market-intelligence", "Market Intelligence"],
  ["/valuation", "Valuation"],
  ["/mass-valuation", "Mass Valuation"],
  ["/candlestick", "Candlestick"],
  ["/backtesting", "Backtesting"],
  ["/daytrading", "Day Trading"],
  ["/kronos", "Kronos"],
  ["/finrl", "FinRL"],
  ["/why-these-decisions", "Why These Decisions"],
  ["/strategy-lab", "Strategy Lab"],
  ["/positions", "Positions"],
  ["/transactions", "Transactions"],
  ["/settings", "Settings"],
] as const;

export default function TopbarNav({ activeHref }: { activeHref: string }) {
  const moreIsActive = moreLinks.some(([href]) => href === activeHref);

  return (
    <nav aria-label="Primary navigation">
      <a aria-current={activeHref === "/command-center" ? "page" : undefined} className={activeHref === "/command-center" ? "nav-active" : undefined} href="/command-center">
        Command Center
      </a>
      <a aria-current={activeHref === "/news-radar" ? "page" : undefined} className={activeHref === "/news-radar" ? "nav-active" : undefined} href="/news-radar">
        News Radar
      </a>
      <details className={`nav-more ${moreIsActive ? "nav-more-active" : ""}`}>
        <summary aria-label="Open more navigation links">
          More <span aria-hidden="true">⌄</span>
        </summary>
        <div className="nav-more-menu">
          {moreLinks.map(([href, label]) => (
            <a aria-current={activeHref === href ? "page" : undefined} className={activeHref === href ? "nav-active" : undefined} href={href} key={href}>
              {label}
            </a>
          ))}
        </div>
      </details>
    </nav>
  );
}

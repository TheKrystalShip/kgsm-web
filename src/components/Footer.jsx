import { Icon } from "./Icon.jsx";

// KrystalFooter — app-wide footer. Brand block + open-source repo links.
// Deliberately lean: this is a private panel for a small Discord crew, not a
// public marketing site, so there's no FAQ / support / legal sprawl.

// GitHub octocat mark — lucide dropped its brand glyph, and these links point
// straight at github.com, so the real mark is the right, recognisable choice.
function GithubMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
         style={{ display: "block" }}>
      <path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const KRYSTAL_REPOS = [
  {
    label: "TheKrystalShip",
    sub: "GitHub organisation — home of the KGSM ecosystem",
    href: "https://github.com/TheKrystalShip",
    org: true,
  },
  {
    label: "kgsm",
    sub: "The engine — Krystal Game Server Manager",
    href: "https://github.com/TheKrystalShip/kgsm",
  },
  {
    label: "kgsm-containers",
    sub: "Extra game-server container images",
    href: "https://github.com/TheKrystalShip/kgsm-containers",
  },
  {
    label: "kgsm-bot",
    sub: "Discord bridge for KGSM + the assistant",
    href: "https://github.com/TheKrystalShip/kgsm-bot",
  },
];

function RepoLink({ repo }) {
  return (
    <a className={"kfoot__repo" + (repo.org ? " kfoot__repo--org" : "")}
       href={repo.href} target="_blank" rel="noreferrer noopener">
      <span className="kfoot__repo-ico">
        {repo.org ? <GithubMark size={18} /> : <Icon name="git-branch" size={15} />}
      </span>
      <span className="kfoot__repo-text">
        <span className="kfoot__repo-name">
          {repo.org ? "TheKrystalShip" : (
            <><span className="kfoot__repo-scope">TheKrystalShip/</span>{repo.label}</>
          )}
        </span>
        <span className="kfoot__repo-sub">{repo.sub}</span>
      </span>
      <span className="kfoot__repo-arrow"><Icon name="arrow-up-right" size={14} strokeWidth={2.2} /></span>
    </a>
  );
}

function KrystalFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="kfoot" role="contentinfo">
      <div className="kfoot__inner">
        <div className="kfoot__brand">
          <div className="kfoot__brand-row">
            <img src="/assets/tks-mark.png" width="34" height="34" alt="" className="kfoot__mark" />
            <span className="kfoot__wordmark">The Krystal Ship</span>
          </div>
          <p className="kfoot__tagline">
            A private control panel for our little fleet of game servers — built for
            the Discord crew, powered end-to-end by KGSM.
          </p>
          <div className="kfoot__powered">
            Self-hosted &amp; open source
          </div>
        </div>

        <div className="kfoot__links">
          <div className="kfoot__links-label">Source code</div>
          <div className="kfoot__repos">
            {KRYSTAL_REPOS.map(r => <RepoLink key={r.href} repo={r} />)}
          </div>
        </div>
      </div>

      <div className="kfoot__bar">
        <span className="kfoot__copy">© {year} The Krystal Ship · made by friends, for friends.</span>
        <a className="kfoot__bar-org" href="https://github.com/TheKrystalShip" target="_blank" rel="noreferrer noopener">
          <GithubMark size={13} />
          github.com/TheKrystalShip
        </a>
      </div>
    </footer>
  );
}

export { KrystalFooter };

import { Footer, GithubMark } from "@thekrystalship/krystal-ui";

// KrystalFooter — app-wide footer. Brand block + open-source repo links.
// Deliberately lean: this is a private panel for a small Discord crew, not a
// public marketing site, so there's no FAQ / support / legal sprawl.

const repo = (name, sub) => ({
  name, sub, scope: "TheKrystalShip/", icon: "git-branch", href: "https://github.com/TheKrystalShip/" + name,
});

const KRYSTAL_REPOS = [
  {
    name: "TheKrystalShip",
    sub: "GitHub organisation — home of the KGSM ecosystem",
    href: "https://github.com/TheKrystalShip",
    glyph: <GithubMark size={18} />,
    featured: true,
  },
  repo("kgsm", "The engine — Krystal Game Server Manager"),
  repo("kgsm-containers", "Extra game-server container images"),
  repo("kgsm-bot", "Discord bridge for KGSM + the assistant"),
];

function KrystalFooter() {
  return (
    <Footer
      mark="/assets/tks-mark.png"
      wordmark="The Krystal Ship"
      tagline="A private control panel for our little fleet of game servers — built for the Discord crew, powered end-to-end by KGSM."
      note="Self-hosted & open source"
      groups={[{ label: "Source code", columns: 2, mono: true, links: KRYSTAL_REPOS }]}
      copy={`© ${new Date().getFullYear()} The Krystal Ship · made by friends, for friends.`}
      end={
        <a className="kfoot__org" href="https://github.com/TheKrystalShip" target="_blank" rel="noreferrer noopener">
          <GithubMark size={13} />
          github.com/TheKrystalShip
        </a>
      }
    />
  );
}

export { KrystalFooter };

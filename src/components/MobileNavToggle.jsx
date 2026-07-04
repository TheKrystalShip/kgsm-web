// MobileNavToggle — slim handle pinned to the left edge on phones, matching
// the swipe gesture position.

import { Icon } from "./Icon.jsx";

function MobileNavToggle({ onOpen }) {
  return (
    <button className="mnav mnav--edge" onClick={onOpen} aria-label="Open menu" title="Menu">
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

export { MobileNavToggle };

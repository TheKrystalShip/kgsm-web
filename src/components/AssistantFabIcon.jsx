import { useRef, useEffect } from "react";

const MAX_EYE_PX = 2;

export default function AssistantFabIcon({ size = 22, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;

    const mq = window.matchMedia("(hover: hover)");
    if (!mq.matches) return;

    let rafId = null;
    let cachedRect = svg.getBoundingClientRect();

    const updateRect = () => { cachedRect = svg.getBoundingClientRect(); };
    window.addEventListener("resize", updateRect, { passive: true });
    window.addEventListener("scroll", updateRect, { passive: true });

    const handleMove = (e) => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        const r = cachedRect;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          svg.style.setProperty("--eye-x", `${(dx / dist) * MAX_EYE_PX}px`);
          svg.style.setProperty("--eye-y", `${(dy / dist) * MAX_EYE_PX}px`);
        }
        rafId = null;
      });
    };

    const handleLeave = () => {
      svg.style.setProperty("--eye-x", "0px");
      svg.style.setProperty("--eye-y", "0px");
    };

    document.addEventListener("mousemove", handleMove, { passive: true });
    document.addEventListener("mouseleave", handleLeave);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseleave", handleLeave);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <g className="assistant-icon__eye-g">
        <ellipse className="assistant-icon__eye" cx="9" cy="14" rx="2" ry="2" fill="currentColor" stroke="none" />
        <ellipse className="assistant-icon__eye" cx="15" cy="14" rx="2" ry="2" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

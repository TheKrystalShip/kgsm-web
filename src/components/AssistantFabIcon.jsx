export default function AssistantFabIcon({ size = 22, className = "" }) {
  return (
    <svg
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

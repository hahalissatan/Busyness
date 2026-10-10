/**
 * Logo — the "BUSYNESS" wordmark used in landing and app.
 * Reproduces the stylized Y from the template.
 */

export function Logo({ size = "lg", className = "" }) {
  const sizes = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-4xl md:text-5xl",
    xl: "text-5xl md:text-7xl",
  };
  return (
    <span
      className={`font-display font-bold tracking-[0.15em] ${sizes[size]} ${className}`}
      style={{ fontStretch: "expanded" }}
    >
      BUS<span className="relative inline-block">
        Y
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: "scaleX(-1)", opacity: 0.55 }}
          aria-hidden="true"
        >
          Y
        </span>
      </span>NESS
    </span>
  );
}
/**
 * Logo — the "BUSYNESS" wordmark.
 *
 * Clean, bold, geometric sans-serif (Space Grotesk).
 * Dark charcoal lettering with a subtle teal accent on the "Y".
 * The accent is the brand's signature — sage-teal — applied
 * sparingly to one letter to create recognition without clutter.
 */

export function Logo({ size = "lg", className = "" }) {
  const sizes = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-3xl md:text-5xl",
    xl: "text-4xl md:text-6xl lg:text-7xl",
  };

  return (
    <span
      className={`font-display font-bold tracking-[0.08em] md:tracking-[0.12em] ${sizes[size]} ${className}`}
      style={{
        fontFeatureSettings: '"ss01"',
      }}
    >
      <span className="text-[#1a1a2e] dark:text-white">BUS</span>
      <span className="text-teal-500 dark:text-teal-400">Y</span>
      <span className="text-[#1a1a2e] dark:text-white">NESS</span>
    </span>
  );
}
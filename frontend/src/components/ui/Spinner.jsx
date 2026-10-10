export function Spinner({ size = "md" }) {
  const sizes = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-10 h-10",
  };
  return (
    <div className="flex items-center justify-center">
      <div
        className={`${sizes[size]} border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin`}
      />
    </div>
  );
}

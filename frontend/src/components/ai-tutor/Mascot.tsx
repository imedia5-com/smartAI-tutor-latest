// The app's existing robot mascot (same /images/teaching-robot.png used on the /chat
// "Ask me anything!" empty state) — reused here rather than introducing a new character, with
// a gentle floating animation that respects prefers-reduced-motion.
const SIZES = { sm: 28, md: 56, lg: 110 } as const;

export default function Mascot({ size = "md", className }: { size?: keyof typeof SIZES; className?: string }) {
  const px = SIZES[size];
  return (
    <>
      <style>{`
        @keyframes ai-tutor-mascot-float {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
        .ai-tutor-mascot { animation: ai-tutor-mascot-float 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .ai-tutor-mascot { animation: none; }
        }
      `}</style>
      <img
        src="/images/teaching-robot.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`ai-tutor-mascot ${className || ""}`}
        style={{ width: px, height: px, objectFit: "contain", pointerEvents: "none", flexShrink: 0 }}
      />
    </>
  );
}

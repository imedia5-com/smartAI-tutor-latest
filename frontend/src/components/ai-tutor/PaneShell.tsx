import type { LucideIcon } from "lucide-react";

export type PaneTone = "brand" | "success" | "warning";

const TONE_BORDER: Record<PaneTone, string> = {
  brand: "border-brand",
  success: "border-success",
  warning: "border-warning",
};
const TONE_HEADER_BG: Record<PaneTone, string> = {
  brand: "bg-brand-light",
  success: "bg-success-light",
  warning: "bg-warning-light",
};
const TONE_TEXT: Record<PaneTone, string> = {
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
};

/** Gives each of the three AI Tutor panes (Material / Board / Chat) its own soft colour
 * identity — a coloured border, a tinted header with an icon + title — using the app's
 * existing semantic colour tokens rather than new ones. */
export default function PaneShell({ tone, icon: Icon, title, children }: {
  tone: PaneTone; icon: LucideIcon; title: string; children: React.ReactNode;
}) {
  return (
    <div className={`flex-1 flex flex-col overflow-hidden rounded-2xl border-2 ${TONE_BORDER[tone]} shadow-sm m-1.5 bg-surface`}>
      <div className={`flex items-center gap-1.5 px-3 py-2 shrink-0 ${TONE_HEADER_BG[tone]}`}>
        <Icon size={15} className={TONE_TEXT[tone]} />
        <span className={`text-[12px] font-bold uppercase tracking-wide ${TONE_TEXT[tone]}`}>{title}</span>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}

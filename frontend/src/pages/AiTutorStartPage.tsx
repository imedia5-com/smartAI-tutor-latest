import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Mic, Keyboard, FileType2, X, Upload, Check, Loader2, Sparkles } from "lucide-react";
import { Card, Alert, Textarea } from "../components/ui";
import { cn } from "../components/ui/cn";
import MicButton from "../components/ai-tutor/MicButton";
import MyLessonsList from "../components/ai-tutor/MyLessonsList";
import Mascot from "../components/ai-tutor/Mascot";
import { primeSpeech } from "../components/ai-tutor/speech";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { aiTutorApi, type AiTutorInputType, type AiTutorLevel, type AiTutorMode } from "../services/api";

const OPTIONS: { id: AiTutorInputType; label: string; desc: string; icon: typeof FileText; accept?: string; tint: string; border: string }[] = [
  { id: "pdf", label: "PDF", desc: "Upload one or more PDF files", icon: FileText, accept: ".pdf", tint: "bg-danger-light text-danger", border: "border-danger" },
  { id: "voice", label: "Speak", desc: "Ask your question out loud", icon: Mic, tint: "bg-success-light text-success", border: "border-success" },
  { id: "text", label: "Type a question", desc: "Type or paste a question", icon: Keyboard, tint: "bg-brand-light text-brand", border: "border-brand" },
  { id: "word", label: "Word document", desc: "Upload one or more .docx files", icon: FileType2, accept: ".docx", tint: "bg-warning-light text-warning", border: "border-warning" },
];

const LEVELS: { id: AiTutorLevel; emoji: string; label: string; desc: string }[] = [
  { id: "low", emoji: "🐣", label: "Low", desc: "Baby steps, very easy words" },
  { id: "medium", emoji: "🚀", label: "Medium", desc: "A balanced, standard explanation" },
  { id: "high", emoji: "🧠", label: "High", desc: "Technical and precise" },
];

const MAX_FILE_MB = 25;
const MAX_FILES = 5;

const SPEECH_LANGS = [
  { code: "en-US", label: "English" },
  { code: "ur-PK", label: "اردو (Urdu)" },
  { code: "hi-IN", label: "हिन्दी (Hindi)" },
];

export default function AiTutorStartPage() {
  const navigate = useNavigate();
  const [inputType, setInputType] = useState<AiTutorInputType>("pdf");
  const [level, setLevel] = useState<AiTutorLevel>("medium");
  const [mode, setMode] = useState<AiTutorMode>("guided");
  const [files, setFiles] = useState<File[]>([]);
  const [questionText, setQuestionText] = useState("");
  const [speechLang, setSpeechLang] = useState("en-US");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeechRecognition({ onError: setError });

  // Commit whatever was transcribed into the actual box value once the mic stops, so Generate
  // (and submission) don't depend on the live "transcript" fallback still being around.
  const prevSpeechStateRef = useRef(speech.state);
  useEffect(() => {
    if (prevSpeechStateRef.current === "listening" && speech.state !== "listening" && speech.transcript) {
      setQuestionText(speech.transcript);
    }
    prevSpeechStateRef.current = speech.state;
  }, [speech.state, speech.transcript]);

  const activeOption = OPTIONS.find((o) => o.id === inputType)!;

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError(null);
    const accept = activeOption.accept;
    const next: File[] = [];
    for (const f of Array.from(incoming)) {
      if (accept && !f.name.toLowerCase().endsWith(accept)) {
        setError(`'${f.name}' isn't a ${accept === ".pdf" ? "PDF" : "Word (.docx)"} file.`);
        continue;
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`'${f.name}' is larger than ${MAX_FILE_MB}MB.`);
        continue;
      }
      next.push(f);
    }
    setFiles((prev) => [...prev, ...next].slice(0, MAX_FILES));
  }, [activeOption]);

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const switchOption = (id: AiTutorInputType) => {
    setInputType(id);
    setFiles([]);
    setQuestionText("");
    setError(null);
    speech.stop();
    speech.reset();
  };

  // While listening, the box visibly shows speech.transcript as a fallback (see the Textarea
  // below) even before it's committed into questionText — count that too so Generate doesn't
  // lag behind what the learner can see on screen.
  const effectiveQuestionText = inputType === "voice" ? (questionText || speech.transcript) : questionText;

  const canGenerate = useMemo(() => {
    if (inputType === "pdf" || inputType === "word") return files.length > 0;
    if (inputType === "text") return questionText.trim().length > 0;
    if (inputType === "voice") return effectiveQuestionText.trim().length >= 3;
    return false;
  }, [inputType, files, questionText, effectiveQuestionText]);

  const disabledHint = useMemo(() => {
    if (canGenerate || submitting) return null;
    if (inputType === "pdf") return "Add at least one PDF file to continue.";
    if (inputType === "word") return "Add at least one Word document to continue.";
    if (inputType === "text") return "Type your question to continue.";
    if (inputType === "voice") return "Speak or type at least a few words to continue.";
    return null;
  }, [canGenerate, submitting, inputType]);

  const handleGenerate = async () => {
    if (!canGenerate || submitting) return;
    primeSpeech(); // register this click as the user gesture that unlocks speechSynthesis
    setSubmitting(true);
    setError(null);
    try {
      const session = await aiTutorApi.createSession(inputType, level, mode);
      if (inputType === "pdf" || inputType === "word") {
        await aiTutorApi.uploadSources(session.id, files);
      } else {
        await aiTutorApi.setQuestion(session.id, effectiveQuestionText.trim(), inputType === "voice");
      }
      await aiTutorApi.generate(session.id);
      navigate(`/ai-tutor/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="main-content overflow-x-hidden">
      <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto", overflowX: "hidden", maxWidth: "100%" }}>
        <div className="flex items-center gap-3 mb-6 min-w-0">
          <Mascot size="md" />
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-[26px] font-extrabold text-ink leading-tight truncate">
              What do you want to learn today? 🌟
            </h1>
            <p className="text-[13px] text-ink-muted mt-0.5">Upload material or ask a question, and get a lesson taught just for you.</p>
          </div>
        </div>

        {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

        <MyLessonsList />

        {/* Step 1: how to start */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = inputType === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => switchOption(opt.id)}
                className={cn(
                  "relative text-left p-4 sm:p-5 rounded-2xl border-2 shadow-sm transition-all duration-200 min-w-0",
                  "hover:-translate-y-1 hover:shadow-md motion-reduce:hover:translate-y-0",
                  active ? `${opt.border} ${opt.tint.split(" ")[0]}` : "border-line bg-surface hover:bg-surface-hover",
                )}
              >
                {active && (
                  <span className={cn("absolute top-2.5 right-2.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-white", opt.border.replace("border-", "bg-"))}>
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                <div className={cn("inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-full", opt.tint)}>
                  <Icon size={24} />
                </div>
                <div className="mt-2.5 font-bold text-[14.5px] sm:text-[15.5px] text-ink truncate">{opt.label}</div>
                <div className="text-[12px] sm:text-[12.5px] text-ink-muted mt-0.5 line-clamp-2">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {/* Step 2: the input itself */}
        <Card className="p-5 mb-6 rounded-2xl shadow-sm">
          {(inputType === "pdf" || inputType === "word") && (
            <div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-line rounded-2xl p-8 text-center cursor-pointer hover:bg-surface-hover"
              >
                <Upload size={28} className="mx-auto text-ink-muted mb-2" />
                <div className="text-[13px] text-ink-soft">
                  Drop {inputType === "pdf" ? "PDF" : ".docx"} files here, or click to browse
                </div>
                <div className="text-[11px] text-ink-muted mt-1">Up to {MAX_FILES} files, {MAX_FILE_MB}MB each</div>
                <input
                  ref={fileInputRef} type="file" multiple hidden
                  accept={activeOption.accept}
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
              </div>
              {files.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between text-[13px] bg-surface-muted rounded-md px-3 py-2 min-w-0">
                      <span className="truncate text-ink">{f.name}</span>
                      <button onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="text-ink-muted hover:text-danger shrink-0 ml-2">
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {inputType === "text" && (
            <div>
              <Textarea
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                placeholder="Type or paste your question here…"
                className="min-h-[140px]"
                maxLength={8000}
              />
              <div className="text-right text-[11px] text-ink-muted mt-1">{questionText.length} / 8000</div>
            </div>
          )}

          {inputType === "voice" && (
            <div className="flex flex-col items-center gap-4 py-4">
              {!speech.supported ? (
                <Alert tone="warning">
                  Speech recognition isn't supported in this browser. Try Chrome, or use "Type a question" instead.
                </Alert>
              ) : (
                <>
                  <select
                    value={speechLang}
                    onChange={(e) => setSpeechLang(e.target.value)}
                    className="h-8 text-[12px] rounded-md border border-line bg-surface px-2"
                  >
                    {SPEECH_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                  <MicButton
                    state={speech.state}
                    onClick={() => (speech.state === "listening" ? speech.stop() : speech.start(speechLang))}
                  />
                  <div className="text-[12px] text-ink-muted">
                    {speech.state === "listening" ? "Listening… tap to stop" : "Tap the mic and ask your question"}
                  </div>
                  {speech.state === "listening" && speech.transcript && (
                    <div className="text-[13px] text-ink-soft italic text-center max-w-md" aria-live="polite">
                      {speech.transcript}
                    </div>
                  )}
                </>
              )}
              <div className="w-full">
                <Textarea
                  value={questionText || speech.transcript}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="Your transcript will appear here — check and edit it before generating."
                  className="min-h-[100px]"
                />
              </div>
            </div>
          )}
        </Card>

        {/* Step 3: level */}
        <div className="mb-6">
          <div className="text-[13px] font-bold text-ink-soft mb-2.5">Level</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLevel(l.id)}
                className={cn(
                  "text-left p-3.5 rounded-2xl border-2 shadow-sm transition-all duration-200 min-w-0",
                  "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
                  level === l.id ? "border-brand bg-brand-light" : "border-line bg-surface hover:bg-surface-hover",
                )}
              >
                <div className="font-bold text-[14px] text-ink flex items-center gap-1.5">
                  <span className="text-[18px]">{l.emoji}</span> {l.label}
                </div>
                <div className="text-[12px] text-ink-muted mt-0.5">{l.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 4: mode */}
        <div className="mb-8">
          <div className="text-[13px] font-bold text-ink-soft mb-2.5">Mode</div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => setMode("guided")}
              className={cn(
                "flex-1 px-5 py-3 rounded-full text-[14px] font-bold transition-all duration-200 border-2",
                mode === "guided" ? "bg-brand text-white border-brand shadow-sm" : "bg-surface text-ink-soft border-line hover:bg-surface-hover",
              )}
            >
              Teach me step by step
            </button>
            <button
              type="button"
              onClick={() => setMode("qa_only")}
              className={cn(
                "flex-1 px-5 py-3 rounded-full text-[14px] font-bold transition-all duration-200 border-2",
                mode === "qa_only" ? "bg-brand text-white border-brand shadow-sm" : "bg-surface text-ink-soft border-line hover:bg-surface-hover",
              )}
            >
              Just answer my questions
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={!canGenerate || submitting}
          onClick={handleGenerate}
          className={cn(
            "inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 py-3.5 rounded-full text-[16px] font-extrabold text-white shadow-md",
            "bg-gradient-to-r from-brand to-success transition-all duration-200",
            "hover:scale-[1.03] hover:shadow-lg motion-reduce:hover:scale-100",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
          )}
        >
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {submitting ? "Getting ready…" : "Generate my lesson"}
        </button>
        {disabledHint && <div className="text-[12px] text-ink-muted mt-2">{disabledHint}</div>}
      </div>
    </div>
  );
}

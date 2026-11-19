import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Mic, Keyboard, FileType2, X, Upload } from "lucide-react";
import { PageHeader, Card, Button, Alert, Textarea } from "../components/ui";
import { cn } from "../components/ui/cn";
import MicButton from "../components/ai-tutor/MicButton";
import MyLessonsList from "../components/ai-tutor/MyLessonsList";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { aiTutorApi, type AiTutorInputType, type AiTutorLevel, type AiTutorMode } from "../services/api";

const OPTIONS: { id: AiTutorInputType; label: string; desc: string; icon: typeof FileText; accept?: string }[] = [
  { id: "pdf", label: "PDF", desc: "Upload one or more PDF files", icon: FileText, accept: ".pdf" },
  { id: "voice", label: "Speak", desc: "Ask your question out loud", icon: Mic },
  { id: "text", label: "Type a question", desc: "Type or paste a question", icon: Keyboard },
  { id: "word", label: "Word document", desc: "Upload one or more .docx files", icon: FileType2, accept: ".docx" },
];

const LEVELS: { id: AiTutorLevel; label: string; desc: string }[] = [
  { id: "low", label: "Low", desc: "Baby steps, very easy words" },
  { id: "medium", label: "Medium", desc: "A balanced, standard explanation" },
  { id: "high", label: "High", desc: "Technical and precise" },
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

  const canGenerate = useMemo(() => {
    if (inputType === "pdf" || inputType === "word") return files.length > 0;
    if (inputType === "text") return questionText.trim().length > 0;
    if (inputType === "voice") return questionText.trim().length > 0; // edited transcript
    return false;
  }, [inputType, files, questionText]);

  const handleGenerate = async () => {
    if (!canGenerate || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await aiTutorApi.createSession(inputType, level, mode);
      if (inputType === "pdf" || inputType === "word") {
        await aiTutorApi.uploadSources(session.id, files);
      } else {
        await aiTutorApi.setQuestion(session.id, questionText.trim(), inputType === "voice");
      }
      await aiTutorApi.generate(session.id);
      navigate(`/ai-tutor/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="main-content">
      <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
        <PageHeader title="AI Tutor" subtitle="Upload material or ask a question, and get a lesson taught just for you." />

        {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

        <MyLessonsList />

        {/* Step 1: how to start */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = inputType === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => switchOption(opt.id)}
                className={cn(
                  "text-left p-4 rounded-lg border-2 transition-colors",
                  active ? "border-brand bg-brand-light" : "border-line bg-surface hover:bg-surface-hover",
                )}
              >
                <Icon size={22} className={active ? "text-brand" : "text-ink-muted"} />
                <div className="mt-2 font-bold text-[14px] text-ink">{opt.label}</div>
                <div className="text-[12px] text-ink-muted mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {/* Step 2: the input itself */}
        <Card className="p-5 mb-6">
          {(inputType === "pdf" || inputType === "word") && (
            <div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-line rounded-lg p-8 text-center cursor-pointer hover:bg-surface-hover"
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
                    <li key={i} className="flex items-center justify-between text-[13px] bg-surface-muted rounded-md px-3 py-2">
                      <span className="truncate text-ink">{f.name}</span>
                      <button onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="text-ink-muted hover:text-danger">
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
          <div className="text-[12.5px] font-semibold text-ink-soft mb-2">Level</div>
          <div className="grid grid-cols-3 gap-3">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLevel(l.id)}
                className={cn(
                  "text-left p-3 rounded-lg border-2 transition-colors",
                  level === l.id ? "border-brand bg-brand-light" : "border-line bg-surface hover:bg-surface-hover",
                )}
              >
                <div className="font-bold text-[13px] text-ink">{l.label}</div>
                <div className="text-[11.5px] text-ink-muted">{l.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 4: mode */}
        <div className="mb-8">
          <div className="text-[12.5px] font-semibold text-ink-soft mb-2">Mode</div>
          <div className="inline-flex rounded-lg border border-line overflow-hidden">
            <button
              type="button"
              onClick={() => setMode("guided")}
              className={cn("px-4 py-2 text-[13px] font-semibold", mode === "guided" ? "bg-brand text-white" : "bg-surface text-ink-soft hover:bg-surface-hover")}
            >
              Teach me step by step
            </button>
            <button
              type="button"
              onClick={() => setMode("qa_only")}
              className={cn("px-4 py-2 text-[13px] font-semibold", mode === "qa_only" ? "bg-brand text-white" : "bg-surface text-ink-soft hover:bg-surface-hover")}
            >
              Just answer my questions
            </button>
          </div>
        </div>

        <Button size="lg" disabled={!canGenerate} loading={submitting} onClick={handleGenerate}>
          Generate
        </Button>
      </div>
    </div>
  );
}

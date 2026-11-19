"""
Business logic for the AI Tutor feature (upload your own material / ask a question,
get a guided Gemini-powered lesson or just Q&A). Reuses the existing PDF/DOCX text
extractors in document_service — this feature does not re-implement file parsing.
"""
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.session import async_session_factory
from app.models.ai_tutor import AiTutorMessage, AiTutorSession, AiTutorSource, AiTutorStep
from app.services import document_service
from app.services.ai_tutor_llm import (
    AiTutorLLMError, answer_question, generate_outline, generate_step, reexplain_step,
)

logger = logging.getLogger(__name__)

CONTEXT_CHAR_BUDGET = 12000

# Short, casual, or confused mid-lesson messages ("bro", "wth", "ok i don't get it") — treated
# as "I didn't understand", not as a literal question to answer.
_CONFUSION_RE = re.compile(
    r"\b(i don.?t (get|understand)|(i.?m|i am|this is|that.?s|that is) confus(ed|ing)|"
    r"doesn.?t make sense|makes no sense|i.?m lost|lost me|no idea what|"
    r"what.?s (going on|happening))\b",
    re.IGNORECASE,
)
_CASUAL_FILLER_RE = re.compile(r"^(bro+|wth+|huh+|idk|wait what|what)[\s!?.]*$", re.IGNORECASE)


def _is_confused_message(text: str) -> bool:
    t = text.strip()
    if _CASUAL_FILLER_RE.match(t):
        return True
    if len(t.split()) > 10:
        return False  # longer messages read as real questions, not just confusion
    return bool(_CONFUSION_RE.search(t))
QUESTION_PROMPT = "Do you have any questions?"


class AiTutorError(Exception):
    """Raised for all expected (4xx/409) failures; the router maps it to an HTTPException."""

    def __init__(self, status_code: int, message: str, code: Optional[str] = None):
        self.status_code = status_code
        self.message = message
        self.code = code
        super().__init__(message)


ALLOWED_EXT = {"pdf": {"pdf"}, "word": {"docx"}}

# draft -> processing -> (ready | qa | failed); ready -> teaching <-> paused -> qa; failed -> processing (retry)
_LEGAL_TRANSITIONS = {
    ("ready", "start"): "teaching",
    ("teaching", "pause"): "paused",
    ("paused", "resume"): "teaching",
    ("teaching", "finish"): "qa",
    ("paused", "finish"): "qa",
    ("failed", "retry"): "processing",
    ("ready", "restart"): "teaching",
    ("teaching", "restart"): "teaching",
    ("paused", "restart"): "teaching",
    ("qa", "restart"): "teaching",
}


def _transition(session: AiTutorSession, action: str) -> None:
    key = (session.status, action)
    if key not in _LEGAL_TRANSITIONS:
        raise AiTutorError(409, f"Can't do that while the lesson is '{session.status}'.", code="illegal_state")
    session.status = _LEGAL_TRANSITIONS[key]


def _sanitize_filename(name: str) -> str:
    base = os.path.basename(name or "file")
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "file"
    return base[:200]


def _sniff_pdf(data: bytes) -> bool:
    return data[:4] == b"%PDF"


def _sniff_docx(data: bytes) -> bool:
    return data[:4] == b"PK\x03\x04"


def _save_upload(content: bytes, extension: str) -> str:
    """Own upload dir (separate from the curriculum knowledge-base documents)."""
    upload_dir = Path(settings.ai_tutor_upload_dir).resolve()
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{uuid.uuid4()}.{extension}"
    file_path.write_bytes(content)
    return str(file_path)


# ─────────────────────────────  sessions  ─────────────────────────────

async def create_session(db: AsyncSession, user_id: int, input_type: str, level: str, mode: str) -> AiTutorSession:
    # `sources=[]` is deliberate: AiTutorSessionOut serialises `.sources`, and an unset
    # relationship on a freshly-flushed (never-queried) object triggers an async lazy-load
    # that crashes outside of an awaited query context. Passing it explicitly marks the
    # collection as already-loaded (correctly empty) so no lazy load is attempted.
    session = AiTutorSession(
        user_id=user_id, input_type=input_type, level=level, mode=mode, status="draft", sources=[],
    )
    db.add(session)
    await db.flush()
    # NOT db.refresh(session): a bare refresh() re-expires every attribute including the
    # `sources` relationship just set above, undoing the fix the comment describes. id/
    # created_at/updated_at are already populated after flush (client-side defaults + the
    # INSERT's RETURNING), so no refresh is needed at all.
    return session


async def get_owned_session(db: AsyncSession, session_id: int, user_id: int) -> Optional[AiTutorSession]:
    result = await db.execute(
        select(AiTutorSession)
        .options(selectinload(AiTutorSession.sources))
        .where(AiTutorSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None or session.user_id != user_id:
        return None
    return session


async def list_sessions(db: AsyncSession, user_id: int) -> list[AiTutorSession]:
    result = await db.execute(
        select(AiTutorSession)
        .where(AiTutorSession.user_id == user_id)
        .order_by(AiTutorSession.updated_at.desc())
    )
    return list(result.scalars().all())


async def delete_session(db: AsyncSession, session: AiTutorSession) -> None:
    await db.delete(session)
    await db.flush()


def find_source(session: AiTutorSession, source_id: int) -> AiTutorSource:
    for source in session.sources:
        if source.id == source_id:
            return source
    raise AiTutorError(404, "Source not found.")


def _session_sources_payload(session: AiTutorSession) -> list[dict]:
    return [{"id": str(s.id), "name": s.name, "pages": s.pages} for s in session.sources if s.pages]


# ─────────────────────────────  uploads  ─────────────────────────────

async def upload_sources(db: AsyncSession, session: AiTutorSession, files: list) -> list[AiTutorSource]:
    if session.status != "draft":
        raise AiTutorError(409, "Material can only be added before generating the lesson.", code="illegal_state")
    if session.input_type not in ("pdf", "word"):
        raise AiTutorError(422, "This session doesn't accept file uploads.", code="question_not_allowed")
    if not files:
        raise AiTutorError(422, "No files were provided.")
    if len(files) > settings.ai_tutor_max_files:
        raise AiTutorError(413, f"A maximum of {settings.ai_tutor_max_files} files can be uploaded at once.")

    max_bytes = settings.ai_tutor_max_upload_mb * 1024 * 1024
    allowed_ext = ALLOWED_EXT[session.input_type]
    expected_label = "PDF" if session.input_type == "pdf" else "Word (.docx)"

    prepared = []
    for f in files:
        filename = _sanitize_filename(getattr(f, "filename", None) or "file")
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        content = await f.read()

        if ext == "doc" and session.input_type == "word":
            raise AiTutorError(415, "'.doc' files aren't supported — please convert to .docx first.")
        if ext not in allowed_ext:
            raise AiTutorError(415, f"'{filename}' isn't a {expected_label} file.")
        if len(content) > max_bytes:
            raise AiTutorError(413, f"'{filename}' exceeds the {settings.ai_tutor_max_upload_mb}MB limit.")
        if session.input_type == "pdf" and not _sniff_pdf(content):
            raise AiTutorError(415, f"'{filename}' doesn't look like a valid PDF.")
        if session.input_type == "word" and not _sniff_docx(content):
            raise AiTutorError(415, f"'{filename}' doesn't look like a valid Word document.")
        prepared.append((filename, ext, content))

    created = []
    for filename, ext, content in prepared:
        file_path = _save_upload(content, ext)
        source = AiTutorSource(
            session_id=session.id, name=filename, file_path=file_path, file_type=ext, status="pending",
        )
        db.add(source)
        created.append(source)
    await db.flush()
    return created


async def set_question(db: AsyncSession, session: AiTutorSession, text: str, spoken: bool) -> AiTutorSource:
    if session.status != "draft":
        raise AiTutorError(409, "The question can only be set before generating the lesson.", code="illegal_state")
    if session.input_type not in ("voice", "text"):
        raise AiTutorError(422, "This session expects a file upload, not a question.", code="question_not_allowed")
    text = (text or "").strip()
    if not text:
        raise AiTutorError(422, "The question can't be empty.")

    session.question_text = text
    session.title = text[:120]
    source = AiTutorSource(
        session_id=session.id, name="Your question", file_path=None, file_type=None,
        pages=[{"page": 1, "text": text}], status="extracted",
    )
    db.add(source)
    await db.flush()
    return source


# ─────────────────────────────  generation  ─────────────────────────────

async def begin_generation(db: AsyncSession, session: AiTutorSession) -> None:
    if session.status != "draft":
        raise AiTutorError(409, "This lesson has already been generated.", code="illegal_state")
    if not session.sources:
        raise AiTutorError(422, "Add some material or a question before generating the lesson.")
    session.status = "processing"


async def retry_generation(db: AsyncSession, session: AiTutorSession) -> None:
    if session.status != "failed":
        raise AiTutorError(409, "Only a failed session can be retried.", code="illegal_state")
    session.status = "processing"
    session.error_message = None


def _extract_source(source: AiTutorSource) -> None:
    """Mutates `source` in place: sets .pages/.status on success, .status='failed'/.error_message on failure."""
    if source.status == "extracted":
        return
    try:
        if source.file_type == "pdf":
            pages = document_service.extract_pages_from_pdf(source.file_path)
            if len(pages) > settings.ai_tutor_max_pdf_pages:
                raise ValueError(f"This PDF has {len(pages)} pages, over the {settings.ai_tutor_max_pdf_pages}-page limit.")
        elif source.file_type == "docx":
            pages = document_service.extract_pages(source.file_path, "docx")
        else:
            pages = []

        page_dicts = [{"page": p, "text": t} for p, t in pages if t and t.strip()]
        if not page_dicts:
            raise ValueError("No readable text was found in this file.")
        source.pages = page_dicts
        source.status = "extracted"
    except Exception as exc:  # noqa: BLE001 - any extraction failure becomes a per-file warning
        source.status = "failed"
        source.error_message = str(exc)[:500]


async def run_generation(session_id: int) -> None:
    """Background job: extract every source, then (guided mode) generate the outline."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(AiTutorSession)
            .options(selectinload(AiTutorSession.sources))
            .where(AiTutorSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if session is None or session.status != "processing":
            return

        warnings: list[str] = []
        for source in session.sources:
            _extract_source(source)
            if source.status == "failed":
                warnings.append(f"{source.name}: {source.error_message}")
        session.warnings = warnings

        source_payloads = _session_sources_payload(session)
        if not source_payloads:
            session.status = "failed"
            session.error_message = "All of your material failed to process."
            await db.commit()
            return

        try:
            if session.mode == "qa_only":
                session.status = "qa"
            else:
                outline = await generate_outline(source_payloads, session.level, session.mode)
                for i, step in enumerate(outline):
                    db.add(AiTutorStep(
                        session_id=session.id, step_index=i, title=step["title"],
                        summary=step.get("summary"), source_refs=step.get("source_refs") or [],
                        status="pending",
                    ))
                session.outline = outline
                if not session.title:
                    session.title = outline[0]["title"] if outline else "AI Tutor lesson"
                session.status = "ready"
        except AiTutorLLMError as exc:
            session.status = "failed"
            session.error_message = str(exc)

        await db.commit()


# ─────────────────────────────  lesson steps  ─────────────────────────────

def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


_MIN_HIGHLIGHT_WORDS = 3


def _word_boundary_find(haystack_lower: str, needle_lower: str) -> int:
    """Like str.find, but only matches at whole-word boundaries — never inside another word
    (e.g. "the" must never match inside "photosynthesis")."""
    m = re.search(r"(?<!\w)" + re.escape(needle_lower) + r"(?!\w)", haystack_lower)
    return m.start() if m else -1


def _find_quote(quote: str, pages: dict[int, str], preferred_page):
    norm_quote = _normalize(quote)
    words = norm_quote.split(" ") if norm_quote else []
    if len(words) < _MIN_HIGHLIGHT_WORDS:
        return None, None
    ordered = ([preferred_page] if preferred_page in pages else []) + [p for p in pages if p != preferred_page]
    for page in ordered:
        text = _normalize(pages[page])
        lower = text.lower()
        idx = _word_boundary_find(lower, norm_quote.lower())
        if idx != -1:
            return page, text[idx: idx + len(norm_quote)]
        for cut in range(len(words) - 1, _MIN_HIGHLIGHT_WORDS - 1, -1):
            trimmed = " ".join(words[:cut])
            idx = _word_boundary_find(lower, trimmed.lower())
            if idx != -1:
                return page, text[idx: idx + len(trimmed)]
    return None, None


def _verify_step_content(content: dict, sources: list[dict]) -> dict:
    pages_by_source = {s["id"]: {p["page"]: p["text"] for p in s["pages"]} for s in sources}

    verified_highlights = []
    for h in content.get("highlights", []):
        pages = pages_by_source.get(h.get("source_id"))
        if not pages:
            continue
        page, quote = _find_quote(h.get("quote", ""), pages, h.get("page"))
        if page is None or not quote:
            continue
        verified_highlights.append({**h, "page": page, "quote": quote, "verified": True})

    board_ids = {b["id"] for b in content.get("board", [])}
    highlight_ids = {h["id"] for h in verified_highlights}
    segments = [
        {
            **seg,
            "board_block_ids": [b for b in seg.get("board_block_ids", []) if b in board_ids],
            "highlight_ids": [h for h in seg.get("highlight_ids", []) if h in highlight_ids],
        }
        for seg in content.get("segments", [])
    ]

    return {**content, "segments": segments, "highlights": verified_highlights}


async def get_step(db: AsyncSession, session: AiTutorSession, step_index: int) -> AiTutorStep:
    result = await db.execute(
        select(AiTutorStep).where(AiTutorStep.session_id == session.id, AiTutorStep.step_index == step_index)
    )
    step = result.scalar_one_or_none()
    if step is None:
        raise AiTutorError(404, "Step not found.")

    if step.status == "ready" and step.level_snapshot == session.level:
        return step

    step.status = "generating"
    sources = _session_sources_payload(session)
    count_result = await db.execute(
        select(func.count(AiTutorStep.id)).where(AiTutorStep.session_id == session.id)
    )
    step_count = count_result.scalar() or 1

    try:
        content = await generate_step(
            step_title=step.title, step_summary=step.summary or "", source_refs=step.source_refs or [],
            sources=sources, level=session.level, step_index=step.step_index, step_count=step_count,
        )
    except AiTutorLLMError:
        step.status = "failed"
        raise

    step.content = _verify_step_content(content, sources)
    step.level_snapshot = session.level
    step.status = "ready"
    return step


# ─────────────────────────────  playback  ─────────────────────────────

async def start_lesson(db: AsyncSession, session: AiTutorSession) -> None:
    _transition(session, "start")
    session.current_step_index = 0


async def advance(db: AsyncSession, session: AiTutorSession, from_index: int) -> None:
    if session.status != "teaching":
        raise AiTutorError(409, f"Can't advance while the lesson is '{session.status}'.", code="illegal_state")

    current = session.current_step_index or 0
    if from_index == current - 1:
        return  # idempotent retry of an advance that already succeeded
    if from_index != current:
        raise AiTutorError(409, "Your lesson position is out of date — refresh and try again.", code="stale_step")

    count_result = await db.execute(
        select(func.count(AiTutorStep.id)).where(AiTutorStep.session_id == session.id)
    )
    step_count = count_result.scalar() or 0
    next_index = current + 1
    session.resume_segment_index = None  # that progress belonged to the step we're leaving
    if next_index >= step_count:
        session.status = "qa"
        session.current_step_index = max(step_count - 1, 0)
        db.add(AiTutorMessage(session_id=session.id, role="assistant", content=QUESTION_PROMPT))
    else:
        session.current_step_index = next_index


async def goto(db: AsyncSession, session: AiTutorSession, index: int) -> None:
    if session.status not in ("teaching", "paused"):
        raise AiTutorError(409, f"Can't jump to a step while the lesson is '{session.status}'.", code="illegal_state")
    current = session.current_step_index or 0
    if index < 0 or index > current:
        raise AiTutorError(409, "You can only jump to a step you've already reached.", code="step_not_reached")
    session.current_step_index = index


async def pause_lesson(db: AsyncSession, session: AiTutorSession, reason: str = "user") -> None:
    _transition(session, "pause")
    session.pause_reason = reason


async def resume_lesson(db: AsyncSession, session: AiTutorSession) -> None:
    _transition(session, "resume")
    session.pause_reason = None


async def skip_to_qa(db: AsyncSession, session: AiTutorSession) -> None:
    if session.status not in ("teaching", "paused", "ready"):
        raise AiTutorError(409, f"Can't skip to Q&A while the lesson is '{session.status}'.", code="illegal_state")
    session.status = "qa"
    session.pause_reason = None
    db.add(AiTutorMessage(session_id=session.id, role="assistant", content=QUESTION_PROMPT))


async def restart_lesson(db: AsyncSession, session: AiTutorSession) -> None:
    _transition(session, "restart")
    session.current_step_index = 0
    session.pause_reason = None
    session.resume_segment_index = None


# ─────────────────────────────  chat / Q&A  ─────────────────────────────

def _build_context(sources: list[dict], pinned_pages: set) -> str:
    pinned, rest = [], []
    for s in sources:
        for p in s["pages"]:
            entry = f'<source name="{s["name"]}"><page n="{p["page"]}">\n{p["text"]}\n</page></source>'
            (pinned if (s["id"], p["page"]) in pinned_pages else rest).append(entry)

    budget = CONTEXT_CHAR_BUDGET
    out = []
    for entry in pinned + rest:
        if budget <= 0:
            break
        out.append(entry)
        budget -= len(entry)
    return "\n".join(out)


async def _recent_history(db: AsyncSession, session_id: int, limit: int = 10) -> list[dict]:
    result = await db.execute(
        select(AiTutorMessage)
        .where(AiTutorMessage.session_id == session_id, AiTutorMessage.role.in_(["user", "assistant"]))
        .order_by(AiTutorMessage.created_at.desc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    rows.reverse()
    if rows and rows[-1].role == "user":
        rows = rows[:-1]  # the question just asked is passed separately
    return [{"role": m.role, "content": m.content} for m in rows]


async def ask_question(
    db: AsyncSession, session: AiTutorSession, content: str, revealed_segments: Optional[int] = None,
) -> dict:
    if session.status not in ("ready", "teaching", "paused", "qa"):
        raise AiTutorError(409, f"Can't ask a question while the lesson is '{session.status}'.", code="illegal_state")

    content = (content or "").strip()
    if not content:
        raise AiTutorError(422, "The question can't be empty.")

    db.add(AiTutorMessage(session_id=session.id, role="user", content=content))

    resume_available = False
    resume_step = None
    pinned_pages: set = set()
    current_step = None

    if session.current_step_index is not None:
        step_result = await db.execute(
            select(AiTutorStep).where(
                AiTutorStep.session_id == session.id, AiTutorStep.step_index == session.current_step_index
            )
        )
        current_step = step_result.scalar_one_or_none()

    if session.status == "teaching":
        session.status = "paused"
        session.pause_reason = "question"
        resume_available = True
        resume_step = session.current_step_index
        # So the client can restore playback here even if the page is reloaded before resuming.
        if revealed_segments is not None:
            session.resume_segment_index = max(0, revealed_segments)
        if current_step and current_step.source_refs:
            pinned_pages = {(r["source_id"], r["page"]) for r in current_step.source_refs}

    sources = _session_sources_payload(session)
    context = _build_context(sources, pinned_pages)
    history = await _recent_history(db, session.id)
    is_topic_only = session.input_type in ("text", "voice")

    try:
        if current_step and current_step.content and _is_confused_message(content):
            segments_text = " ".join(s.get("text", "") for s in current_step.content.get("segments", []))
            answer = await reexplain_step(
                step_title=current_step.title, step_summary=current_step.summary or "",
                step_text=segments_text, level=session.level,
            )
        else:
            answer = await answer_question(
                question=content, context=context, history=history, level=session.level,
                is_topic_only=is_topic_only,
            )
        meta = {"resume_available": resume_available, "resume_step": resume_step}
    except AiTutorLLMError as exc:
        # Answered with a friendly failure message rather than raising: raising here would
        # make FastAPI's get_db() dependency roll back the transaction (including the pause
        # transition above and the user's question), losing state the learner already caused.
        answer = f"Sorry, I couldn't answer that just now. Please try asking again. ({exc})"
        meta = {"resume_available": resume_available, "resume_step": resume_step, "error": True}

    message = AiTutorMessage(session_id=session.id, role="assistant", content=answer, meta=meta)
    db.add(message)
    await db.flush()
    await db.refresh(message)
    return {"message": message, "resume_available": resume_available, "resume_step": resume_step}


async def list_messages(db: AsyncSession, session_id: int) -> list[AiTutorMessage]:
    result = await db.execute(
        select(AiTutorMessage).where(AiTutorMessage.session_id == session_id).order_by(AiTutorMessage.created_at)
    )
    return list(result.scalars().all())

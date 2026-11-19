from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

# input_type values
INPUT_TYPES = ["pdf", "word", "voice", "text"]

# level values (teaching style, not UK key stage)
LEVELS = ["low", "medium", "high"]

# mode values
MODE_GUIDED = "guided"
MODE_QA_ONLY = "qa_only"
MODES = [MODE_GUIDED, MODE_QA_ONLY]

# status values — draft -> processing -> (ready|qa|failed); ready -> teaching <-> paused -> qa
STATUSES = ["draft", "processing", "ready", "teaching", "paused", "qa", "failed"]


class AiTutorSession(Base):
    __tablename__ = "ai_tutor_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    input_type: Mapped[str] = mapped_column(String(10), nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default=MODE_GUIDED)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)
    pause_reason: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    title: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    # For text/voice sessions: the learner's typed/spoken question.
    question_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_step_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # How many of the current step's narration segments had already played when a mid-lesson
    # question last auto-paused the lesson — lets the client resume playback from there (rather
    # than from the top of the step) even across a page reload. Cleared once the step advances.
    resume_segment_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    outline: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    warnings: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    sources: Mapped[list["AiTutorSource"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    steps: Mapped[list["AiTutorStep"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="AiTutorStep.step_index"
    )
    messages: Mapped[list["AiTutorMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="AiTutorMessage.created_at"
    )


class AiTutorSource(Base):
    __tablename__ = "ai_tutor_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ai_tutor_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_type: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # pdf | docx
    # Extracted text, paginated: [{"page": 1, "text": "..."}]
    pages: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    session: Mapped["AiTutorSession"] = relationship(back_populates="sources")


class AiTutorStep(Base):
    __tablename__ = "ai_tutor_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ai_tutor_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_refs: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    level_snapshot: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    # {"segments": [...], "board": [...], "highlights": [...], "check_question": {...}, "key_takeaway": str}
    content: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    session: Mapped["AiTutorSession"] = relationship(back_populates="steps")


class AiTutorMessage(Base):
    __tablename__ = "ai_tutor_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ai_tutor_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # user | assistant | event
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    meta: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    session: Mapped["AiTutorSession"] = relationship(back_populates="messages")

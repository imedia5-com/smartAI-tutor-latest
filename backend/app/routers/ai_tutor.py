import logging
import os
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_any_authenticated
from app.models.ai_tutor import AiTutorSession
from app.models.user import User
from app.schemas.ai_tutor import (
    AiTutorAdvanceIn, AiTutorAnswerOut, AiTutorLevelPatch, AiTutorMessageIn, AiTutorMessageOut,
    AiTutorQuestionTextIn, AiTutorSessionCreate, AiTutorSessionOut, AiTutorSessionSummary,
    AiTutorSourceOut, AiTutorStepOut,
)
from app.services import ai_tutor_service
from app.services.ai_tutor_llm import AiTutorLLMError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-tutor", tags=["ai-tutor"])


async def _get_session(
    session_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
) -> AiTutorSession:
    session = await ai_tutor_service.get_owned_session(db, session_id, current_user.id)
    if session is None:
        raise HTTPException(status_code=404, detail="AI Tutor session not found")
    return session


def _raise(exc: ai_tutor_service.AiTutorError):
    raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.post("/sessions", response_model=AiTutorSessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: AiTutorSessionCreate,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    session = await ai_tutor_service.create_session(db, current_user.id, body.input_type, body.level, body.mode)
    return session


@router.get("/sessions", response_model=List[AiTutorSessionSummary])
async def list_sessions(
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    sessions = await ai_tutor_service.list_sessions(db, current_user.id)
    return [
        AiTutorSessionSummary(
            id=s.id, input_type=s.input_type, level=s.level, mode=s.mode, status=s.status,
            title=s.title, current_step_index=s.current_step_index,
            total_steps=len(s.outline) if s.outline else None,
            created_at=s.created_at, updated_at=s.updated_at,
        )
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=AiTutorSessionOut)
async def get_session(session: AiTutorSession = Depends(_get_session)):
    return session


@router.get("/sessions/{session_id}/sources/{source_id}/file")
async def get_source_file(
    source_id: int,
    session: AiTutorSession = Depends(_get_session),
):
    try:
        source = ai_tutor_service.find_source(session, source_id)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    if not source.file_path or not os.path.exists(source.file_path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = "application/pdf" if source.file_type == "pdf" else "application/octet-stream"
    return FileResponse(source.file_path, media_type=media_type, filename=source.name)


@router.post("/sessions/{session_id}/sources", response_model=List[AiTutorSourceOut], status_code=status.HTTP_201_CREATED)
async def upload_sources(
    session: AiTutorSession = Depends(_get_session),
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        created = await ai_tutor_service.upload_sources(db, session, files)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return created


@router.post("/sessions/{session_id}/question", response_model=AiTutorSourceOut, status_code=status.HTTP_201_CREATED)
async def set_question(
    body: AiTutorQuestionTextIn,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        source = await ai_tutor_service.set_question(db, session, body.text, body.spoken)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return source


@router.post("/sessions/{session_id}/generate", response_model=AiTutorSessionOut, status_code=status.HTTP_202_ACCEPTED)
async def generate(
    background_tasks: BackgroundTasks,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        await ai_tutor_service.begin_generation(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    await db.flush()
    background_tasks.add_task(ai_tutor_service.run_generation, session.id)
    return session


@router.post("/sessions/{session_id}/retry", response_model=AiTutorSessionOut, status_code=status.HTTP_202_ACCEPTED)
async def retry(
    background_tasks: BackgroundTasks,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        await ai_tutor_service.retry_generation(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    await db.flush()
    background_tasks.add_task(ai_tutor_service.run_generation, session.id)
    return session


@router.get("/sessions/{session_id}/steps/{step_index}", response_model=AiTutorStepOut)
async def get_step(
    step_index: int,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        step = await ai_tutor_service.get_step(db, session, step_index)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    except AiTutorLLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return AiTutorStepOut(
        step_index=step.step_index, title=step.title, status=step.status,
        level=step.level_snapshot, content=step.content, error_message=step.error_message,
    )


@router.post("/sessions/{session_id}/start", response_model=AiTutorSessionOut)
async def start(session: AiTutorSession = Depends(_get_session), db: AsyncSession = Depends(get_db)):
    try:
        await ai_tutor_service.start_lesson(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.post("/sessions/{session_id}/advance", response_model=AiTutorSessionOut)
async def advance(
    body: AiTutorAdvanceIn,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        await ai_tutor_service.advance(db, session, body.from_index)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.post("/sessions/{session_id}/goto/{index}", response_model=AiTutorSessionOut)
async def goto(
    index: int,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        await ai_tutor_service.goto(db, session, index)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.post("/sessions/{session_id}/pause", response_model=AiTutorSessionOut)
async def pause(session: AiTutorSession = Depends(_get_session), db: AsyncSession = Depends(get_db)):
    try:
        await ai_tutor_service.pause_lesson(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.post("/sessions/{session_id}/resume", response_model=AiTutorSessionOut)
async def resume(session: AiTutorSession = Depends(_get_session), db: AsyncSession = Depends(get_db)):
    try:
        await ai_tutor_service.resume_lesson(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.post("/sessions/{session_id}/skip", response_model=AiTutorSessionOut)
async def skip(session: AiTutorSession = Depends(_get_session), db: AsyncSession = Depends(get_db)):
    try:
        await ai_tutor_service.skip_to_qa(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.post("/sessions/{session_id}/restart", response_model=AiTutorSessionOut)
async def restart(session: AiTutorSession = Depends(_get_session), db: AsyncSession = Depends(get_db)):
    try:
        await ai_tutor_service.restart_lesson(db, session)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return session


@router.get("/sessions/{session_id}/messages", response_model=List[AiTutorMessageOut])
async def list_messages(session: AiTutorSession = Depends(_get_session), db: AsyncSession = Depends(get_db)):
    return await ai_tutor_service.list_messages(db, session.id)


@router.post("/sessions/{session_id}/messages", response_model=AiTutorAnswerOut)
async def send_message(
    body: AiTutorMessageIn,
    session: AiTutorSession = Depends(_get_session),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await ai_tutor_service.ask_question(db, session, body.content, body.revealed_segments)
    except ai_tutor_service.AiTutorError as exc:
        _raise(exc)
    return AiTutorAnswerOut(
        message=result["message"], resume_available=result["resume_available"], resume_step=result["resume_step"]
    )

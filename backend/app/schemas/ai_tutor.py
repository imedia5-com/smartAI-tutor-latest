from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Literal


class AiTutorSessionCreate(BaseModel):
    input_type: Literal["pdf", "word", "voice", "text"]
    level: Literal["low", "medium", "high"] = "medium"
    mode: Literal["guided", "qa_only"] = "guided"


class AiTutorLevelPatch(BaseModel):
    level: Literal["low", "medium", "high"]


class AiTutorQuestionTextIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    # true for the "Speak" option (browser speech-to-text transcript), false for "Type a question"
    spoken: bool = False


class AiTutorPageOut(BaseModel):
    page: int
    text: str


class AiTutorSourceOut(BaseModel):
    id: int
    name: str
    file_type: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    pages: Optional[List[AiTutorPageOut]] = None

    model_config = {"from_attributes": True}


class AiTutorSessionOut(BaseModel):
    id: int
    input_type: str
    level: str
    mode: str
    status: str
    pause_reason: Optional[str] = None
    title: Optional[str] = None
    question_text: Optional[str] = None
    current_step_index: Optional[int] = None
    resume_segment_index: Optional[int] = None
    outline: Optional[List[dict]] = None
    warnings: List[str] = []
    error_message: Optional[str] = None
    sources: List[AiTutorSourceOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiTutorSessionSummary(BaseModel):
    id: int
    input_type: str
    level: str
    mode: str
    status: str
    title: Optional[str] = None
    current_step_index: Optional[int] = None
    total_steps: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiTutorStepOut(BaseModel):
    step_index: int
    title: str
    status: str
    level: Optional[str] = None
    content: Optional[dict] = None
    error_message: Optional[str] = None


class AiTutorAdvanceIn(BaseModel):
    from_index: int


class AiTutorMessageIn(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    # How many narration segments of the current step the client had already shown when this
    # question was sent — saved so playback can resume from there rather than the step's start.
    revealed_segments: Optional[int] = None


class AiTutorMessageOut(BaseModel):
    id: int
    role: str
    content: str
    meta: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AiTutorAnswerOut(BaseModel):
    message: AiTutorMessageOut
    resume_available: bool = False
    resume_step: Optional[int] = None

"""Deterministic unit tests for the AI Tutor chat classification (feature: kid-friendly tone).

Pure — no DB or network — so they run anywhere pytest is available:
    pytest backend/tests/test_ai_tutor_chat_tone.py

Covers the Python-level routing (greeting / confused regexes) with real behavioural tests.
On-topic / related / off-topic / inappropriate are judged by the LLM itself (no regex can tell
"what about butterflies?" from "who will win the football match?"), so those are covered by a
content check on the system prompt that carries the classification instructions to the model.
"""
from app.services.ai_tutor_service import _is_confused_message, _is_greeting_message
from app.services.ai_tutor_llm import _QA_STYLE


# ---- category 1: greeting / small talk ----

def test_common_greetings_are_detected():
    for msg in ["hi", "hi!", "hello", "hey", "yo", "yo?", "sup", "hiya", "good morning"]:
        assert _is_greeting_message(msg), f"{msg!r} should be a greeting"


def test_small_talk_variants_are_detected():
    for msg in ["how are you", "how are you doing?", "thanks", "thank you", "ty", "bye"]:
        assert _is_greeting_message(msg), f"{msg!r} should be a greeting"


def test_greeting_followed_by_a_real_question_is_not_just_a_greeting():
    # "hi" at the start shouldn't swallow an actual on-topic question.
    assert not _is_greeting_message("hi can you explain photosynthesis to me please")


def test_greeting_check_is_case_insensitive_and_tolerates_punctuation():
    assert _is_greeting_message("HELLO!!")
    assert _is_greeting_message("Hey,")


# ---- category 2: confused (existing behaviour, re-verified here) ----

def test_casual_confused_fillers_are_detected():
    for msg in ["bro", "wth", "huh", "wth?", "idk"]:
        assert _is_confused_message(msg), f"{msg!r} should be treated as confusion"


def test_explicit_confusion_phrases_are_detected():
    assert _is_confused_message("I don't get it")
    assert _is_confused_message("this is confusing")
    assert _is_confused_message("ok i dont get it")


def test_confusion_regex_does_not_misfire_on_a_real_question():
    # A real question that happens to contain "confusing" should not be swallowed.
    assert not _is_confused_message("why does the confusing diagram show two arrows?")


def test_greetings_and_confusion_are_mutually_exclusive():
    greetings = ["hi", "hello", "hey", "yo", "thanks", "bye"]
    confused = ["bro", "wth", "huh", "idk", "i don't get it"]
    for msg in greetings:
        assert not _is_confused_message(msg), f"{msg!r} should not read as confusion"
    for msg in confused:
        assert not _is_greeting_message(msg), f"{msg!r} should not read as a greeting"


# ---- categories 3-6: on-topic / related / off-topic / inappropriate ----
# These require semantic judgement only the LLM can make, so we assert the classification
# framework itself is present (and hasn't regressed) in the prompt sent to the model.

def test_qa_style_prompt_covers_on_topic_category():
    assert "ON-TOPIC" in _QA_STYLE
    assert "say where" in _QA_STYLE


def test_qa_style_prompt_covers_related_but_not_in_material_category():
    assert "RELATED BUT NOT IN THE MATERIAL" in _QA_STYLE
    assert "connect it back to the lesson" in _QA_STYLE


def test_qa_style_prompt_covers_off_topic_category():
    assert "OFF-TOPIC" in _QA_STYLE
    assert "never lecture or" in _QA_STYLE.lower()


def test_qa_style_prompt_covers_inappropriate_category():
    assert "INAPPROPRIATE" in _QA_STYLE
    assert "politely decline" in _QA_STYLE


def test_qa_style_prompt_sets_tone_and_length_rules():
    assert "2-5 sentences" in _QA_STYLE
    assert "same language" in _QA_STYLE
    assert "emoji" in _QA_STYLE.lower()

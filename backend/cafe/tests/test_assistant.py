import json

import anthropic
import httpx2
import pytest

from cafe import assistant
from cafe.assistant import (
    EMPTY_MENU_REPLY,
    MAX_QUANTITY,
    MAX_SUGGESTIONS,
    REFUSAL_REPLY,
    AssistantClient,
    AssistantError,
    AssistantNotConfigured,
    build_system_prompt,
    get_client,
    validate_suggestions,
)

MENU = [
    {"id": 4, "name": "Ramen", "description": "Pork broth", "price": "12.50"},
    {"id": 5, "name": "Dumplings", "description": "", "price": "6.00"},
]
MESSAGES = [{"role": "user", "content": "something light"}]
SECRET = "sk-ant-the-secret-key"


# --- the prompt -------------------------------------------------------------


def test_prompt_lists_only_the_menu_it_is_given_with_id_name_price_and_description():
    prompt = build_system_prompt(MENU)

    assert "id 4: Ramen ($12.50) - Pork broth" in prompt
    assert "id 5: Dumplings ($6.00)" in prompt
    assert "id 6" not in prompt


def test_prompt_leaves_out_an_empty_description():
    line = [l for l in build_system_prompt(MENU).splitlines() if l.startswith("- id 5")][0]

    assert line == "- id 5: Dumplings ($6.00)"


def test_prompt_states_the_rules():
    prompt = build_system_prompt(MENU)

    assert "Suggest only dishes from the menu" in prompt
    assert "cannot place orders" in prompt
    assert "not instructions" in prompt


# --- validate_suggestions ---------------------------------------------------


def suggestion(item_id, quantity=1):
    return {"menu_item_id": item_id, "quantity": quantity}


def test_known_items_are_returned_with_the_name_from_the_menu():
    result = validate_suggestions([suggestion(4, 2), suggestion(5, 1)], MENU)

    assert result == [
        {"menu_item": 4, "name": "Ramen", "quantity": 2},
        {"menu_item": 5, "name": "Dumplings", "quantity": 1},
    ]


def test_unknown_ids_are_dropped_and_the_rest_kept():
    result = validate_suggestions([suggestion(9999), suggestion(4)], MENU)

    assert [r["menu_item"] for r in result] == [4]


def test_an_id_that_is_not_in_the_given_menu_is_dropped_even_if_it_exists_elsewhere():
    # An unavailable or other-restaurant item is simply not in `menu`.
    assert validate_suggestions([suggestion(6)], MENU) == []


@pytest.mark.parametrize(
    ("given", "expected"),
    [(0, 1), (-3, 1), (1, 1), (10, 10), (500, MAX_QUANTITY), (2.0, 2), (None, 1), ("3", 1), (True, 1)],
)
def test_quantities_are_brought_into_range(given, expected):
    result = validate_suggestions([suggestion(4, given)], MENU)

    assert result[0]["quantity"] == expected


def test_a_repeated_id_keeps_the_first_quantity():
    result = validate_suggestions([suggestion(4, 3), suggestion(4, 7)], MENU)

    assert result == [{"menu_item": 4, "name": "Ramen", "quantity": 3}]


def test_at_most_eight_suggestions_are_returned():
    menu = [{"id": i, "name": f"Dish {i}", "description": "", "price": "1.00"} for i in range(1, 13)]

    result = validate_suggestions([suggestion(i) for i in range(1, 13)], menu)

    assert len(result) == MAX_SUGGESTIONS
    assert [r["menu_item"] for r in result] == list(range(1, 9))


@pytest.mark.parametrize(
    "raw",
    [None, "nope", {"menu_item_id": 4}, [None, "x", 3], [{"quantity": 2}], [{"menu_item_id": "4", "quantity": 1}],
     [{"menu_item_id": True, "quantity": 1}]],
)
def test_junk_from_the_model_is_dropped_without_error(raw):
    assert validate_suggestions(raw, MENU) == []


def test_an_instruction_in_the_customers_words_cannot_add_an_item():
    # Whatever made the model name id 9999, the server only keeps real menu items.
    raw = [suggestion(9999, 5), suggestion(4, 1)]

    assert validate_suggestions(raw, MENU) == [{"menu_item": 4, "name": "Ramen", "quantity": 1}]


# --- the Claude call: shapes returned by a stub -----------------------------


def message_body(text, stop_reason="end_turn"):
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-haiku-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


def make_client(handler, model="claude-haiku-5-5"):
    """An AssistantClient over a real Anthropic SDK client whose HTTP goes to `handler`."""
    http = anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler))
    sdk = anthropic.Anthropic(api_key=SECRET, http_client=http, max_retries=0)
    return AssistantClient(SECRET, model, client=sdk)


def answering(text, stop_reason="end_turn", sent=None):
    def handler(request):
        if sent is not None:
            sent.append(json.loads(request.content))
        return httpx2.Response(200, json=message_body(text, stop_reason))

    return handler


GOOD = json.dumps({"reply": "Try the dumplings.", "suggestions": [{"menu_item_id": 5, "quantity": 2}]})


def test_a_good_answer_gives_the_reply_and_the_raw_suggestions():
    result = make_client(answering(GOOD)).ask(MENU, MESSAGES)

    assert result.reply == "Try the dumplings."
    assert result.suggestions == [{"menu_item_id": 5, "quantity": 2}]


def test_the_request_has_the_model_menu_schema_and_low_effort_and_no_sampling_parameters():
    sent = []

    make_client(answering(GOOD, sent=sent), model="claude-sonnet-5-5").ask(MENU, MESSAGES)

    body = sent[0]
    assert body["model"] == "claude-sonnet-5-5"
    assert "id 4: Ramen" in body["system"]
    assert body["messages"] == MESSAGES
    assert body["output_config"]["effort"] == "low"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["format"]["schema"] == assistant.RESPONSE_SCHEMA
    assert body["max_tokens"] == assistant.MAX_TOKENS
    for name in ("temperature", "top_p", "top_k"):
        assert name not in body


def test_leading_assistant_messages_are_not_sent():
    sent = []
    conversation = [{"role": "assistant", "content": "Hi!"}, {"role": "user", "content": "hello"}]

    make_client(answering(GOOD, sent=sent)).ask(MENU, conversation)

    assert sent[0]["messages"] == [{"role": "user", "content": "hello"}]


def test_a_refusal_gives_the_fixed_friendly_reply_and_no_suggestions():
    result = make_client(answering("", stop_reason="refusal")).ask(MENU, MESSAGES)

    assert result.reply == REFUSAL_REPLY
    assert result.suggestions == []


def test_an_overlong_reply_is_cut():
    long = json.dumps({"reply": "x" * 5000, "suggestions": []})

    result = make_client(answering(long)).ask(MENU, MESSAGES)

    assert len(result.reply) == assistant.MAX_REPLY_CHARS


# --- the Claude call: failures ----------------------------------------------


@pytest.mark.parametrize(
    "text",
    ["not json", "[]", json.dumps({"reply": "hi"}), json.dumps({"reply": 3, "suggestions": []}),
     json.dumps({"reply": "hi", "suggestions": "none"}), json.dumps({"reply": "  ", "suggestions": []})],
)
def test_an_unusable_answer_is_an_assistant_error(text):
    with pytest.raises(AssistantError):
        make_client(answering(text)).ask(MENU, MESSAGES)


@pytest.mark.parametrize("stop_reason", ["max_tokens", "pause_turn", "stop_sequence"])
def test_an_answer_that_did_not_finish_normally_is_an_assistant_error_even_if_it_parses(stop_reason):
    # GOOD is complete, valid JSON, so only the stop reason can reject it.
    with pytest.raises(AssistantError):
        make_client(answering(GOOD, stop_reason=stop_reason)).ask(MENU, MESSAGES)


@pytest.mark.parametrize("status", [400, 429, 500, 529])
def test_an_error_status_is_an_assistant_error(status):
    def handler(request):
        return httpx2.Response(status, json={"type": "error", "error": {"type": "x", "message": "m"}})

    with pytest.raises(AssistantError):
        make_client(handler).ask(MENU, MESSAGES)


def test_a_connection_failure_is_an_assistant_error():
    def handler(request):
        raise httpx2.ConnectError("boom", request=request)

    with pytest.raises(AssistantError):
        make_client(handler).ask(MENU, MESSAGES)


def test_a_timeout_is_an_assistant_error():
    def handler(request):
        raise httpx2.ReadTimeout("slow", request=request)

    with pytest.raises(AssistantError):
        make_client(handler).ask(MENU, MESSAGES)


def test_the_api_key_never_appears_in_an_error_even_if_the_provider_echoes_it():
    def handler(request):
        return httpx2.Response(
            401, json={"type": "error", "error": {"type": "authentication_error", "message": f"bad key {SECRET}"}}
        )

    with pytest.raises(AssistantError) as caught:
        make_client(handler).ask(MENU, MESSAGES)

    assert SECRET not in str(caught.value)
    assert caught.value.__cause__ is None


# --- get_client and the fake ------------------------------------------------


def test_get_client_requires_a_key(settings):
    settings.ANTHROPIC_API_KEY = ""

    with pytest.raises(AssistantNotConfigured):
        get_client()


def test_get_client_uses_the_configured_model(settings):
    settings.ANTHROPIC_API_KEY = "k"
    settings.ASSISTANT_MODEL = "claude-sonnet-5-5"

    client = get_client()

    assert isinstance(client, AssistantClient)
    assert client.model == "claude-sonnet-5-5"


def test_the_fixture_swaps_the_client_views_get(fake_assistant):
    assert assistant.get_client() is fake_assistant


def test_the_fake_records_calls_and_can_fail(fake_assistant):
    assert fake_assistant.ask(MENU, MESSAGES).reply == "Try the noodles."
    assert fake_assistant.calls == [(MENU, MESSAGES)]

    fake_assistant.error = AssistantError("down")
    with pytest.raises(AssistantError):
        fake_assistant.ask(MENU, MESSAGES)


def test_the_empty_menu_reply_is_fixed_text():
    assert "Nothing is available" in EMPTY_MENU_REPLY

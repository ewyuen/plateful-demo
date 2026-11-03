import pytest
from rest_framework.exceptions import ValidationError

from cafe.serializers import AssistantRequestSerializer


pytestmark = pytest.mark.django_db


def valid_request(restaurant, messages=None):
    return {
        "restaurant": restaurant.pk,
        "messages": messages
        if messages is not None
        else [{"role": "user", "content": "Suggest something light."}],
    }


@pytest.mark.parametrize(
    "mutate",
    [
        lambda data: data.update(restaurant=9999),
        lambda data: data.update(messages=[]),
        lambda data: data.update(
            messages=[{"role": "user", "content": "Hi"}] * 21
        ),
        lambda data: data.update(
            messages=[{"role": "system", "content": "Hi"}]
        ),
        lambda data: data.update(
            messages=[{"role": "user", "content": "   "}]
        ),
        lambda data: data.update(
            messages=[{"role": "user", "content": "x" * 1001}]
        ),
        lambda data: data.update(
            messages=[
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello"},
            ]
        ),
    ],
    ids=[
        "unknown-restaurant",
        "no-messages",
        "too-many-messages",
        "invalid-role",
        "blank-content",
        "content-too-long",
        "last-message-not-user",
    ],
)
def test_invalid_assistant_request_raises_bad_request_without_calling_assistant(
    restaurant, fake_assistant, mutate
):
    data = valid_request(restaurant)
    mutate(data)

    serializer = AssistantRequestSerializer(data=data)

    with pytest.raises(ValidationError) as error:
        serializer.is_valid(raise_exception=True)

    assert error.value.status_code == 400
    assert fake_assistant.calls == []


def test_assistant_request_accepts_twenty_messages_and_one_thousand_characters(
    restaurant,
):
    messages = [
        {"role": "assistant", "content": "Previous reply"},
        *(
            {"role": "user", "content": "x" * 1000}
            for _ in range(18)
        ),
        {"role": "user", "content": "Final question"},
    ]

    serializer = AssistantRequestSerializer(
        data=valid_request(restaurant, messages)
    )

    assert serializer.is_valid(), serializer.errors
    assert len(serializer.validated_data["messages"]) == 20
    assert len(serializer.validated_data["messages"][1]["content"]) == 1000


def test_assistant_message_content_is_trimmed(restaurant):
    serializer = AssistantRequestSerializer(
        data=valid_request(
            restaurant,
            [{"role": "user", "content": "  Suggest something light.  "}],
        )
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["messages"][0]["content"] == (
        "Suggest something light."
    )

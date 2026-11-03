import pytest

from cafe import codes


def test_a_code_has_twelve_characters_from_the_alphabet():
    for _ in range(200):
        code = codes.generate()
        assert len(code) == 12
        assert all(char in codes.ALPHABET for char in code)


def test_the_alphabet_has_no_look_alikes():
    assert len(codes.ALPHABET) == 31
    assert not set("ILO01") & set(codes.ALPHABET)


def test_codes_do_not_repeat_over_many_draws():
    drawn = {codes.generate() for _ in range(5000)}

    assert len(drawn) == 5000


def test_every_position_uses_the_whole_alphabet_over_many_draws():
    drawn = [codes.generate() for _ in range(4000)]

    for position in range(12):
        assert {code[position] for code in drawn} == set(codes.ALPHABET)


def test_codes_are_not_made_from_a_counter():
    first, second = codes.generate(), codes.generate()

    assert first != second and first[:6] != second[:6]


def test_display_groups_the_code_in_fours():
    assert codes.display("ABCDEFGHJKMN") == "ABCD-EFGH-JKMN"


@pytest.mark.parametrize(
    "typed",
    ["abcd-efgh-jkmn", "ABCDEFGHJKMN", " abcd efgh jkmn ", "ABCD-EFGH-JKMN", "abcdefghjkmn"],
)
def test_normalize_ignores_case_hyphens_and_spaces(typed):
    assert codes.normalize(typed) == "ABCDEFGHJKMN"


@pytest.mark.parametrize(
    "typed",
    ["", "ABCD-EFGH", "ABCD-EFGH-JKMN-P", "ABCD-EFGH-JKM1", "ABCD-EFGH-JKMO", "ABCD-EFGH-JKM!", "x" * 500, None, 5, ["a"], {"a": 1}],
)
def test_normalize_refuses_what_cannot_be_a_code(typed):
    assert codes.normalize(typed) is None


def test_a_generated_code_survives_display_and_normalize():
    code = codes.generate()

    assert codes.normalize(codes.display(code)) == code

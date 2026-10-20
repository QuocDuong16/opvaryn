package store

import "testing"

// A person searching for "50%" means the text "50%": the wildcards of the pattern must be
// escaped, or the search returns everything that has any value.
func TestLikeTermEscapesTheWildcards(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		term string
		want string
	}{
		{name: "a plain term stays as it is", term: "ghi chú", want: "ghi chú"},
		{name: "an empty term stays empty", term: "", want: ""},
		{name: "the percent sign is literal", term: "50%", want: `50\%`},
		{name: "the underscore is literal", term: "a_b", want: `a\_b`},
		{name: "the backslash is literal", term: `a\b`, want: `a\\b`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := likeTerm(testCase.term); got != testCase.want {
				t.Fatalf("likeTerm(%q) = %q, want %q", testCase.term, got, testCase.want)
			}
		})
	}
}

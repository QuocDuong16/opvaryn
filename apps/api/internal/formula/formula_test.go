package formula

import (
	"math"
	"testing"
)

// The expressions a definition can hold: arithmetic, comparisons, brackets and the few
// functions that make sense on a form (ADR 0032).
func TestEvaluateComputesTheExpression(t *testing.T) {
	t.Parallel()

	value := Value{
		Fields: map[string]any{
			"amount":   float64(1500000),
			"quantity": float64(3),
			"rate":     float64(0.08),
			"level":    "cao",
			"done":     true,
		},
	}

	cases := []struct {
		name       string
		expression string
		want       float64
	}{
		{name: "a number", expression: "42", want: 42},
		{name: "a field", expression: "amount", want: 1500000},
		{name: "a sum", expression: "amount + 500000", want: 2000000},
		{name: "a product", expression: "amount * quantity", want: 4500000},
		{name: "brackets decide the order", expression: "amount + quantity * 2", want: 1500006},
		{name: "brackets change the order", expression: "(amount + quantity) * 2", want: 3000006},
		{name: "a division", expression: "amount / quantity", want: 500000},
		{name: "a rounded value", expression: "ROUND(amount * rate, 0)", want: 120000},
		{name: "an absolute value", expression: "ABS(0 - amount)", want: 1500000},
		{name: "the smaller of two", expression: "MIN(amount, quantity)", want: 3},
		{name: "the bigger of two", expression: "MAX(amount, quantity)", want: 1500000},
		{name: "a choice", expression: "amount > 1000000 ? 1 : 0", want: 1},
		{name: "a choice the other way", expression: "amount > 9000000 ? 1 : 0", want: 0},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			result, err := Evaluate(testCase.expression, value)
			if err != nil {
				t.Fatalf("evaluate %q: %v", testCase.expression, err)
			}
			number, ok := result.(Number)
			if !ok {
				t.Fatalf("evaluate %q = %T, want a number", testCase.expression, result)
			}
			if math.Abs(float64(number)-testCase.want) > 0.0001 {
				t.Fatalf("evaluate %q = %v, want %v", testCase.expression, number, testCase.want)
			}
		})
	}
}

// A field that is empty is zero, not an error: a form is filled in piece by piece.
func TestEvaluateTreatsAMissingFieldAsZero(t *testing.T) {
	t.Parallel()

	result, err := Evaluate("missing + 5", Value{Fields: map[string]any{}})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if result != Number(5) {
		t.Fatalf("evaluate = %v, want 5", result)
	}
}

// A broken expression is refused with a sentence, never evaluated.
func TestEvaluateRefusesBrokenExpressions(t *testing.T) {
	t.Parallel()

	expressions := []string{
		"amount +",
		"(amount",
		"amount $ 2",
		"ROUND(amount)",
		"UNKNOWN(1)",
		"amount 2",
	}
	for _, expression := range expressions {
		if _, err := Evaluate(expression, Value{Fields: map[string]any{"amount": float64(1)}}); err == nil {
			t.Fatalf("%q must be refused", expression)
		}
	}
}

// The fields an expression reads are known, so a definition can be checked against itself.
func TestFieldsListsWhatTheExpressionReads(t *testing.T) {
	t.Parallel()

	keys, err := Fields("amount * quantity + ROUND(rate, 2)")
	if err != nil {
		t.Fatalf("fields: %v", err)
	}
	found := map[string]bool{}
	for _, key := range keys {
		found[key] = true
	}
	for _, key := range []string{"amount", "quantity", "rate"} {
		if !found[key] {
			t.Fatalf("the expression reads %q, but the fields are %v", key, keys)
		}
	}
}

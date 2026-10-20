package formula

import (
	"math"
	"strings"
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
		{name: "both conditions hold", expression: "amount > 1000000 && quantity > 2 ? 1 : 0", want: 1},
		{name: "one condition does not hold", expression: "amount > 1000000 && quantity > 5 ? 1 : 0", want: 0},
		{name: "either condition holds", expression: "amount > 9000000 || quantity > 2 ? 1 : 0", want: 1},
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

// The kind of an expression is known before any record exists, so a definition can
// refuse a computed field that would not hold a number (ADR 0036).
func TestResultKindReadsWhatTheExpressionProduces(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		expression string
		want       Kind
	}{
		{name: "a number", expression: "42", want: KindNumber},
		{name: "a field", expression: "amount", want: KindNumber},
		{name: "arithmetic", expression: "amount * quantity", want: KindNumber},
		{name: "a function", expression: "ROUND(amount * rate, 0)", want: KindNumber},
		{name: "a choice of numbers", expression: "amount > 1000 ? 1 : 0", want: KindNumber},
		{name: "a comparison", expression: "amount > 1000", want: KindBool},
		{name: "a logical operator", expression: "amount > 1 && quantity > 2", want: KindBool},
		{name: "a choice of yes or no", expression: "amount > 1000 ? 1 : 0", want: KindNumber},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			kind, err := ResultKind(testCase.expression)
			if err != nil {
				t.Fatalf("the kind of %q: %v", testCase.expression, err)
			}
			if kind != testCase.want {
				t.Fatalf("the kind of %q = %q, want %q", testCase.expression, kind, testCase.want)
			}
		})
	}
}

// A broken expression has no kind: it is refused like a broken evaluation.
func TestResultKindRefusesBrokenExpressions(t *testing.T) {
	t.Parallel()

	if _, err := ResultKind("amount +"); err == nil {
		t.Fatal("a broken expression must have no kind")
	}
}

// A huge expression is refused, not parsed: the cost of a definition must stay small.
func TestEvaluateRefusesAHugeExpression(t *testing.T) {
	t.Parallel()

	huge := strings.Repeat("1 + ", 500) + "1"
	if _, err := Evaluate(huge, Value{Fields: map[string]any{}}); err == nil {
		t.Fatal("a huge expression must be refused")
	}
}

// Only numbers can be read: a text field has no number to add.
func TestEvaluateRefusesToAddText(t *testing.T) {
	t.Parallel()

	value := Value{Fields: map[string]any{"title": "Màn hình"}}
	if _, err := Evaluate("title + 1", value); err == nil {
		t.Fatal("adding a text must be refused")
	}
}

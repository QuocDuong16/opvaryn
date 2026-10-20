// Package formula evaluates the computed fields of a business object (ADR 0032).
//
// The expressions are small on purpose: a number, a field of the record, arithmetic, a
// comparison, and a few functions. Nothing is evaluated as code — the expression is parsed
// into a tree and walked, so a definition can never run anything it should not.
package formula

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Value is what an expression works with: the fields of the record, and the rows of a
// table field.
type Value struct {
	// Fields are the record's values, keyed by field key.
	Fields map[string]any
	// Tables are the rows of the table fields, keyed by field key.
	Tables map[string][]map[string]any
}

// Number is a number in an expression: the result of the arithmetic, or a field's value.
type Number float64

// Bool is the result of a comparison.
type Bool bool

// Text is a string in an expression.
type Text string

// Evaluate computes the expression against the record and returns its value: a Number, a
// Bool or a Text.
func Evaluate(expression string, value Value) (any, error) {
	tokens, err := tokenize(expression)
	if err != nil {
		return nil, err
	}
	parser := &parser{tokens: tokens, value: value}
	node, err := parser.parseExpression()
	if err != nil {
		return nil, err
	}
	if !parser.done() {
		return nil, fmt.Errorf("the expression has something left over: %q", expression)
	}
	return node.evaluate()
}

// Fields returns the field keys the expression reads, so a definition can be checked
// against its own fields.
func Fields(expression string) ([]string, error) {
	tokens, err := tokenize(expression)
	if err != nil {
		return nil, err
	}
	parser := &parser{tokens: tokens, value: Value{}}
	node, err := parser.parseExpression()
	if err != nil {
		return nil, err
	}
	if !parser.done() {
		return nil, fmt.Errorf("the expression has something left over: %q", expression)
	}
	seen := map[string]bool{}
	collectFields(node, seen)
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	return keys, nil
}

// ---------------------------------------------------------------- tokens ----

type tokenKind int

const (
	tokenNumber tokenKind = iota
	tokenField
	tokenOperator
	tokenFunction
	tokenLeftParen
	tokenRightParen
	tokenComma
)

type token struct {
	kind   tokenKind
	text   string
	number float64
}

// tokenize splits the expression into numbers, field names, operators and punctuation.
func tokenize(expression string) ([]token, error) {
	tokens := make([]token, 0, 8)
	runes := []rune(expression)
	for i := 0; i < len(runes); {
		char := runes[i]
		switch {
		case char == ' ' || char == '\t' || char == '\n':
			i++
		case char >= '0' && char <= '9':
			start := i
			for i < len(runes) && (runes[i] >= '0' && runes[i] <= '9' || runes[i] == '.') {
				i++
			}
			number, err := strconv.ParseFloat(string(runes[start:i]), 64)
			if err != nil {
				return nil, fmt.Errorf("%q is not a number", string(runes[start:i]))
			}
			tokens = append(tokens, token{kind: tokenNumber, text: string(runes[start:i]), number: number})
		case isIdentifierStart(char):
			start := i
			for i < len(runes) && isIdentifierPart(runes[i]) {
				i++
			}
			text := string(runes[start:i])
			if i < len(runes) && runes[i] == '(' {
				tokens = append(tokens, token{kind: tokenFunction, text: strings.ToUpper(text)})
				continue
			}
			tokens = append(tokens, token{kind: tokenField, text: text})
		case char == '(':
			tokens = append(tokens, token{kind: tokenLeftParen, text: "("})
			i++
		case char == ')':
			tokens = append(tokens, token{kind: tokenRightParen, text: ")"})
			i++
		case char == ',':
			tokens = append(tokens, token{kind: tokenComma, text: ","})
			i++
		case strings.ContainsRune("+-*/<>=!?:", char):
			start := i
			i++
			if i < len(runes) && (runes[i] == '=' || (runes[i] == '&' && char == '&') || (runes[i] == '|' && char == '|')) {
				i++
			}
			tokens = append(tokens, token{kind: tokenOperator, text: string(runes[start:i])})
		default:
			return nil, fmt.Errorf("%q is not something an expression can contain", string(char))
		}
	}
	return tokens, nil
}

func isIdentifierStart(char rune) bool {
	return char == '_' || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')
}

func isIdentifierPart(char rune) bool {
	return isIdentifierStart(char) || (char >= '0' && char <= '9') || char == '.'
}

// ------------------------------------------------------------------ tree ----

// node is one step of the parsed expression.
type node interface {
	evaluate() (any, error)
}

type numberNode struct{ value float64 }

func (n numberNode) evaluate() (any, error) { return Number(n.value), nil }

type fieldNode struct {
	key    string
	values map[string]any
}

func (n fieldNode) evaluate() (any, error) {
	value, ok := n.values[n.key]
	if !ok || value == nil {
		return Number(0), nil
	}
	switch typed := value.(type) {
	case float64:
		return Number(typed), nil
	case int:
		return Number(typed), nil
	case int64:
		return Number(typed), nil
	case bool:
		return Bool(typed), nil
	case string:
		if number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
			return Number(number), nil
		}
		return Text(typed), nil
	default:
		return nil, fmt.Errorf("the field %q has a value an expression cannot use", n.key)
	}
}

type binaryNode struct {
	operator string
	left     node
	right    node
}

func (n binaryNode) evaluate() (any, error) {
	left, err := n.left.evaluate()
	if err != nil {
		return nil, err
	}
	right, err := n.right.evaluate()
	if err != nil {
		return nil, err
	}
	switch n.operator {
	case "+":
		return arithmetic(left, right, func(a, b float64) float64 { return a + b })
	case "-":
		return arithmetic(left, right, func(a, b float64) float64 { return a - b })
	case "*":
		return arithmetic(left, right, func(a, b float64) float64 { return a * b })
	case "/":
		return arithmetic(left, right, func(a, b float64) float64 {
			if b == 0 {
				return 0
			}
			return a / b
		})
	case "<", "<=", ">", ">=", "==", "!=":
		return compare(n.operator, left, right)
	case "&&":
		return Bool(isTrue(left) && isTrue(right)), nil
	case "||":
		return Bool(isTrue(left) || isTrue(right)), nil
	default:
		return nil, fmt.Errorf("%q is not an operator", n.operator)
	}
}

func arithmetic(left any, right any, apply func(a, b float64) float64) (any, error) {
	a, okA := asNumber(left)
	b, okB := asNumber(right)
	if !okA || !okB {
		return nil, fmt.Errorf("an arithmetic operator needs two numbers")
	}
	return Number(apply(a, b)), nil
}

func compare(operator string, left any, right any) (any, error) {
	if a, ok := asNumber(left); ok {
		if b, ok := asNumber(right); ok {
			switch operator {
			case "<":
				return Bool(a < b), nil
			case "<=":
				return Bool(a <= b), nil
			case ">":
				return Bool(a > b), nil
			case ">=":
				return Bool(a >= b), nil
			case "==":
				return Bool(a == b), nil
			case "!=":
				return Bool(a != b), nil
			}
		}
	}
	a := fmt.Sprintf("%v", left)
	b := fmt.Sprintf("%v", right)
	switch operator {
	case "==":
		return Bool(a == b), nil
	case "!=":
		return Bool(a != b), nil
	}
	return nil, fmt.Errorf("these two values cannot be compared")
}

func asNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case Number:
		return float64(typed), true
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	default:
		return 0, false
	}
}

func isTrue(value any) bool {
	switch typed := value.(type) {
	case Bool:
		return bool(typed)
	case bool:
		return typed
	default:
		number, ok := asNumber(value)
		return ok && number != 0
	}
}

type ternaryNode struct {
	condition node
	yes       node
	no        node
}

func (n ternaryNode) evaluate() (any, error) {
	condition, err := n.condition.evaluate()
	if err != nil {
		return nil, err
	}
	if isTrue(condition) {
		return n.yes.evaluate()
	}
	return n.no.evaluate()
}

type functionNode struct {
	name string
	args []node
}

func (n functionNode) evaluate() (any, error) {
	values := make([]any, 0, len(n.args))
	for _, argument := range n.args {
		value, err := argument.evaluate()
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	switch n.name {
	case "ROUND":
		if len(values) != 2 {
			return nil, fmt.Errorf("ROUND takes a number and a number of decimals")
		}
		number, ok := asNumber(values[0])
		if !ok {
			return nil, fmt.Errorf("ROUND needs a number")
		}
		decimals, ok := asNumber(values[1])
		if !ok {
			return nil, fmt.Errorf("ROUND needs a number of decimals")
		}
		factor := math.Pow(10, decimals)
		return Number(math.Round(number*factor) / factor), nil
	case "ABS":
		if len(values) != 1 {
			return nil, fmt.Errorf("ABS takes one number")
		}
		number, ok := asNumber(values[0])
		if !ok {
			return nil, fmt.Errorf("ABS needs a number")
		}
		return Number(math.Abs(number)), nil
	case "MIN", "MAX":
		if len(values) < 2 {
			return nil, fmt.Errorf("%s takes at least two numbers", n.name)
		}
		best, ok := asNumber(values[0])
		if !ok {
			return nil, fmt.Errorf("%s needs numbers", n.name)
		}
		for _, value := range values[1:] {
			number, ok := asNumber(value)
			if !ok {
				return nil, fmt.Errorf("%s needs numbers", n.name)
			}
			if n.name == "MIN" && number < best {
				best = number
			}
			if n.name == "MAX" && number > best {
				best = number
			}
		}
		return Number(best), nil
	default:
		return nil, fmt.Errorf("%s is not a function an expression can use", n.name)
	}
}

// ---------------------------------------------------------------- parser ----

type parser struct {
	tokens []token
	at     int
	value  Value
}

func (p *parser) done() bool { return p.at >= len(p.tokens) }

func (p *parser) peek() (token, bool) {
	if p.done() {
		return token{}, false
	}
	return p.tokens[p.at], true
}

func (p *parser) parseExpression() (node, error) {
	return p.parseTernary()
}

// parseTernary is "condition ? yes : no" — the one way to write a choice in a form.
func (p *parser) parseTernary() (node, error) {
	condition, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	current, ok := p.peek()
	if !ok || current.kind != tokenOperator || current.text != "?" {
		return condition, nil
	}
	p.at++
	yes, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	separator, ok := p.peek()
	if !ok || separator.kind != tokenOperator || separator.text != ":" {
		return nil, fmt.Errorf("a question needs a colon after the answer")
	}
	p.at++
	no, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	return ternaryNode{condition: condition, yes: yes, no: no}, nil
}

func (p *parser) parseOr() (node, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for {
		current, ok := p.peek()
		if !ok || current.kind != tokenOperator || current.text != "||" {
			return left, nil
		}
		p.at++
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = binaryNode{operator: "||", left: left, right: right}
	}
}

func (p *parser) parseAnd() (node, error) {
	left, err := p.parseComparison()
	if err != nil {
		return nil, err
	}
	for {
		current, ok := p.peek()
		if !ok || current.kind != tokenOperator || current.text != "&&" {
			return left, nil
		}
		p.at++
		right, err := p.parseComparison()
		if err != nil {
			return nil, err
		}
		left = binaryNode{operator: "&&", left: left, right: right}
	}
}

func (p *parser) parseComparison() (node, error) {
	left, err := p.parseSum()
	if err != nil {
		return nil, err
	}
	current, ok := p.peek()
	if !ok || current.kind != tokenOperator {
		return left, nil
	}
	switch current.text {
	case "<", "<=", ">", ">=", "==", "!=":
		p.at++
		right, err := p.parseSum()
		if err != nil {
			return nil, err
		}
		return binaryNode{operator: current.text, left: left, right: right}, nil
	default:
		return left, nil
	}
}

func (p *parser) parseSum() (node, error) {
	left, err := p.parseProduct()
	if err != nil {
		return nil, err
	}
	for {
		current, ok := p.peek()
		if !ok || current.kind != tokenOperator || (current.text != "+" && current.text != "-") {
			return left, nil
		}
		p.at++
		right, err := p.parseProduct()
		if err != nil {
			return nil, err
		}
		left = binaryNode{operator: current.text, left: left, right: right}
	}
}

func (p *parser) parseProduct() (node, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		current, ok := p.peek()
		if !ok || current.kind != tokenOperator || (current.text != "*" && current.text != "/") {
			return left, nil
		}
		p.at++
		right, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		left = binaryNode{operator: current.text, left: left, right: right}
	}
}

func (p *parser) parseUnary() (node, error) {
	current, ok := p.peek()
	if ok && current.kind == tokenOperator && (current.text == "-" || current.text == "+") {
		p.at++
		operand, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		if current.text == "-" {
			return binaryNode{operator: "-", left: numberNode{value: 0}, right: operand}, nil
		}
		return operand, nil
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (node, error) {
	current, ok := p.peek()
	if !ok {
		return nil, fmt.Errorf("the expression ends too early")
	}
	switch current.kind {
	case tokenNumber:
		p.at++
		return numberNode{value: current.number}, nil
	case tokenField:
		p.at++
		return fieldNode{key: current.text, values: p.value.Fields}, nil
	case tokenLeftParen:
		p.at++
		inner, err := p.parseExpression()
		if err != nil {
			return nil, err
		}
		next, ok := p.peek()
		if !ok || next.kind != tokenRightParen {
			return nil, fmt.Errorf("a bracket is not closed")
		}
		p.at++
		return inner, nil
	case tokenFunction:
		p.at++
		arguments := make([]node, 0, 2)
		next, ok := p.peek()
		if !ok || next.kind != tokenLeftParen {
			return nil, fmt.Errorf("%s needs brackets", current.text)
		}
		p.at++
		for {
			argument, err := p.parseExpression()
			if err != nil {
				return nil, err
			}
			arguments = append(arguments, argument)
			separator, ok := p.peek()
			if !ok {
				return nil, fmt.Errorf("the brackets of %s are not closed", current.text)
			}
			if separator.kind == tokenComma {
				p.at++
				continue
			}
			if separator.kind == tokenRightParen {
				p.at++
				break
			}
			return nil, fmt.Errorf("%s has something it cannot use", current.text)
		}
		return functionNode{name: current.text, args: arguments}, nil
	default:
		return nil, fmt.Errorf("%q is not something an expression can start with", current.text)
	}
}

// collectFields gathers the field keys the expression reads.
func collectFields(current node, seen map[string]bool) {
	switch typed := current.(type) {
	case fieldNode:
		seen[typed.key] = true
	case binaryNode:
		collectFields(typed.left, seen)
		collectFields(typed.right, seen)
	case functionNode:
		for _, argument := range typed.args {
			collectFields(argument, seen)
		}
	case ternaryNode:
		collectFields(typed.condition, seen)
		collectFields(typed.yes, seen)
		collectFields(typed.no, seen)
	}
}

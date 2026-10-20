package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

const (
	maxProcessNodes  = 60
	maxProcessEdges  = 120
	maxConditionText = 200
)

// processDefinitionStore is the persistence this service needs.
type processDefinitionStore interface {
	ListProcessDefinitions(
		ctx context.Context,
		query string,
		page domain.Page,
	) (domain.Paged[domain.ProcessDefinition], error)
	GetProcessDefinitionByKey(ctx context.Context, key string) (domain.ProcessDefinition, error)
	ListProcessDefinitionVersions(ctx context.Context, definitionID uuid.UUID) ([]domain.ProcessDefinitionVersion, error)
	CreateProcessDefinition(
		ctx context.Context,
		definition domain.ProcessDefinition,
		publisher string,
	) (domain.ProcessDefinition, error)
	UpdateProcessDefinition(
		ctx context.Context,
		key string,
		name string,
		description string,
		objectKey string,
		nodes []domain.ProcessNode,
		edges []domain.ProcessEdge,
		publisher string,
	) (domain.ProcessDefinition, error)
}

// definitionObjects is the read side of business objects this service needs: a
// condition is validated against the field definitions it will run on, so a typo
// is caught when the definition is published, not when an instance runs.
type definitionObjects interface {
	FindBusinessObject(ctx context.Context, key string) (domain.BusinessObject, bool, error)
}

// ProcessDefinitions creates and publishes process definitions. The graph rules
// are enforced here (ADR 0007 section 2) and the same rules apply to every
// published version, exactly like business object definitions (ADR 0006).
type ProcessDefinitions struct {
	store   processDefinitionStore
	objects definitionObjects
}

// NewProcessDefinitions returns a ProcessDefinitions service.
func NewProcessDefinitions(st processDefinitionStore, objects definitionObjects) *ProcessDefinitions {
	return &ProcessDefinitions{store: st, objects: objects}
}

// NewProcessDefinitionInput is the request to create one process definition; it
// publishes version 1 immediately.
type NewProcessDefinitionInput struct {
	Key         string
	Name        string
	Description string
	ObjectKey   string
	Nodes       []domain.ProcessNode
	Edges       []domain.ProcessEdge
}

// UpdateProcessDefinitionInput is the request to publish the next version.
type UpdateProcessDefinitionInput struct {
	Name        string
	Description string
	ObjectKey   string
	Nodes       []domain.ProcessNode
	Edges       []domain.ProcessEdge
}

// List returns every process definition ordered by key. Readable by any signed-in
// user; changing one needs a designer role.
func (s *ProcessDefinitions) List(
	ctx context.Context,
	principal domain.Principal,
	opts ListOptions,
) (domain.Paged[domain.ProcessDefinition], error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.Paged[domain.ProcessDefinition]{}, err
	}
	opts, err := opts.normalized()
	if err != nil {
		return domain.Paged[domain.ProcessDefinition]{}, err
	}
	return s.store.ListProcessDefinitions(ctx, opts.Query, opts.Page)
}

// Get returns one definition with its newest published version.
func (s *ProcessDefinitions) Get(ctx context.Context, key string, principal domain.Principal) (domain.ProcessDefinition, error) {
	if err := requireAuthenticated(principal); err != nil {
		return domain.ProcessDefinition{}, err
	}
	definition, err := s.store.GetProcessDefinitionByKey(ctx, key)
	if err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("look up process definition %q: %w", key, err)
	}
	return definition, nil
}

// ListVersions returns the published snapshots of one definition, newest first.
func (s *ProcessDefinitions) ListVersions(ctx context.Context, key string, principal domain.Principal) ([]domain.ProcessDefinitionVersion, error) {
	definition, err := s.Get(ctx, key, principal)
	if err != nil {
		return nil, err
	}
	return s.store.ListProcessDefinitionVersions(ctx, definition.ID)
}

// Create validates the graph and publishes version 1.
func (s *ProcessDefinitions) Create(ctx context.Context, in NewProcessDefinitionInput, principal domain.Principal) (domain.ProcessDefinition, error) {
	if err := requireDesigner(principal); err != nil {
		return domain.ProcessDefinition{}, err
	}
	problems := make([]string, 0, 4)
	if !KeyPattern.MatchString(in.Key) {
		problems = append(problems,
			fmt.Sprintf("key: must match %s (lowercase snake case, 2-64 characters)", KeyPattern))
	}
	problems = append(problems, validateDefinitionMeta(in.Name, in.Description)...)

	object, found, err := s.objects.FindBusinessObject(ctx, in.ObjectKey)
	if err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("look up business object %q: %w", in.ObjectKey, err)
	}
	if !found {
		problems = append(problems, fmt.Sprintf("object_key: business object %q does not exist", in.ObjectKey))
	} else {
		problems = append(problems, validateProcessGraph(object, in.Nodes, in.Edges)...)
	}
	if len(problems) > 0 {
		return domain.ProcessDefinition{}, &ValidationError{Problems: problems}
	}

	return s.store.CreateProcessDefinition(ctx, domain.ProcessDefinition{
		ID:          uuid.New(),
		Key:         in.Key,
		Name:        strings.TrimSpace(in.Name),
		Description: strings.TrimSpace(in.Description),
		ObjectKey:   in.ObjectKey,
		Nodes:       normalizeProcessNodes(in.Nodes),
		Edges:       in.Edges,
	}, principal.PublisherLabel())
}

// Update validates the graph and publishes the next version.
func (s *ProcessDefinitions) Update(ctx context.Context, key string, in UpdateProcessDefinitionInput, principal domain.Principal) (domain.ProcessDefinition, error) {
	if err := requireDesigner(principal); err != nil {
		return domain.ProcessDefinition{}, err
	}
	problems := validateDefinitionMeta(in.Name, in.Description)

	object, found, err := s.objects.FindBusinessObject(ctx, in.ObjectKey)
	if err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("look up business object %q: %w", in.ObjectKey, err)
	}
	if !found {
		problems = append(problems, fmt.Sprintf("object_key: business object %q does not exist", in.ObjectKey))
	} else {
		problems = append(problems, validateProcessGraph(object, in.Nodes, in.Edges)...)
	}
	if len(problems) > 0 {
		return domain.ProcessDefinition{}, &ValidationError{Problems: problems}
	}

	updated, err := s.store.UpdateProcessDefinition(
		ctx, key,
		strings.TrimSpace(in.Name),
		strings.TrimSpace(in.Description),
		in.ObjectKey,
		normalizeProcessNodes(in.Nodes),
		in.Edges,
		principal.PublisherLabel(),
	)
	if err != nil {
		return domain.ProcessDefinition{}, fmt.Errorf("update process definition %q: %w", key, err)
	}
	return updated, nil
}

func validateDefinitionMeta(name string, description string) []string {
	problems := make([]string, 0, 2)
	trimmed := strings.TrimSpace(name)
	switch {
	case trimmed == "":
		problems = append(problems, "name: must not be empty")
	case len(trimmed) > maxNameLength:
		problems = append(problems, fmt.Sprintf("name: must be at most %d characters", maxNameLength))
	}
	if len(description) > maxDescLength {
		problems = append(problems, fmt.Sprintf("description: must be at most %d characters", maxDescLength))
	}
	return problems
}

// maxWorkingHours bounds a step's deadline: a year of working time is plenty, and the
// bound keeps a mistyped number from reaching the calendar.
const maxWorkingHours = 8760

func normalizeProcessNodes(nodes []domain.ProcessNode) []domain.ProcessNode {
	normalized := make([]domain.ProcessNode, len(nodes))
	for i, node := range nodes {
		node.Key = strings.TrimSpace(node.Key)
		node.Title = strings.TrimSpace(node.Title)
		node.AssigneeRole = strings.TrimSpace(node.AssigneeRole)
		node.EscalateToRole = strings.TrimSpace(node.EscalateToRole)
		if node.DueInWorkingHours < 0 {
			node.DueInWorkingHours = 0
		}
		if node.Condition != nil {
			condition := *node.Condition
			condition.Field = strings.TrimSpace(condition.Field)
			condition.Op = strings.TrimSpace(condition.Op)
			if text, ok := condition.Value.(string); ok {
				condition.Value = strings.TrimSpace(text)
			}
			node.Condition = &condition
		}
		normalized[i] = node
	}
	return normalized
}

// validateProcessGraph enforces the MVP graph (ADR 0007 section 2) and condition
// (section 3) rules, reporting every problem at once.
func validateProcessGraph(
	object domain.BusinessObject,
	nodes []domain.ProcessNode,
	edges []domain.ProcessEdge,
) []string {
	problems := make([]string, 0, 4)

	switch {
	case len(nodes) == 0:
		return []string{"nodes: a process definition needs at least one node"}
	case len(nodes) > maxProcessNodes:
		return []string{fmt.Sprintf("nodes: must contain at most %d entries", maxProcessNodes)}
	}
	if len(edges) > maxProcessEdges {
		return []string{fmt.Sprintf("edges: must contain at most %d entries", maxProcessEdges)}
	}

	fields := make(map[string]domain.FieldDefinition, len(object.Fields))
	for _, field := range object.Fields {
		fields[field.Key] = field
	}

	byKey := make(map[string]domain.ProcessNode, len(nodes))
	for i, node := range nodes {
		where := fmt.Sprintf("nodes[%d]", i)
		if !KeyPattern.MatchString(node.Key) {
			problems = append(problems, fmt.Sprintf("%s.key: must match %s", where, KeyPattern))
		} else if _, exists := byKey[node.Key]; exists {
			problems = append(problems, fmt.Sprintf("%s.key: duplicate node key %q", where, node.Key))
		} else {
			byKey[node.Key] = node
		}

		if strings.TrimSpace(node.Title) == "" {
			problems = append(problems, fmt.Sprintf("%s.title: must not be empty", where))
		} else if len(node.Title) > maxFieldLabelLen {
			problems = append(problems, fmt.Sprintf("%s.title: must be at most %d characters", where, maxFieldLabelLen))
		}

		if !node.Type.Valid() {
			problems = append(problems, fmt.Sprintf("%s.type: %q is not a supported node type", where, node.Type))
			continue
		}

		switch node.Type {
		case domain.ProcessNodeHumanTask:
			if !KeyPattern.MatchString(node.AssigneeRole) {
				problems = append(problems,
					fmt.Sprintf("%s.assigneeRole: must match %s (the role resolver needs a role)", where, KeyPattern))
			}
			if node.Condition != nil {
				problems = append(problems, fmt.Sprintf("%s.condition: only condition nodes carry a condition", where))
			}
			// A deadline and a role to take over belong to a step a person works on
			// (ADR 0031).
			if node.DueInWorkingHours < 0 || node.DueInWorkingHours > maxWorkingHours {
				problems = append(problems,
					fmt.Sprintf("%s.dueInWorkingHours: must be between 0 and %d", where, maxWorkingHours))
			}
			if node.EscalateToRole != "" && !KeyPattern.MatchString(node.EscalateToRole) {
				problems = append(problems,
					fmt.Sprintf("%s.escalateToRole: must match %s", where, KeyPattern))
			}
			if node.EscalateToRole == node.AssigneeRole {
				problems = append(problems,
					fmt.Sprintf("%s.escalateToRole: must be another role than the one that has the step", where))
			}
		case domain.ProcessNodeCondition:
			if node.AssigneeRole != "" {
				problems = append(problems, fmt.Sprintf("%s.assigneeRole: only human_task nodes carry a role", where))
			}
			if node.DueInWorkingHours != 0 || node.EscalateToRole != "" {
				problems = append(problems,
					fmt.Sprintf("%s: only human_task nodes carry a deadline", where))
			}
			if node.Condition == nil {
				problems = append(problems, fmt.Sprintf("%s.condition: condition nodes must declare one", where))
			} else {
				problems = append(problems, validateProcessCondition(node.Condition, fields, where+".condition")...)
			}
		case domain.ProcessNodeStart, domain.ProcessNodeEnd:
			if node.AssigneeRole != "" {
				problems = append(problems, fmt.Sprintf("%s.assigneeRole: only human_task nodes carry a role", where))
			}
			if node.DueInWorkingHours != 0 || node.EscalateToRole != "" {
				problems = append(problems,
					fmt.Sprintf("%s: only human_task nodes carry a deadline", where))
			}
			if node.Condition != nil {
				problems = append(problems, fmt.Sprintf("%s.condition: only condition nodes carry a condition", where))
			}
		}
	}

	// Counts and reachability only make sense once the node keys are trustworthy.
	starts, ends, humanTasks := 0, 0, 0
	for _, node := range nodes {
		switch node.Type {
		case domain.ProcessNodeStart:
			starts++
		case domain.ProcessNodeEnd:
			ends++
		case domain.ProcessNodeHumanTask:
			humanTasks++
		}
	}
	switch {
	case starts != 1:
		problems = append(problems, fmt.Sprintf("nodes: exactly one start node is required, found %d", starts))
	case ends == 0:
		problems = append(problems, "nodes: at least one end node is required")
	case humanTasks == 0:
		problems = append(problems, "nodes: at least one human_task node is required")
	}

	outgoing := make(map[string][]domain.ProcessEdge, len(nodes))
	incoming := make(map[string]int, len(nodes))
	seenArrows := make(map[string]struct{}, len(edges))
	for i, edge := range edges {
		where := fmt.Sprintf("edges[%d]", i)
		if _, exists := byKey[edge.From]; !exists {
			problems = append(problems, fmt.Sprintf("%s.from: node %q does not exist", where, edge.From))
		}
		if _, exists := byKey[edge.To]; !exists {
			problems = append(problems, fmt.Sprintf("%s.to: node %q does not exist", where, edge.To))
		}
		if edge.When != "" && edge.When != "true" && edge.When != "false" {
			problems = append(problems, fmt.Sprintf("%s.when: must be \"true\" or \"false\"", where))
		}
		arrow := edge.From + "|" + edge.When
		if _, exists := seenArrows[arrow]; exists {
			problems = append(problems,
				fmt.Sprintf("%s: node %q already has an outgoing edge with when=%q", where, edge.From, edge.When))
		}
		seenArrows[arrow] = struct{}{}
		outgoing[edge.From] = append(outgoing[edge.From], edge)
		incoming[edge.To]++
	}

	for i, node := range nodes {
		where := fmt.Sprintf("nodes[%d]", i)
		out := outgoing[node.Key]
		switch node.Type {
		case domain.ProcessNodeEnd:
			if len(out) > 0 {
				problems = append(problems, fmt.Sprintf("%s: end nodes cannot have outgoing edges", where))
			}
		case domain.ProcessNodeCondition:
			if len(out) != 2 || !hasBranch(out, "true") || !hasBranch(out, "false") {
				problems = append(problems,
					fmt.Sprintf("%s: condition nodes need exactly one when=true and one when=false edge", where))
			}
		case domain.ProcessNodeStart, domain.ProcessNodeHumanTask:
			if len(out) != 1 || out[0].When != "" {
				problems = append(problems, fmt.Sprintf("%s: needs exactly one unconditional outgoing edge", where))
			}
		}
		if node.Type == domain.ProcessNodeStart && incoming[node.Key] > 0 {
			problems = append(problems, fmt.Sprintf("%s: start node cannot have incoming edges", where))
		}
	}

	if cycle := findCycle(nodes, outgoing); len(cycle) > 0 {
		problems = append(problems,
			fmt.Sprintf("edges: cycles are not allowed in MVP (%s); use return/reset instead", strings.Join(cycle, " → ")))
	} else if starts == 1 {
		if unreachable := unreachableNodes(nodes, outgoing); len(unreachable) > 0 {
			problems = append(problems,
				fmt.Sprintf("nodes: unreachable from start: %s", strings.Join(unreachable, ", ")))
		}
	}

	return problems
}

func hasBranch(edges []domain.ProcessEdge, when string) bool {
	for _, edge := range edges {
		if edge.When == when {
			return true
		}
	}
	return false
}

// findCycle returns a cycle as a node-key path (for the error message) or nil.
func findCycle(nodes []domain.ProcessNode, outgoing map[string][]domain.ProcessEdge) []string {
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := make(map[string]int, len(nodes))
	var stack []string

	var visit func(key string) []string
	visit = func(key string) []string {
		color[key] = gray
		stack = append(stack, key)
		for _, edge := range outgoing[key] {
			switch color[edge.To] {
			case gray:
				return append([]string{}, stack...)
			case white:
				if cycle := visit(edge.To); cycle != nil {
					return cycle
				}
			}
		}
		stack = stack[:len(stack)-1]
		color[key] = black
		return nil
	}

	for _, node := range nodes {
		if color[node.Key] == white {
			if cycle := visit(node.Key); cycle != nil {
				return cycle
			}
		}
	}
	return nil
}

func unreachableNodes(nodes []domain.ProcessNode, outgoing map[string][]domain.ProcessEdge) []string {
	start := ""
	for _, node := range nodes {
		if node.Type == domain.ProcessNodeStart {
			start = node.Key
			break
		}
	}
	if start == "" {
		return nil
	}

	seen := map[string]bool{start: true}
	queue := []string{start}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, edge := range outgoing[current] {
			if !seen[edge.To] {
				seen[edge.To] = true
				queue = append(queue, edge.To)
			}
		}
	}

	unreachable := make([]string, 0)
	for _, node := range nodes {
		if !seen[node.Key] {
			unreachable = append(unreachable, node.Key)
		}
	}
	return unreachable
}

// validateProcessCondition checks the JSON condition (D04) against the field it
// references: the field must exist on the bound business object, the operator
// must suit its type, and the literal must have the declared shape. A select
// condition must name one of the declared options.
func validateProcessCondition(
	condition *domain.ProcessCondition,
	fields map[string]domain.FieldDefinition,
	where string,
) []string {
	problems := make([]string, 0, 3)

	field, found := fields[condition.Field]
	if condition.Field == "" {
		problems = append(problems, fmt.Sprintf("%s.field: must not be empty", where))
		return problems
	}
	if !found {
		problems = append(problems,
			fmt.Sprintf("%s.field: %q is not a field of the bound business object", where, condition.Field))
		return problems
	}

	opAllowed := false
	for _, op := range domain.ConditionOps {
		if condition.Op == op {
			opAllowed = true
			break
		}
	}
	if !opAllowed {
		problems = append(problems,
			fmt.Sprintf("%s.op: %q is not supported (allowed: %s)", where, condition.Op, strings.Join(domain.ConditionOps, ", ")))
		return problems
	}

	if field.Type == domain.FieldTypeRows {
		problems = append(problems,
			fmt.Sprintf("%s.field: rows fields cannot be used in a condition", where))
		return problems
	}

	ordered := condition.Op == "gt" || condition.Op == "gte" || condition.Op == "lt" || condition.Op == "lte"
	switch field.Type {
	case domain.FieldTypeNumber:
		value, ok := numberLiteral(condition.Value)
		if !ok {
			problems = append(problems, fmt.Sprintf("%s.value: must be a number for field %q", where, field.Key))
			break
		}
		_ = value
	case domain.FieldTypeDate:
		text, ok := condition.Value.(string)
		if !ok {
			problems = append(problems, fmt.Sprintf("%s.value: must be a date string (YYYY-MM-DD)", where))
			break
		}
		if _, err := time.Parse(time.DateOnly, text); err != nil {
			problems = append(problems, fmt.Sprintf("%s.value: must be a valid date in YYYY-MM-DD format", where))
		}
	case domain.FieldTypeText, domain.FieldTypeFile:
		if ordered {
			problems = append(problems,
				fmt.Sprintf("%s.op: %q needs an ordered field (number or date); %s is text", where, condition.Op, field.Key))
		}
		if _, ok := condition.Value.(string); !ok {
			problems = append(problems, fmt.Sprintf("%s.value: must be a string for field %q", where, field.Key))
		}
	case domain.FieldTypeSelect:
		if ordered {
			problems = append(problems,
				fmt.Sprintf("%s.op: %q needs an ordered field (number or date); %s is a select", where, condition.Op, field.Key))
		}
		text, ok := condition.Value.(string)
		if !ok {
			problems = append(problems, fmt.Sprintf("%s.value: must be one of the declared options", where))
			break
		}
		if len(text) > maxConditionText {
			problems = append(problems, fmt.Sprintf("%s.value: must be at most %d characters", where, maxConditionText))
			break
		}
		declared := false
		for _, option := range field.Options {
			if option.Value == text {
				declared = true
				break
			}
		}
		if !declared {
			problems = append(problems,
				fmt.Sprintf("%s.value: %q is not one of the declared options of %s", where, text, field.Key))
		}
	}

	return problems
}

func numberLiteral(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

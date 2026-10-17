package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// ------------------------------------------------------------- definitions ----

func handleListProcessDefinitions(definitions *service.ProcessDefinitions, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		opts, err := listQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}
		list, err := definitions.List(r.Context(), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "list process definitions")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.ProcessDefinitionList{
			Data:  toAPIProcessDefinitions(list.Items),
			Total: list.Total,
		})
	}
}

func handleCreateProcessDefinition(definitions *service.ProcessDefinitions, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.CreateProcessDefinitionJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateProcessDefinitionRequest schema")
			return
		}

		created, err := definitions.Create(r.Context(), service.NewProcessDefinitionInput{
			Key:         body.Key,
			Name:        body.Name,
			Description: stringValue(body.Description),
			ObjectKey:   body.ObjectKey,
			Nodes:       toDomainProcessNodes(body.Nodes),
			Edges:       toDomainProcessEdges(body.Edges),
		}, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "create process definition")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIProcessDefinition(created))
	}
}

func handleGetProcessDefinition(definitions *service.ProcessDefinitions, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		definition, err := definitions.Get(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "get process definition")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIProcessDefinition(definition))
	}
}

func handleUpdateProcessDefinition(definitions *service.ProcessDefinitions, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.UpdateProcessDefinitionJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the UpdateProcessDefinitionRequest schema")
			return
		}

		updated, err := definitions.Update(r.Context(), chi.URLParam(r, "key"), service.UpdateProcessDefinitionInput{
			Name:        body.Name,
			Description: stringValue(body.Description),
			ObjectKey:   body.ObjectKey,
			Nodes:       toDomainProcessNodes(body.Nodes),
			Edges:       toDomainProcessEdges(body.Edges),
		}, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "update process definition")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIProcessDefinition(updated))
	}
}

func handleListProcessDefinitionVersions(definitions *service.ProcessDefinitions, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		versions, err := definitions.ListVersions(r.Context(), chi.URLParam(r, "key"), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "list process definition versions")
			return
		}
		result := make([]apiv1.ProcessDefinitionVersion, len(versions))
		for i, version := range versions {
			result[i] = toAPIProcessDefinitionVersion(version)
		}
		writeJSON(w, log, http.StatusOK, apiv1.ProcessDefinitionVersionList{Data: result})
	}
}

// ----------------------------------------------------------------- runtime ----

func handleListProcessInstances(runtime *service.ProcessRuntime, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		opts, err := listQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}
		summaries, err := runtime.List(r.Context(), service.ListInput{
			ObjectKey:     r.URL.Query().Get("objectKey"),
			DefinitionKey: r.URL.Query().Get("definitionKey"),
			RecordID:      r.URL.Query().Get("recordId"),
			Principal:     domain.NewPrincipal(user),
			Page:          opts.Page,
		})
		if err != nil {
			writeStoreError(w, log, err, "list process instances")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.ProcessInstanceList{
			Data:  toAPIInstanceSummaries(summaries.Items),
			Total: summaries.Total,
		})
	}
}

func handleStartProcessInstance(runtime *service.ProcessRuntime, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.StartProcessInstanceJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the StartProcessInstanceRequest schema")
			return
		}

		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		view, err := runtime.Start(r.Context(), service.StartInput{
			DefinitionKey: body.DefinitionKey,
			RecordID:      body.RecordId,
			Principal:     domain.NewPrincipal(user),
		})
		if err != nil {
			writeStoreError(w, log, err, "start process instance")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIInstanceView(view))
	}
}

func handleGetProcessInstance(runtime *service.ProcessRuntime, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		instanceID, ok := parseUUIDParam(w, log, r, "instanceId", "process instance id")
		if !ok {
			return
		}
		view, err := runtime.Get(r.Context(), instanceID, domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "get process instance")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIInstanceView(view))
	}
}

func handleDecideProcessTask(runtime *service.ProcessRuntime, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.DecideProcessTaskJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the DecideProcessTaskRequest schema")
			return
		}

		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		instanceID, ok := parseUUIDParam(w, log, r, "instanceId", "process instance id")
		if !ok {
			return
		}
		taskID, ok := parseUUIDParam(w, log, r, "taskId", "task id")
		if !ok {
			return
		}

		view, err := runtime.Decide(r.Context(), service.DecideInput{
			InstanceID: instanceID,
			TaskID:     taskID,
			Decision:   service.Decision(body.Decision),
			Reason:     stringValue(body.Reason),
			Principal:  domain.NewPrincipal(user),
		})
		if err != nil {
			writeStoreError(w, log, err, "decide process task")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIInstanceView(view))
	}
}

func handleInbox(runtime *service.ProcessRuntime, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		opts, err := listQuery(r)
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest, err.Error())
			return
		}
		items, err := runtime.Inbox(r.Context(), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "read inbox")
			return
		}
		writeJSON(w, log, http.StatusOK, apiv1.InboxList{
			Data:  toAPIInboxItems(items.Items),
			Total: items.Total,
		})
	}
}

// ----------------------------------------------------------------- mapping ----

func toAPIProcessDefinitions(definitions []domain.ProcessDefinition) []apiv1.ProcessDefinition {
	result := make([]apiv1.ProcessDefinition, len(definitions))
	for i, definition := range definitions {
		result[i] = toAPIProcessDefinition(definition)
	}
	return result
}

func toAPIProcessDefinition(definition domain.ProcessDefinition) apiv1.ProcessDefinition {
	return apiv1.ProcessDefinition{
		Id:          definition.ID,
		Key:         definition.Key,
		Name:        definition.Name,
		Description: pointerOrNil(definition.Description),
		ObjectKey:   definition.ObjectKey,
		Version:     definition.Version,
		Nodes:       toAPIProcessNodes(definition.Nodes),
		Edges:       toAPIProcessEdges(definition.Edges),
		CreatedAt:   definition.CreatedAt,
		UpdatedAt:   definition.UpdatedAt,
	}
}

func toAPIProcessDefinitionVersion(version domain.ProcessDefinitionVersion) apiv1.ProcessDefinitionVersion {
	return apiv1.ProcessDefinitionVersion{
		Id:          version.ID,
		Version:     version.Version,
		Name:        version.Name,
		Description: pointerOrNil(version.Description),
		ObjectKey:   version.ObjectKey,
		Nodes:       toAPIProcessNodes(version.Nodes),
		Edges:       toAPIProcessEdges(version.Edges),
		PublishedAt: version.PublishedAt,
		PublishedBy: version.PublishedBy,
	}
}

func toAPIProcessNodes(nodes []domain.ProcessNode) []apiv1.ProcessNode {
	result := make([]apiv1.ProcessNode, len(nodes))
	for i, node := range nodes {
		converted := apiv1.ProcessNode{
			Key:   node.Key,
			Type:  apiv1.ProcessNodeType(node.Type),
			Title: node.Title,
		}
		if node.AssigneeRole != "" {
			role := node.AssigneeRole
			converted.AssigneeRole = &role
		}
		if node.Condition != nil {
			converted.Condition = &apiv1.ProcessCondition{
				Field: node.Condition.Field,
				Op:    apiv1.ProcessConditionOp(node.Condition.Op),
				Value: node.Condition.Value,
			}
		}
		result[i] = converted
	}
	return result
}

func toAPIProcessEdges(edges []domain.ProcessEdge) []apiv1.ProcessEdge {
	result := make([]apiv1.ProcessEdge, len(edges))
	for i, edge := range edges {
		converted := apiv1.ProcessEdge{From: edge.From, To: edge.To}
		if edge.When != "" {
			when := apiv1.ProcessEdgeWhen(edge.When)
			converted.When = &when
		}
		result[i] = converted
	}
	return result
}

func toDomainProcessNodes(nodes []apiv1.ProcessNode) []domain.ProcessNode {
	result := make([]domain.ProcessNode, len(nodes))
	for i, node := range nodes {
		converted := domain.ProcessNode{
			Key:          node.Key,
			Type:         domain.ProcessNodeType(node.Type),
			Title:        node.Title,
			AssigneeRole: stringValue(node.AssigneeRole),
		}
		if node.Condition != nil {
			converted.Condition = &domain.ProcessCondition{
				Field: node.Condition.Field,
				Op:    string(node.Condition.Op),
				Value: node.Condition.Value,
			}
		}
		result[i] = converted
	}
	return result
}

func toDomainProcessEdges(edges []apiv1.ProcessEdge) []domain.ProcessEdge {
	result := make([]domain.ProcessEdge, len(edges))
	for i, edge := range edges {
		converted := domain.ProcessEdge{From: edge.From, To: edge.To}
		if edge.When != nil {
			converted.When = string(*edge.When)
		}
		result[i] = converted
	}
	return result
}

func toAPIInboxItems(items []domain.InboxItem) []apiv1.InboxItem {
	result := make([]apiv1.InboxItem, len(items))
	for i, item := range items {
		result[i] = apiv1.InboxItem{
			Task:     toAPIInstanceView(service.InstanceView{Tasks: []domain.ProcessTask{item.Task}}).Tasks[0],
			Instance: toAPIInstanceView(service.InstanceView{Instance: item.Instance}).Instance,
		}
	}
	return result
}

func toAPIInstanceSummaries(summaries []domain.ProcessInstanceSummary) []apiv1.ProcessInstanceSummary {
	result := make([]apiv1.ProcessInstanceSummary, len(summaries))
	for i, summary := range summaries {
		result[i] = apiv1.ProcessInstanceSummary{
			Instance:  toAPIInstanceView(service.InstanceView{Instance: summary.Instance}).Instance,
			OpenTasks: toAPIInstanceView(service.InstanceView{Tasks: summary.OpenTasks}).Tasks,
		}
	}
	return result
}

func toAPIInstanceView(view service.InstanceView) apiv1.ProcessInstanceView {
	tasks := make([]apiv1.ProcessTask, len(view.Tasks))
	for i, task := range view.Tasks {
		converted := apiv1.ProcessTask{
			Id:           task.ID,
			NodeKey:      task.NodeKey,
			Title:        task.Title,
			AssigneeRole: task.AssigneeRole,
			Attempt:      task.Attempt,
			Status:       apiv1.ProcessTaskStatus(task.Status),
			Reason:       pointerOrNil(task.Reason),
			DecidedBy:    pointerOrNil(task.DecidedBy),
			CreatedAt:    task.CreatedAt,
			DecidedAt:    task.DecidedAt,
		}
		tasks[i] = converted
	}

	events := make([]apiv1.ProcessEvent, len(view.Events))
	for i, event := range view.Events {
		converted := apiv1.ProcessEvent{
			Id:        event.ID,
			Type:      string(event.Type),
			Actor:     event.Actor,
			Payload:   event.Payload,
			CreatedAt: event.CreatedAt,
		}
		if event.NodeKey != "" {
			nodeKey := event.NodeKey
			converted.NodeKey = &nodeKey
		}
		events[i] = converted
	}

	instance := view.Instance
	return apiv1.ProcessInstanceView{
		Instance: apiv1.ProcessInstance{
			Id:                instance.ID,
			DefinitionKey:     instance.DefinitionKey,
			DefinitionVersion: instance.DefinitionVersion,
			ObjectKey:         instance.ObjectKey,
			RecordId:          instance.RecordID,
			State:             apiv1.ProcessInstanceState(instance.State),
			CurrentNode:       instance.CurrentNode,
			Attempt:           instance.Attempt,
			StartedAt:         instance.StartedAt,
			FinishedAt:        instance.FinishedAt,
			UpdatedAt:         instance.UpdatedAt,
		},
		Tasks:  tasks,
		Events: events,
	}
}

package httpapi

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// ---------------------------------------------------------------- users ----

func handleListAdminUsers(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
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

		principal := domain.NewPrincipal(user)
		page, err := admin.ListUsers(r.Context(), principal, opts)
		if err != nil {
			writeStoreError(w, log, err, "list users")
			return
		}
		labels := adminRoleLabels(r.Context(), admin, principal, log)

		data := make([]apiv1.AdminUser, len(page.Items))
		for i, item := range page.Items {
			data[i] = toAPIAdminUser(item, labels)
		}
		writeJSON(w, log, http.StatusOK, apiv1.AdminUserList{Data: data, Total: page.Total})
	}
}

func handleGetAdminUser(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}

		principal := domain.NewPrincipal(user)
		found, err := admin.GetUser(r.Context(), principal, id)
		if err != nil {
			writeStoreError(w, log, err, "get user")
			return
		}
		labels := adminRoleLabels(r.Context(), admin, principal, log)
		writeJSON(w, log, http.StatusOK, toAPIAdminUser(found, labels))
	}
}

func handleCreateAdminUser(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.CreateAdminUserJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateAdminUserRequest schema")
			return
		}

		principal := domain.NewPrincipal(user)
		created, err := admin.CreateUser(r.Context(), principal, service.NewUserInput{
			Email:         body.Email,
			Name:          body.Name,
			Password:      body.Password,
			DepartmentKey: body.Department,
			Roles:         body.Roles,
		})
		if err != nil {
			writeStoreError(w, log, err, "create user")
			return
		}
		labels := adminRoleLabels(r.Context(), admin, principal, log)
		writeJSON(w, log, http.StatusCreated, toAPIAdminUser(domain.AdminUser{User: created}, labels))
	}
}

func handleUpdateAdminUser(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}
		var body apiv1.UpdateAdminUserJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the UpdateAdminUserRequest schema")
			return
		}

		principal := domain.NewPrincipal(user)
		updated, err := admin.UpdateUser(r.Context(), principal, id, service.UpdateUserInput{
			Email:         body.Email,
			Name:          body.Name,
			DepartmentKey: body.Department,
			Roles:         body.Roles,
			Status:        string(body.Status),
		})
		if err != nil {
			writeStoreError(w, log, err, "update user")
			return
		}
		labels := adminRoleLabels(r.Context(), admin, principal, log)
		writeJSON(w, log, http.StatusOK, toAPIAdminUser(domain.AdminUser{User: updated}, labels))
	}
}

func handleSetAdminUserPassword(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}
		var body apiv1.SetAdminUserPasswordJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the SetAdminUserPasswordRequest schema")
			return
		}

		if err := admin.SetPassword(r.Context(), domain.NewPrincipal(user), id, body.Password); err != nil {
			writeStoreError(w, log, err, "set user password")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleRevokeAdminUserSessions(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}
		if err := admin.RevokeSessions(r.Context(), domain.NewPrincipal(user), id); err != nil {
			writeStoreError(w, log, err, "revoke user sessions")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleUnlockAdminUser(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "userId", "userId")
		if !ok {
			return
		}
		if err := admin.UnlockUser(r.Context(), domain.NewPrincipal(user), id); err != nil {
			writeStoreError(w, log, err, "unlock user")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------- departments ----

func handleListAdminDepartments(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
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
		page, err := admin.ListDepartments(r.Context(), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "list departments")
			return
		}
		data := make([]apiv1.AdminDepartment, len(page.Items))
		for i, item := range page.Items {
			data[i] = toAPIAdminDepartment(item)
		}
		writeJSON(w, log, http.StatusOK,
			apiv1.AdminDepartmentList{Data: data, Total: page.Total})
	}
}

func handleCreateAdminDepartment(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.CreateAdminDepartmentJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateAdminDepartmentRequest schema")
			return
		}
		created, err := admin.CreateDepartment(r.Context(), domain.NewPrincipal(user), body.Key, body.Name)
		if err != nil {
			writeStoreError(w, log, err, "create department")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIAdminDepartment(domain.DepartmentSummary{
			Department: created,
		}))
	}
}

func handleUpdateAdminDepartment(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.UpdateAdminDepartmentJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the UpdateAdminDepartmentRequest schema")
			return
		}
		updated, err := admin.UpdateDepartment(r.Context(), domain.NewPrincipal(user),
			chi.URLParam(r, "key"), body.Name)
		if err != nil {
			writeStoreError(w, log, err, "update department")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIAdminDepartment(domain.DepartmentSummary{
			Department: updated,
		}))
	}
}

func handleDeleteAdminDepartment(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		if err := admin.DeleteDepartment(r.Context(), domain.NewPrincipal(user),
			chi.URLParam(r, "key")); err != nil {
			writeStoreError(w, log, err, "delete department")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------- roles ----

func handleListAdminRoles(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
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
		page, err := admin.ListRoles(r.Context(), domain.NewPrincipal(user), opts)
		if err != nil {
			writeStoreError(w, log, err, "list roles")
			return
		}
		data := make([]apiv1.AdminRole, len(page.Items))
		for i, item := range page.Items {
			data[i] = toAPIAdminRole(item)
		}
		writeJSON(w, log, http.StatusOK, apiv1.AdminRoleList{Data: data, Total: page.Total})
	}
}

func handleCreateAdminRole(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.CreateAdminRoleJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the CreateAdminRoleRequest schema")
			return
		}
		created, err := admin.CreateRole(r.Context(), domain.NewPrincipal(user), body.Key, body.Label)
		if err != nil {
			writeStoreError(w, log, err, "create role")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIAdminRole(created))
	}
}

func handleUpdateAdminRole(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		var body apiv1.UpdateAdminRoleJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the UpdateAdminRoleRequest schema")
			return
		}
		updated, err := admin.UpdateRole(r.Context(), domain.NewPrincipal(user),
			chi.URLParam(r, "key"), body.Label)
		if err != nil {
			writeStoreError(w, log, err, "update role")
			return
		}
		writeJSON(w, log, http.StatusOK, toAPIAdminRole(updated))
	}
}

func handleDeleteAdminRole(admin *service.Admin, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		if err := admin.DeleteRole(r.Context(), domain.NewPrincipal(user),
			chi.URLParam(r, "key")); err != nil {
			writeStoreError(w, log, err, "delete role")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// --------------------------------------------------------------- mapping ----

// adminRoleLabels reads the display names once per response; a label read failing must not
// take the administration screen down, so callers fall back to role keys (ADR 0016).
func adminRoleLabels(
	ctx context.Context,
	admin *service.Admin,
	principal domain.Principal,
	log *slog.Logger,
) map[string]string {
	labels, err := admin.RoleLabels(ctx, principal)
	if err != nil {
		log.Warn("read role labels failed", "error", err)
		return map[string]string{}
	}
	return labels
}

func toAPIAdminUser(user domain.AdminUser, labels map[string]string) apiv1.AdminUser {
	roles := user.Roles
	if roles == nil {
		roles = []string{}
	}
	held := make(map[string]string, len(roles))
	for _, role := range roles {
		if label, ok := labels[role]; ok && label != "" {
			held[role] = label
		}
	}
	return apiv1.AdminUser{
		Id:             user.ID,
		Email:          user.Email,
		Name:           user.Name,
		Department:     user.DepartmentKey,
		DepartmentName: user.DepartmentName,
		Roles:          roles,
		RoleLabels:     held,
		Status:         apiv1.AdminUserStatus(user.Status),
		LockedUntil:    user.LockedUntil,
		CreatedAt:      user.CreatedAt,
		UpdatedAt:      user.UpdatedAt,
	}
}

func toAPIAdminDepartment(department domain.DepartmentSummary) apiv1.AdminDepartment {
	return apiv1.AdminDepartment{
		Key:       department.Key,
		Name:      department.Name,
		UserCount: department.UserCount,
		CreatedAt: department.CreatedAt,
	}
}

func toAPIAdminRole(role domain.Role) apiv1.AdminRole {
	return apiv1.AdminRole{
		Key:       role.Key,
		Label:     role.Label,
		IsSystem:  role.IsSystem,
		UserCount: role.UserCount,
		CreatedAt: role.CreatedAt,
	}
}

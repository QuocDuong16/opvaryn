package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// ---------------------------------------------------------------- users ----

// adminUserSearch matches the address or the name of a person; an empty term is "no
// filter". The same fragment is used by the count and the page so they cannot disagree.
const adminUserSearch = `
	 WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' ESCAPE '\'
		    OR u.name ILIKE '%' || $1 || '%' ESCAPE '\')`

// ListUsersPage returns one page of users for the administration screen, ordered by email
// so pagination is stable. Password hashes are part of domain.User and are stripped by the
// service; nothing below ever logs them.
func (s *Store) ListUsersPage(
	ctx context.Context,
	query string,
	page domain.Page,
) (domain.Paged[domain.User], error) {
	term := likeTerm(query)
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM users u`+adminUserSearch, term).Scan(&total); err != nil {
		return domain.Paged[domain.User]{}, classify(fmt.Errorf("count users: %w", err))
	}

	rows, err := s.pool.Query(ctx, userSelect+adminUserSearch+`
		 ORDER BY u.email
		 LIMIT $2 OFFSET $3`, term, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.User]{}, classify(fmt.Errorf("query users: %w", err))
	}
	defer rows.Close()

	users := make([]domain.User, 0, page.Limit)
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return domain.Paged[domain.User]{}, classify(err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.User]{}, classify(fmt.Errorf("iterate users: %w", err))
	}
	return domain.Paged[domain.User]{Items: users, Total: total}, nil
}

// UpdateUser replaces the editable profile of one user and its complete role set in one
// transaction. Disabling a person ends their sessions immediately. The transaction also
// holds an advisory lock while it checks that an active administrator remains, so two
// concurrent demotions cannot both observe the other one still holding the role.
func (s *Store) UpdateUser(ctx context.Context, user domain.User) (domain.User, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`SELECT pg_advisory_xact_lock(hashtext('opvaryn_admin_guard'))`); err != nil {
			return fmt.Errorf("lock administrator guard: %w", err)
		}

		tag, err := tx.Exec(ctx, `
			UPDATE users
			   SET email = $2, name = $3, department_key = $4, status = $5, updated_at = now()
			 WHERE id = $1`,
			user.ID, user.Email, user.Name, user.DepartmentKey, user.Status)
		if err != nil {
			return mapUniqueViolation(err, fmt.Sprintf("user %q already exists", user.Email))
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: user %s", ErrNotFound, user.ID)
		}

		if _, err := tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1`, user.ID); err != nil {
			return fmt.Errorf("replace user roles: %w", err)
		}
		for _, role := range user.Roles {
			if _, err := tx.Exec(ctx,
				`INSERT INTO roles (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, role); err != nil {
				return fmt.Errorf("register role: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, user.ID, role); err != nil {
				return fmt.Errorf("insert user role: %w", err)
			}
		}

		if user.Status == domain.UserDisabled {
			if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, user.ID); err != nil {
				return fmt.Errorf("revoke sessions: %w", err)
			}
		}

		var activeAdmins int
		if err := tx.QueryRow(ctx, `
			SELECT count(*)
			  FROM users u
			  JOIN user_roles r ON r.user_id = u.id
			 WHERE r.role = $1 AND u.status = $2`, domain.RoleAdmin, domain.UserActive,
		).Scan(&activeAdmins); err != nil {
			return fmt.Errorf("count administrators: %w", err)
		}
		if activeAdmins == 0 {
			return fmt.Errorf("%w: at least one active administrator must remain", ErrInUse)
		}
		return nil
	})
	if err != nil {
		return domain.User{}, classify(err)
	}

	updated, found, err := s.FindUserByID(ctx, user.ID)
	if err != nil {
		return domain.User{}, err
	}
	if !found {
		return domain.User{}, fmt.Errorf("%w: user %s", ErrNotFound, user.ID)
	}
	return updated, nil
}

// ---------------------------------------------------------- departments ----

const departmentSearch = `
	 WHERE ($1 = '' OR d.name ILIKE '%' || $1 || '%' ESCAPE '\'
		    OR d.key ILIKE '%' || $1 || '%' ESCAPE '\')`

// ListDepartmentsPage returns one page of the closed department catalogue with the number
// of people in each department.
func (s *Store) ListDepartmentsPage(
	ctx context.Context,
	query string,
	page domain.Page,
) (domain.Paged[domain.DepartmentSummary], error) {
	term := likeTerm(query)
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM departments d`+departmentSearch, term).Scan(&total); err != nil {
		return domain.Paged[domain.DepartmentSummary]{}, classify(fmt.Errorf("count departments: %w", err))
	}

	rows, err := s.pool.Query(ctx, `
		SELECT d.key, d.name, d.created_at, count(u.id)
		  FROM departments d
		  LEFT JOIN users u ON u.department_key = d.key`+departmentSearch+`
		 GROUP BY d.key, d.name, d.created_at
		 ORDER BY d.name, d.key
		 LIMIT $2 OFFSET $3`, term, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.DepartmentSummary]{}, classify(fmt.Errorf("query departments: %w", err))
	}
	defer rows.Close()

	departments := make([]domain.DepartmentSummary, 0, page.Limit)
	for rows.Next() {
		var summary domain.DepartmentSummary
		if err := rows.Scan(&summary.Key, &summary.Name, &summary.CreatedAt, &summary.UserCount); err != nil {
			return domain.Paged[domain.DepartmentSummary]{}, classify(fmt.Errorf("scan department: %w", err))
		}
		departments = append(departments, summary)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.DepartmentSummary]{}, classify(fmt.Errorf("iterate departments: %w", err))
	}
	return domain.Paged[domain.DepartmentSummary]{Items: departments, Total: total}, nil
}

// CreateDepartment adds one department to the closed catalogue.
func (s *Store) CreateDepartment(ctx context.Context, key string, name string) (domain.Department, error) {
	var department domain.Department
	err := s.pool.QueryRow(ctx, `
		INSERT INTO departments (key, name) VALUES ($1, $2)
		RETURNING key, name, created_at`, key, name,
	).Scan(&department.Key, &department.Name, &department.CreatedAt)
	if err != nil {
		return domain.Department{}, classify(mapUniqueViolation(err,
			fmt.Sprintf("department %q already exists", key)))
	}
	return department, nil
}

// UpdateDepartmentName renames a department. The key is the scope value stored on records,
// so it stays fixed.
func (s *Store) UpdateDepartmentName(ctx context.Context, key string, name string) (domain.Department, error) {
	var department domain.Department
	err := s.pool.QueryRow(ctx, `
		UPDATE departments SET name = $2 WHERE key = $1
		RETURNING key, name, created_at`, key, name,
	).Scan(&department.Key, &department.Name, &department.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Department{}, fmt.Errorf("%w: department %q", ErrNotFound, key)
		}
		return domain.Department{}, classify(fmt.Errorf("update department: %w", err))
	}
	return department, nil
}

// DeleteDepartment removes an empty department. A department with people cannot go (the
// users foreign key forbids it), and one that names stored records is refused too: deleting
// it would silently change who can read those records (ADR 0008).
func (s *Store) DeleteDepartment(ctx context.Context, key string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var people int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM users WHERE department_key = $1`, key).Scan(&people); err != nil {
			return fmt.Errorf("count department users: %w", err)
		}
		if people > 0 {
			return fmt.Errorf("%w: department %q still has %d user(s)", ErrInUse, key, people)
		}

		var records int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM business_object_records WHERE department_key = $1`, key,
		).Scan(&records); err != nil {
			return fmt.Errorf("count department records: %w", err)
		}
		if records > 0 {
			return fmt.Errorf("%w: department %q is named by %d record(s)", ErrInUse, key, records)
		}

		tag, err := tx.Exec(ctx, `DELETE FROM departments WHERE key = $1`, key)
		if err != nil {
			return fmt.Errorf("delete department: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: department %q", ErrNotFound, key)
		}
		return nil
	})
	if err != nil {
		return classify(err)
	}
	return nil
}

// ---------------------------------------------------------------- roles ----

const roleSearch = `
	 WHERE ($1 = '' OR r.key ILIKE '%' || $1 || '%' ESCAPE '\'
		    OR r.label ILIKE '%' || $1 || '%' ESCAPE '\')`

// ListRolesPage returns one page of the whole role catalogue, including roles nobody holds
// yet. The holder count tells an administrator whether deleting one is possible.
func (s *Store) ListRolesPage(
	ctx context.Context,
	query string,
	page domain.Page,
) (domain.Paged[domain.Role], error) {
	term := likeTerm(query)
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM roles r`+roleSearch, term).Scan(&total); err != nil {
		return domain.Paged[domain.Role]{}, classify(fmt.Errorf("count roles: %w", err))
	}

	rows, err := s.pool.Query(ctx, `
		SELECT r.key, r.label, r.is_system, r.created_at, count(ur.user_id)
		  FROM roles r
		  LEFT JOIN user_roles ur ON ur.role = r.key`+roleSearch+`
		 GROUP BY r.key
		 ORDER BY r.key
		 LIMIT $2 OFFSET $3`, term, page.Limit, page.Offset)
	if err != nil {
		return domain.Paged[domain.Role]{}, classify(fmt.Errorf("query roles: %w", err))
	}
	defer rows.Close()

	roles := make([]domain.Role, 0, page.Limit)
	for rows.Next() {
		var role domain.Role
		if err := rows.Scan(&role.Key, &role.Label, &role.IsSystem, &role.CreatedAt, &role.UserCount); err != nil {
			return domain.Paged[domain.Role]{}, classify(fmt.Errorf("scan role: %w", err))
		}
		roles = append(roles, role)
	}
	if err := rows.Err(); err != nil {
		return domain.Paged[domain.Role]{}, classify(fmt.Errorf("iterate roles: %w", err))
	}
	return domain.Paged[domain.Role]{Items: roles, Total: total}, nil
}

// FindRole returns one catalogue entry with its holder count.
func (s *Store) FindRole(ctx context.Context, key string) (domain.Role, bool, error) {
	var role domain.Role
	err := s.pool.QueryRow(ctx, `
		SELECT r.key, r.label, r.is_system, r.created_at,
		       (SELECT count(*) FROM user_roles ur WHERE ur.role = r.key)
		  FROM roles r
		 WHERE r.key = $1`, key,
	).Scan(&role.Key, &role.Label, &role.IsSystem, &role.CreatedAt, &role.UserCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Role{}, false, nil
		}
		return domain.Role{}, false, classify(fmt.Errorf("find role: %w", err))
	}
	return role, true, nil
}

// CreateRole adds one role to the catalogue before anyone holds it.
func (s *Store) CreateRole(ctx context.Context, key string, label string) (domain.Role, error) {
	var role domain.Role
	err := s.pool.QueryRow(ctx, `
		INSERT INTO roles (key, label) VALUES ($1, $2)
		RETURNING key, label, is_system, created_at`, key, label,
	).Scan(&role.Key, &role.Label, &role.IsSystem, &role.CreatedAt)
	if err != nil {
		return domain.Role{}, classify(mapUniqueViolation(err,
			fmt.Sprintf("role %q already exists", key)))
	}
	return role, nil
}

// UpdateRoleLabel renames a role in the catalogue. The key stays fixed: process nodes and
// authorization compare it.
func (s *Store) UpdateRoleLabel(ctx context.Context, key string, label string) (domain.Role, error) {
	var role domain.Role
	err := s.pool.QueryRow(ctx, `
		UPDATE roles SET label = $2 WHERE key = $1
		RETURNING key, label, is_system, created_at`, key, label,
	).Scan(&role.Key, &role.Label, &role.IsSystem, &role.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Role{}, fmt.Errorf("%w: role %q", ErrNotFound, key)
		}
		return domain.Role{}, classify(fmt.Errorf("update role: %w", err))
	}
	return role, nil
}

// DeleteRole removes a role that nothing depends on: not a system role, held by nobody, and
// not assigned by any published process version. A published version is immutable, so a
// role named there cannot be removed without invalidating an existing definition.
func (s *Store) DeleteRole(ctx context.Context, key string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var isSystem bool
		if err := tx.QueryRow(ctx,
			`SELECT is_system FROM roles WHERE key = $1 FOR UPDATE`, key).Scan(&isSystem); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: role %q", ErrNotFound, key)
			}
			return fmt.Errorf("lock role: %w", err)
		}
		if isSystem {
			return fmt.Errorf("%w: role %q is defined by the platform", ErrInUse, key)
		}

		var holders int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM user_roles WHERE role = $1`, key).Scan(&holders); err != nil {
			return fmt.Errorf("count role holders: %w", err)
		}
		if holders > 0 {
			return fmt.Errorf("%w: role %q is held by %d user(s)", ErrInUse, key, holders)
		}

		var used bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				  FROM process_definition_versions v,
				       jsonb_array_elements(v.nodes) AS node
				 WHERE node->>'assigneeRole' = $1
			)`, key).Scan(&used); err != nil {
			return fmt.Errorf("check role usage: %w", err)
		}
		if used {
			return fmt.Errorf("%w: role %q is assigned by a published process", ErrInUse, key)
		}

		if _, err := tx.Exec(ctx, `DELETE FROM roles WHERE key = $1`, key); err != nil {
			return fmt.Errorf("delete role: %w", err)
		}
		return nil
	})
	if err != nil {
		return classify(err)
	}
	return nil
}

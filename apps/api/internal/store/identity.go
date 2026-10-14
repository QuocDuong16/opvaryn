package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// userSelect reads a user with the roles it holds. Nothing else in the codebase
// selects password_hash, so there is one place to audit.
const userSelect = `
	SELECT u.id, u.email, u.name, u.password_hash, u.department_key, u.status,
	       COALESCE(r.roles, ARRAY[]::text[]) AS roles,
	       u.created_at, u.updated_at
	  FROM users u
	  LEFT JOIN LATERAL (
	       SELECT array_agg(role ORDER BY role) AS roles
	         FROM user_roles
	        WHERE user_id = u.id
	  ) r ON true`

// FindUserByEmail returns one user by its normal form address.
func (s *Store) FindUserByEmail(ctx context.Context, email string) (domain.User, bool, error) {
	row := s.pool.QueryRow(ctx, userSelect+` WHERE u.email = $1`, email)
	return scanUserFound(row)
}

// FindUserByID returns one user.
func (s *Store) FindUserByID(ctx context.Context, id uuid.UUID) (domain.User, bool, error) {
	row := s.pool.QueryRow(ctx, userSelect+` WHERE u.id = $1`, id)
	return scanUserFound(row)
}

// ListUsers returns every user ordered by email.
func (s *Store) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.pool.Query(ctx, userSelect+` ORDER BY u.email`)
	if err != nil {
		return nil, classify(fmt.Errorf("query users: %w", err))
	}
	defer rows.Close()

	users := make([]domain.User, 0)
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, classify(err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("iterate users: %w", err))
	}
	return users, nil
}

// CreateUser inserts a user and its roles in one transaction. The password is
// already hashed by the caller; nothing here ever sees a plaintext password.
func (s *Store) CreateUser(ctx context.Context, user domain.User, passwordHash string) (domain.User, error) {
	created := user
	created.PasswordHash = passwordHash

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO users (id, email, name, password_hash, department_key, status)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING created_at, updated_at`,
			user.ID, user.Email, user.Name, passwordHash, user.DepartmentKey, user.Status,
		).Scan(&created.CreatedAt, &created.UpdatedAt)
		if err != nil {
			return mapUniqueViolation(err, fmt.Sprintf("user %q already exists", user.Email))
		}

		for _, role := range user.Roles {
			if _, err := tx.Exec(ctx,
				`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, user.ID, role); err != nil {
				return fmt.Errorf("insert user role: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return domain.User{}, classify(err)
	}
	return created, nil
}

// AddUserRoles grants roles without removing the ones already held.
func (s *Store) AddUserRoles(ctx context.Context, userID uuid.UUID, roles []string) (domain.User, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, role := range roles {
			if _, err := tx.Exec(ctx, `
				INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
				ON CONFLICT (user_id, role) DO NOTHING`, userID, role); err != nil {
				return fmt.Errorf("grant role: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return domain.User{}, classify(err)
	}
	user, found, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return domain.User{}, err
	}
	if !found {
		return domain.User{}, fmt.Errorf("%w: user %s", ErrNotFound, userID)
	}
	return user, nil
}

// UpdatePassword replaces one user's password hash.
func (s *Store) UpdatePassword(ctx context.Context, userID uuid.UUID, passwordHash string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
		userID, passwordHash)
	if err != nil {
		return classify(fmt.Errorf("update password: %w", err))
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: user %s", ErrNotFound, userID)
	}
	return nil
}

// FindDepartment returns one department of the closed catalogue.
func (s *Store) FindDepartment(ctx context.Context, key string) (domain.Department, bool, error) {
	var department domain.Department
	err := s.pool.QueryRow(ctx,
		`SELECT key, name, created_at FROM departments WHERE key = $1`, key,
	).Scan(&department.Key, &department.Name, &department.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Department{}, false, nil
		}
		return domain.Department{}, false, classify(err)
	}
	return department, true, nil
}

// EnsureDepartment creates a department or renames an existing one.
func (s *Store) EnsureDepartment(ctx context.Context, key string, name string) (domain.Department, error) {
	var department domain.Department
	err := s.pool.QueryRow(ctx, `
		INSERT INTO departments (key, name) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
		RETURNING key, name, created_at`, key, name,
	).Scan(&department.Key, &department.Name, &department.CreatedAt)
	if err != nil {
		return domain.Department{}, classify(fmt.Errorf("ensure department: %w", err))
	}
	return department, nil
}

// CreateSession stores a session; only the token hash travels here.
func (s *Store) CreateSession(ctx context.Context, session domain.Session) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)`,
		session.ID, session.UserID, session.TokenHash, session.ExpiresAt)
	if err != nil {
		return classify(fmt.Errorf("insert session: %w", err))
	}
	return nil
}

// FindSession returns a live session by token hash. Expired rows are simply not
// found; a cleanup job is not needed while login writes one row per sign-in.
func (s *Store) FindSession(ctx context.Context, tokenHash []byte, now time.Time) (domain.Session, bool, error) {
	var session domain.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, token_hash, created_at, expires_at
		  FROM sessions
		 WHERE token_hash = $1 AND expires_at > $2`, tokenHash, now,
	).Scan(&session.ID, &session.UserID, &session.TokenHash, &session.CreatedAt, &session.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, false, nil
		}
		return domain.Session{}, false, classify(err)
	}
	return session, true, nil
}

// DeleteSession ends one session by token hash.
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash); err != nil {
		return classify(fmt.Errorf("delete session: %w", err))
	}
	return nil
}

// DeleteSessionsForUser ends every session of one user (used when disabling one).
func (s *Store) DeleteSessionsForUser(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return classify(fmt.Errorf("delete user sessions: %w", err))
	}
	return nil
}

func scanUserFound(row rowScanner) (domain.User, bool, error) {
	user, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.User{}, false, nil
		}
		return domain.User{}, false, err
	}
	return user, true, nil
}

func scanUser(row rowScanner) (domain.User, error) {
	var (
		user  domain.User
		roles []string
	)
	err := row.Scan(
		&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.DepartmentKey,
		&user.Status, &roles, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return domain.User{}, fmt.Errorf("scan user: %w", err)
	}
	user.Roles = roles
	return user, nil
}

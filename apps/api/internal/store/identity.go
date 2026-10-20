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
	SELECT u.id, u.email, u.name, u.password_hash, u.department_key, d.name AS department_name,
	       u.status, COALESCE(r.roles, ARRAY[]::text[]) AS roles,
	       u.created_at, u.updated_at
	  FROM users u
	  JOIN departments d ON d.key = u.department_key
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
			// A role granted through the CLI or the bootstrap path joins the catalogue too, so
			// the administration screen never shows a user holding an unknown role.
			if _, err := tx.Exec(ctx,
				`INSERT INTO roles (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, role); err != nil {
				return fmt.Errorf("register role: %w", err)
			}
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

// ListRoles returns every role at least one user holds, sorted. It is the catalogue
// the workflow designer offers: a definition that assigns a role nobody holds would
// wait forever, so the editor wants the roles that actually exist.
func (s *Store) ListRoles(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.key
		  FROM roles r
		 WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role = r.key)
		 ORDER BY r.key`)
	if err != nil {
		return nil, classify(fmt.Errorf("query roles: %w", err))
	}
	defer rows.Close()

	roles := make([]string, 0)
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return nil, classify(fmt.Errorf("scan role: %w", err))
		}
		roles = append(roles, role)
	}
	if err := rows.Err(); err != nil {
		return nil, classify(fmt.Errorf("read roles: %w", err))
	}
	return roles, nil
}

// AddUserRoles grants roles without removing the ones already held.
func (s *Store) AddUserRoles(ctx context.Context, userID uuid.UUID, roles []string) (domain.User, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, role := range roles {
			if _, err := tx.Exec(ctx, `
				INSERT INTO roles (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, role); err != nil {
				return fmt.Errorf("register role: %w", err)
			}
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

// UpdatePassword replaces one user's password hash and ends every existing session: a
// password reset is also the way an administrator takes back an account.
func (s *Store) UpdatePassword(ctx context.Context, userID uuid.UUID, passwordHash string) error {
	return s.updatePassword(ctx, userID, passwordHash, nil)
}

// UpdatePasswordKeepingSession replaces the hash and ends every session except the one whose
// token hash is given: a person changing their own password stays signed in where they are,
// while other devices are signed out.
func (s *Store) UpdatePasswordKeepingSession(
	ctx context.Context,
	userID uuid.UUID,
	passwordHash string,
	keepTokenHash []byte,
) error {
	return s.updatePassword(ctx, userID, passwordHash, keepTokenHash)
}

func (s *Store) updatePassword(
	ctx context.Context,
	userID uuid.UUID,
	passwordHash string,
	keepTokenHash []byte,
) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
			userID, passwordHash)
		if err != nil {
			return fmt.Errorf("update password: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: user %s", ErrNotFound, userID)
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM sessions
			 WHERE user_id = $1 AND ($2::bytea IS NULL OR token_hash <> $2)`,
			userID, keepTokenHash); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		return nil
	})
	if err != nil {
		return classify(err)
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

// DeleteExpiredSessions removes every session whose expiry has passed and returns how
// many rows went away. Expired sessions are already unusable (lookup filters on
// expires_at), so this is housekeeping — but it is the kind that otherwise never
// happens and leaves the table growing forever.
func (s *Store) DeleteExpiredSessions(ctx context.Context, now time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= $1`, now)
	if err != nil {
		return 0, classify(fmt.Errorf("delete expired sessions: %w", err))
	}
	return tag.RowsAffected(), nil
}

// TouchSession moves one live session's expiry forward. It is the sliding half of the
// session policy: an active person is not signed out mid-day, while an idle session still
// ends.
func (s *Store) TouchSession(ctx context.Context, tokenHash []byte, expiresAt time.Time) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions SET expires_at = $2 WHERE token_hash = $1`, tokenHash, expiresAt)
	if err != nil {
		return classify(fmt.Errorf("touch session: %w", err))
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: session", ErrNotFound)
	}
	return nil
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
		&user.DepartmentName, &user.Status, &roles, &user.CreatedAt, &user.UpdatedAt,
	)
	if err != nil {
		return domain.User{}, fmt.Errorf("scan user: %w", err)
	}
	user.Roles = roles
	return user, nil
}

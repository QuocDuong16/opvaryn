// Command useradm administers users, roles and departments from the terminal.
//
// It exists because the first user cannot be created over the API (the chicken and
// egg problem ADR 0008 describes) and because operating accounts is admin work, not
// a feature of the pilot UI yet.
//
// Usage:
//
//	useradm -create-department -key ky_thuat -name "Kỹ thuật"
//	useradm -create -email lan@example.com -name "Lan" -password '...' -department ky_thuat -roles truong_bo_phan
//	useradm -add-role -email lan@example.com -roles process_designer
//	useradm -set-password -email lan@example.com -password '...'
//	useradm -prune-sessions
//	useradm -prune-orphan-attachments
//	useradm -unlock -email lan@example.com
//	useradm -list-lockouts
//	useradm -reset-2fa -email lan@example.com
//	useradm -escalate
//	useradm -prune-login-failures
//	useradm -list
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/config"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
	"github.com/QuocDuong16/opvaryn/api/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "useradm: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		createDepartment = flag.Bool("create-department", false, "create or rename a department")
		create           = flag.Bool("create", false, "create a user")
		setPassword      = flag.Bool("set-password", false, "replace a user's password")
		addRole          = flag.Bool("add-role", false, "grant roles to an existing user")
		pruneSessions    = flag.Bool("prune-sessions", false, "delete expired sessions")
		pruneFiles       = flag.Bool("prune-orphan-attachments", false,
			"delete uploads that were never attached to a record (older than 24h)")
		unlock       = flag.Bool("unlock", false, "clear the sign-in cooldown of an address")
		listLockouts = flag.Bool("list-lockouts", false,
			"list the addresses that are waiting out a sign-in cooldown")
		resetTwoFactor = flag.Bool("reset-2fa", false,
			"turn the two-step verification of an account off (the device was lost)")
		escalate = flag.Bool("escalate", false,
			"hand overdue tasks over to the role their step names (ADR 0031)")
		pruneFailures = flag.Bool("prune-login-failures", false,
			"delete sign-in failures older than the cooldown window")
		setRoleLabel = flag.Bool("set-role-label", false, "name a role for the interface")
		list         = flag.Bool("list", false, "list users")

		email      = flag.String("email", "", "user email (normalised to lower case)")
		name       = flag.String("name", "", "display name")
		password   = flag.String("password", "", "password (at least 10 characters); prefer the prompt over the shell history")
		department = flag.String("department", "", "department key of the user")
		roles      = flag.String("roles", "", "comma-separated roles, e.g. truong_bo_phan,ke_toan")
		key        = flag.String("key", "", "department key")
		depName    = flag.String("department-name", "", "department display name")
		role       = flag.String("role", "", "role key, e.g. truong_bo_phan")
		label      = flag.String("label", "", "display name of the role, e.g. 'Trưởng bộ phận'")

		timeout = flag.Duration("timeout", 30*time.Second, "database timeout")
	)
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	identity := service.NewIdentity(st)

	switch {
	case *createDepartment:
		department, err := identity.EnsureDepartment(ctx, *key, *depName)
		if err != nil {
			return err
		}
		fmt.Printf("department %s: %s\n", department.Key, department.Name)
		return nil

	case *create:
		user, err := identity.CreateUser(ctx, service.NewUserInput{
			Email:         *email,
			Name:          *name,
			Password:      *password,
			DepartmentKey: *department,
			Roles:         splitRoles(*roles),
		})
		if err != nil {
			return err
		}
		fmt.Printf("created %s (%s) in %s with roles %s\n",
			user.Email, user.Name, user.DepartmentKey, strings.Join(user.Roles, ", "))
		return nil

	case *addRole:
		user, err := identity.AddRoles(ctx, *email, splitRoles(*roles))
		if err != nil {
			return err
		}
		fmt.Printf("%s now holds roles %s\n", user.Email, strings.Join(user.Roles, ", "))
		return nil

	case *setPassword:
		user, err := identity.SetPassword(ctx, *email, *password)
		if err != nil {
			return err
		}
		fmt.Printf("password updated for %s\n", user.Email)
		return nil

	case *setRoleLabel:
		if err := identity.SetRoleLabel(ctx, domain.NewPrincipal(adminUser()), *role, *label); err != nil {
			return err
		}
		fmt.Printf("role %s is shown as %q\n", *role, *label)
		return nil

	case *pruneSessions:
		removed, err := identity.PruneSessions(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("removed %d expired session(s)\n", removed)
		return nil

	case *pruneFiles:
		removed, err := service.NewAttachments(st).PruneOrphans(ctx, 24*time.Hour)
		if err != nil {
			return err
		}
		fmt.Printf("removed %d orphan attachment(s)\n", removed)
		return nil

	case *unlock:
		if *email == "" {
			return fmt.Errorf("unlock needs -email")
		}
		if err := identity.UnlockEmail(ctx, *email); err != nil {
			return err
		}
		fmt.Printf("cleared the sign-in cooldown of %s\n", service.NormalizeEmail(*email))
		return nil

	case *listLockouts:
		addresses, err := identity.LockedEmails(ctx)
		if err != nil {
			return err
		}
		if len(addresses) == 0 {
			fmt.Println("no address is waiting out a sign-in cooldown")
			return nil
		}
		for _, address := range addresses {
			fmt.Printf("%s\n", address)
		}
		return nil

	case *escalate:
		location, locationErr := time.LoadLocation("Asia/Ho_Chi_Minh")
		if locationErr != nil {
			return fmt.Errorf("load the organisation's timezone: %w", locationErr)
		}
		workingHours := service.NewWorkingHours(st, location)
		escalation := service.NewEscalation(st, workingHours, nil)
		escalated, err := escalation.RunOnce(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("escalated %d overdue task(s)\n", escalated)
		return nil

	case *resetTwoFactor:
		if *email == "" {
			return fmt.Errorf("reset-2fa needs -email")
		}
		if err := identity.ResetTwoFactor(ctx, *email); err != nil {
			return err
		}
		fmt.Printf("turned the two-step verification of %s off\n", service.NormalizeEmail(*email))
		return nil

	case *pruneFailures:
		removed, err := identity.PruneLoginFailures(ctx, service.LoginFailureWindow)
		if err != nil {
			return err
		}
		fmt.Printf("removed %d sign-in failure(s)\n", removed)
		return nil

	case *list:
		users, err := identity.ListUsers(ctx)
		if err != nil {
			return err
		}
		for _, user := range users {
			fmt.Printf("%-30s %-24s %-14s %-28s %s\n",
				user.Email, user.Name, user.DepartmentKey, strings.Join(user.Roles, ","), user.Status)
		}
		return nil

	default:
		flag.Usage()
		return fmt.Errorf("nothing to do: pass -create, -add-role, -set-password, -create-department, -set-role-label, -prune-sessions, -prune-orphan-attachments, -unlock, -list-lockouts, -reset-2fa, -escalate, -prune-login-failures or -list")
	}
}

// adminUser is the principal the CLI acts as. The binary is the bootstrap tool (ADR 0008): it
// already runs with database credentials, so it holds the administrator role rather than
// pretending to have a session. The id is freshly generated per run — the principal has to look
// authenticated to the service, and nothing stores it.
func adminUser() domain.User {
	return domain.User{
		ID:     uuid.New(),
		Roles:  []string{domain.RoleAdmin},
		Status: domain.UserActive,
	}
}

func splitRoles(raw string) []string {
	parts := strings.Split(raw, ",")
	roles := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			roles = append(roles, trimmed)
		}
	}
	return roles
}

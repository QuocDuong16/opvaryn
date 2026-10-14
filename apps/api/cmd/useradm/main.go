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
//	useradm -set-password -email lan@example.com -password '...'
//	useradm -list
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/config"
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
		list             = flag.Bool("list", false, "list users")

		email      = flag.String("email", "", "user email (normalised to lower case)")
		name       = flag.String("name", "", "display name")
		password   = flag.String("password", "", "password (at least 10 characters); prefer the prompt over the shell history")
		department = flag.String("department", "", "department key of the user")
		roles      = flag.String("roles", "", "comma-separated roles, e.g. truong_bo_phan,ke_toan")
		key        = flag.String("key", "", "department key")
		depName    = flag.String("department-name", "", "department display name")

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

	case *setPassword:
		user, err := identity.SetPassword(ctx, *email, *password)
		if err != nil {
			return err
		}
		fmt.Printf("password updated for %s\n", user.Email)
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
		return fmt.Errorf("nothing to do: pass -create, -set-password, -create-department or -list")
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

package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// SessionCookieName is the cookie the browser carries. It holds the session token;
// only its hash is stored server-side (ADR 0008).
const SessionCookieName = "opvaryn.session"

type userContextKey struct{}

// sessionMiddleware resolves the session cookie once per request and puts the user
// in the request context. Requests without a cookie stay anonymous; a database
// failure is reported instead of silently degrading to anonymous. A session close to
// expiry is slid forward, and the cookie is refreshed to match, so an active person is
// not signed out mid-day.
func sessionMiddleware(
	identity *service.Identity,
	secureCookies bool,
	log *slog.Logger,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(SessionCookieName)
			if err != nil || cookie.Value == "" {
				next.ServeHTTP(w, r)
				return
			}

			user, renewed, err := identity.AuthenticateAndRenew(r.Context(), cookie.Value)
			switch {
			case err == nil:
				r = r.WithContext(context.WithValue(r.Context(), userContextKey{}, user))
				if renewed {
					http.SetCookie(w, sessionCookie(secureCookies, cookie.Value,
						int(service.SessionTTL.Seconds())))
				}
			case errors.Is(err, service.ErrUnauthorized):
				// An expired or unknown session is simply an anonymous request.
			default:
				writeStoreError(w, log, err, "authenticate session")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// currentUser returns the authenticated user, if the request carries a session.
func currentUser(r *http.Request) (domain.User, bool) {
	user, ok := r.Context().Value(userContextKey{}).(domain.User)
	return user, ok
}

// requireUser answers 401 and reports false when no session is present.
func requireUser(w http.ResponseWriter, log *slog.Logger, r *http.Request) (domain.User, bool) {
	user, ok := currentUser(r)
	if !ok {
		writeError(w, log, http.StatusUnauthorized, codeUnauthorized, "sign in to continue")
		return domain.User{}, false
	}
	return user, true
}

// sessionCookie builds the cookie both auth handlers use. Secure is set outside
// development: a Secure cookie is what production wants, while local development and
// the smoke tests speak plain http (where a Secure cookie is not sent back).
func sessionCookie(secure bool, value string, maxAge int) *http.Cookie {
	// gosec cannot see that Secure is true outside development; the smoke tests and
	// local development speak plain http, where a Secure cookie never comes back.
	return &http.Cookie{ // #nosec G124 -- Secure is set from configuration, true outside development
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	}
}

func handleLogin(identity *service.Identity, secureCookies bool, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body apiv1.LoginJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the LoginRequest schema")
			return
		}

		token, user, err := identity.Login(r.Context(), body.Email, body.Password)
		if err != nil {
			if errors.Is(err, service.ErrInvalidCredentials) {
				// The address is logged without the password; the response is the
				// same for an unknown email and a wrong password.
				log.Warn("login rejected", "email", service.NormalizeEmail(body.Email))
				writeError(w, log, http.StatusUnauthorized, codeUnauthorized,
					"email or password is incorrect")
				return
			}
			writeStoreError(w, log, err, "login")
			return
		}

		http.SetCookie(w, sessionCookie(secureCookies, token, int(service.SessionTTL.Seconds())))
		writeJSON(w, log, http.StatusOK, meResponse(r.Context(), identity, user, log))
	}
}

func handleLogout(identity *service.Identity, secureCookies bool, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(SessionCookieName); err == nil {
			if err := identity.Logout(r.Context(), cookie.Value); err != nil {
				writeStoreError(w, log, err, "logout")
				return
			}
		}
		http.SetCookie(w, sessionCookie(secureCookies, "", -1))
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleMe(identity *service.Identity, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		writeJSON(w, log, http.StatusOK, meResponse(r.Context(), identity, user, log))
	}
}

// handleChangeMyPassword lets the signed-in person replace their own password. The
// current password is verified first; other sessions end, this one stays.
func handleChangeMyPassword(identity *service.Identity, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := requireUser(w, log, r); !ok {
			return
		}
		cookie, err := r.Cookie(SessionCookieName)
		if err != nil || cookie.Value == "" {
			writeError(w, log, http.StatusUnauthorized, codeUnauthorized, "sign in to continue")
			return
		}

		var body apiv1.ChangeMyPasswordJSONRequestBody
		if err := decodeJSON(w, r, &body); err != nil {
			log.Warn("rejected request body", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"request body must be a single JSON object matching the ChangeMyPasswordRequest schema")
			return
		}

		if err := identity.ChangePassword(r.Context(), cookie.Value, body.CurrentPassword, body.NewPassword); err != nil {
			writeStoreError(w, log, err, "change password")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleListRoles serves the role catalogue the workflow designer offers.
func handleListRoles(identity *service.Identity, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		roles, err := identity.ListRoles(r.Context(), domain.NewPrincipal(user))
		if err != nil {
			writeStoreError(w, log, err, "list roles")
			return
		}
		entries := make([]apiv1.RoleEntry, 0, len(roles))
		for _, role := range roles {
			entries = append(entries, apiv1.RoleEntry{Key: role.Key, Label: role.Label})
		}
		writeJSON(w, log, http.StatusOK, apiv1.RoleList{Data: entries})
	}
}

// meResponse answers who is signed in, with the display names a screen needs: the department
// name and the label of every role the person holds (ADR 0016). A role nobody has named is
// absent from the map, so the caller shows its key.
func meResponse(
	ctx context.Context,
	identity *service.Identity,
	user domain.User,
	log *slog.Logger,
) apiv1.Me {
	labels, err := identity.RoleLabels(ctx, user)
	if err != nil {
		// A missing label must not break signing in: fall back to keys.
		log.Warn("read role labels failed", "error", err)
		labels = map[string]string{}
	}
	return toAPIMe(user, labels)
}

func toAPIMe(user domain.User, roleLabels map[string]string) apiv1.Me {
	roles := user.Roles
	if roles == nil {
		roles = []string{}
	}
	if roleLabels == nil {
		roleLabels = map[string]string{}
	}
	return apiv1.Me{
		Id:             user.ID,
		Email:          user.Email,
		Name:           user.Name,
		Department:     user.DepartmentKey,
		DepartmentName: user.DepartmentName,
		Roles:          roles,
		RoleLabels:     roleLabels,
	}
}

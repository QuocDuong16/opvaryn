package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// listQuery reads the parameters every list endpoint shares: a search term and a page. A
// value that is not a whole number is refused by name, so the caller learns which parameter
// to fix; the ranges live in the service (domain.Page), where every list sees them.
func listQuery(r *http.Request) (service.ListOptions, error) {
	var opts service.ListOptions
	for name, target := range map[string]*int{
		"limit":  &opts.Page.Limit,
		"offset": &opts.Page.Offset,
	} {
		raw := r.URL.Query().Get(name)
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil {
			return service.ListOptions{}, fmt.Errorf("%s must be a whole number, got %q", name, raw)
		}
		*target = value
	}
	opts.Query = strings.TrimSpace(r.URL.Query().Get("q"))
	return opts, nil
}

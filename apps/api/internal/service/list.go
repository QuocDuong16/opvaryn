package service

import (
	"strings"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// maxSearchLength bounds the search term. It is a screen filter, not a query language, and a
// term longer than this is a client bug rather than a search.
const maxSearchLength = 100

// ListOptions is what every list endpoint accepts: a search term and one page. The page is
// resolved here so no store has to know about defaults, and so a bad value is refused with a
// message that names the parameter (the caller reads it).
type ListOptions struct {
	Query string
	Page  domain.Page
}

// normalized applies the page defaults and trims the search term.
func (o ListOptions) normalized() (ListOptions, error) {
	page, err := o.Page.Normalize()
	if err != nil {
		return ListOptions{}, &ValidationError{Problems: []string{err.Error()}}
	}
	o.Page = page
	o.Query = strings.TrimSpace(o.Query)
	if len(o.Query) > maxSearchLength {
		return ListOptions{}, &ValidationError{
			Problems: []string{"q must be at most 100 characters"},
		}
	}
	return o, nil
}

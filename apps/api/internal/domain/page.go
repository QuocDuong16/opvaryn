package domain

import "fmt"

// Lists are paginated in the service, never in the browser: a screen asks for one page and
// gets the total with it, so it can say "1–25 / 118" without the API ever shipping 118 rows.
// A page is small by default and bounded above, so a client cannot ask for the whole table by
// accident.
const (
	DefaultPageSize = 25
	MaxPageSize     = 100
)

// Page is one slice of a list: how many rows, from where.
type Page struct {
	Limit  int
	Offset int
}

// Normalize applies the default size and refuses what the API does not accept. The message is
// written for the caller: it names the parameter and the range.
func (p Page) Normalize() (Page, error) {
	if p.Limit == 0 {
		p.Limit = DefaultPageSize
	}
	if p.Limit < 1 || p.Limit > MaxPageSize {
		return Page{}, fmt.Errorf("limit must be between 1 and %d, got %d", MaxPageSize, p.Limit)
	}
	if p.Offset < 0 {
		return Page{}, fmt.Errorf("offset must not be negative, got %d", p.Offset)
	}
	return p, nil
}

// Paged is a list with the total behind it, so a caller can render pagination without a
// second request.
type Paged[T any] struct {
	Items []T
	Total int
}

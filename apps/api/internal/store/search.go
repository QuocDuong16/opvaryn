package store

import "strings"

// likeTerm prepares a search term for a LIKE/ILIKE pattern.
//
// A person searching for "50%" means the text "50%", not "everything": the wildcards of
// the pattern are escaped, so the search is literal. The queries declare the escape
// character with `ESCAPE '\'`.
//
// The term stays empty when it is empty, and every filter keeps its "an empty term
// matches everything" rule.
func likeTerm(term string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(term)
}

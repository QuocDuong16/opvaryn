package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Lookups fetches the options of a select field from another system (ADR 0034). The
// source is a URL the organisation configures; the answer is a small JSON document with
// the options. A source may also name where records are written back to that system
// (ADR 0037).

// lookupTimeout bounds one call to the outside world.
const lookupTimeout = 5 * time.Second

// lookupMaxBytes bounds how much is read from the outside world.
const lookupMaxBytes = 1 << 20

// lookupMaxOptions bounds how many options one source may offer.
const lookupMaxOptions = 200

// LookupConfig is how the lookup integration is set up on this server.
type LookupConfig struct {
	// AllowInternal lets a source live in the machine's own network. It is off by
	// default: a source is called by the server, and the server must not become a
	// bridge into the network. An organisation whose catalogue is an internal system
	// turns it on deliberately (ADR 0037).
	AllowInternal bool
}

// Lookups is the service of the external catalogue.
type Lookups struct {
	store  lookupStore
	client *http.Client
}

// lookupStore is the persistence of the lookup sources.
type lookupStore interface {
	GetBusinessObjectByKey(ctx context.Context, key string) (domain.BusinessObject, error)
	ListLookupSources(ctx context.Context, objectKey string) ([]domain.LookupSource, error)
	SaveLookupSource(ctx context.Context, source domain.LookupSource) error
	DeleteLookupSource(ctx context.Context, objectKey string, fieldKey string) error
}

// NewLookups returns the lookup service. Its client refuses to reach the machine's own
// network: a source is configured by an administrator, but every signed-in person can make
// the server call it, and that must not turn the server into a bridge into the network.
func NewLookups(st lookupStore, config LookupConfig) *Lookups {
	return &Lookups{store: st, client: newGuardedClient(lookupTimeout, config.AllowInternal)}
}

// newGuardedClient returns the client every call to the outside world goes through. It
// refuses the machine's own addresses and does not follow a redirect (ADR 0034, ADR 0037).
func newGuardedClient(timeout time.Duration, allowInternal bool) *http.Client {
	dialer := &net.Dialer{Timeout: timeout}
	return &http.Client{
		Timeout: timeout,
		// A source that redirects is not followed: the redirect could point anywhere.
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return fmt.Errorf("the source tried to redirect")
		},
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
				host, _, err := net.SplitHostPort(address)
				if err != nil {
					return nil, fmt.Errorf("the source has no address")
				}
				if !allowInternal {
					if err := refuseInternalAddress(host); err != nil {
						return nil, err
					}
				}
				return dialer.DialContext(ctx, network, address)
			},
		},
	}
}

// refuseInternalAddress keeps the server from calling itself, the local network or the
// metadata service of a cloud host.
func refuseInternalAddress(host string) error {
	if strings.EqualFold(host, "localhost") {
		return fmt.Errorf("the source points at this machine")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(context.Background(), host)
	if err != nil {
		return fmt.Errorf("the source's host cannot be found")
	}
	for _, address := range addresses {
		ip := address.IP
		switch {
		case ip.IsLoopback(), ip.IsPrivate(), ip.IsLinkLocalUnicast(),
			ip.IsLinkLocalMulticast(), ip.IsUnspecified():
			return fmt.Errorf("the source points at an address of this network")
		}
	}
	return nil
}

// LookupField is one field of a definition and the options its source offers.
type LookupField struct {
	FieldKey string
	URL      string
	// WriteURL and WriteFields describe where records are written back to that
	// system and which fields it receives (ADR 0037). An empty WriteURL means the
	// source is read-only.
	WriteURL    string
	WriteFields []string
	Options     []domain.LookupOption
	Error       string
}

// List returns the lookup sources of one definition, with the options each one offers. A
// source that cannot be reached does not stop the others: its field answers with the reason.
func (l *Lookups) List(
	ctx context.Context,
	principal domain.Principal,
	objectKey string,
) ([]LookupField, error) {
	if err := requireAuthenticated(principal); err != nil {
		return nil, err
	}
	key := strings.TrimSpace(objectKey)
	if !KeyPattern.MatchString(key) {
		return nil, &ValidationError{Problems: []string{
			"object_key: must match " + KeyPattern.String(),
		}}
	}
	sources, err := l.store.ListLookupSources(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("read lookup sources: %w", err)
	}

	fields := make([]LookupField, 0, len(sources))
	for _, source := range sources {
		field := LookupField{
			FieldKey:    source.FieldKey,
			URL:         source.URL,
			WriteURL:    source.WriteURL,
			WriteFields: source.WriteFields,
		}
		options, err := l.fetch(ctx, source.URL)
		if err != nil {
			field.Error = err.Error()
		} else {
			field.Options = options
		}
		fields = append(fields, field)
	}
	return fields, nil
}

// LookupSourceConfig is what an administrator saves for one field: where the options come
// from, and — when the source is written back to as well — where a record goes and which
// fields it carries (ADR 0034, ADR 0037).
type LookupSourceConfig struct {
	URL string
	// WriteURL is empty when the source is read-only.
	WriteURL string
	// WriteFields are the fields sent to that system.
	WriteFields []string
}

// Set stores the lookup source of one field. An empty URL removes the source, and with it
// its write-back.
func (l *Lookups) Set(
	ctx context.Context,
	principal domain.Principal,
	objectKey string,
	fieldKey string,
	config LookupSourceConfig,
) error {
	if err := requireAdmin(principal); err != nil {
		return err
	}
	key := strings.TrimSpace(objectKey)
	if !KeyPattern.MatchString(key) {
		return &ValidationError{Problems: []string{
			"object_key: must match " + KeyPattern.String(),
		}}
	}
	field := strings.TrimSpace(fieldKey)
	if !KeyPattern.MatchString(field) {
		return &ValidationError{Problems: []string{
			"field_key: must match " + KeyPattern.String(),
		}}
	}
	address := strings.TrimSpace(config.URL)
	if address == "" {
		if err := l.store.DeleteLookupSource(ctx, key, field); err != nil {
			return fmt.Errorf("delete the lookup source: %w", err)
		}
		return nil
	}
	if err := validateLookupURL(address); err != nil {
		return &ValidationError{Problems: []string{err.Error()}}
	}

	writeURL := strings.TrimSpace(config.WriteURL)
	writeFields, problems := l.validateWriteBack(ctx, key, writeURL, config.WriteFields)
	if len(problems) > 0 {
		return &ValidationError{Problems: problems}
	}

	if err := l.store.SaveLookupSource(ctx, domain.LookupSource{
		ObjectKey:   key,
		FieldKey:    field,
		URL:         address,
		WriteURL:    writeURL,
		WriteFields: writeFields,
	}); err != nil {
		return fmt.Errorf("store the lookup source: %w", err)
	}
	return nil
}

// validateWriteBack checks the write-back of a source: where to write, and which fields
// to send. A field that the definition does not have is refused here, so a write-back
// never carries a field the record does not hold.
func (l *Lookups) validateWriteBack(
	ctx context.Context,
	objectKey string,
	writeURL string,
	writeFields []string,
) ([]string, []string) {
	if writeURL == "" {
		if len(writeFields) > 0 {
			return nil, []string{
				"write_fields: named fields, but no address to write back to",
			}
		}
		return nil, nil
	}
	if err := validateLookupURL(writeURL); err != nil {
		return nil, []string{err.Error()}
	}

	unique := make([]string, 0, len(writeFields))
	seen := make(map[string]bool, len(writeFields))
	for _, field := range writeFields {
		name := strings.TrimSpace(field)
		if name == "" {
			continue
		}
		if !KeyPattern.MatchString(name) {
			return nil, []string{
				"write_fields: " + name + " is not a field name",
			}
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		unique = append(unique, name)
	}
	if len(unique) == 0 {
		return nil, []string{
			"write_fields: choose at least one field to send",
		}
	}
	sort.Strings(unique)

	object, err := l.store.GetBusinessObjectByKey(ctx, objectKey)
	if err != nil {
		return nil, []string{"write_fields: the definition could not be read"}
	}
	known := make(map[string]bool, len(object.Fields))
	for _, field := range object.Fields {
		known[field.Key] = true
	}
	unknown := make([]string, 0)
	for _, field := range unique {
		if !known[field] {
			unknown = append(unknown, field)
		}
	}
	if len(unknown) > 0 {
		return nil, []string{
			fmt.Sprintf("write_fields: %s is not a field of %s",
				strings.Join(unknown, ", "), objectKey),
		}
	}
	return unique, nil
}

// validateLookupURL keeps the source an address the server is willing to call.
func validateLookupURL(address string) error {
	parsed, err := url.Parse(address)
	if err != nil {
		return fmt.Errorf("url: is not an address: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("url: must be an http or https address")
	}
	if parsed.Host == "" {
		return fmt.Errorf("url: must name a host")
	}
	return nil
}

// fetch reads the options of one source. The answer is a JSON document:
//
//	{"options": [{"value": "sup-01", "label": "Công ty Một"}]}
func (l *Lookups) fetch(ctx context.Context, address string) ([]domain.LookupOption, error) {
	requestCtx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, address, nil)
	if err != nil {
		return nil, fmt.Errorf("the source cannot be called: %w", err)
	}
	response, err := l.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("the source did not answer")
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("the source answered with %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, lookupMaxBytes))
	if err != nil {
		return nil, fmt.Errorf("the source's answer could not be read")
	}
	var payload struct {
		Options []domain.LookupOption `json:"options"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("the source's answer is not the expected document")
	}
	if len(payload.Options) > lookupMaxOptions {
		return nil, fmt.Errorf("the source offers more than %d options", lookupMaxOptions)
	}
	options := make([]domain.LookupOption, 0, len(payload.Options))
	for _, option := range payload.Options {
		value := strings.TrimSpace(option.Value)
		if value == "" {
			continue
		}
		label := strings.TrimSpace(option.Label)
		if label == "" {
			label = value
		}
		options = append(options, domain.LookupOption{Value: value, Label: label})
	}
	return options, nil
}

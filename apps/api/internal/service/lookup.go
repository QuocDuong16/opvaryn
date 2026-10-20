package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// Lookups fetches the options of a select field from another system (ADR 0034). The
// source is a URL the organisation configures; the answer is a small JSON document with
// the options.

// lookupTimeout bounds one call to the outside world.
const lookupTimeout = 5 * time.Second

// lookupMaxBytes bounds how much is read from the outside world.
const lookupMaxBytes = 1 << 20

// lookupMaxOptions bounds how many options one source may offer.
const lookupMaxOptions = 200

// Lookups is the service of the external catalogue.
type Lookups struct {
	store  lookupStore
	client *http.Client
}

// lookupStore is the persistence of the lookup sources.
type lookupStore interface {
	ListLookupSources(ctx context.Context, objectKey string) ([]domain.LookupSource, error)
	SaveLookupSource(ctx context.Context, source domain.LookupSource) error
	DeleteLookupSource(ctx context.Context, objectKey string, fieldKey string) error
}

// NewLookups returns the lookup service. Its client refuses to reach the machine's own
// network: a source is configured by an administrator, but every signed-in person can make
// the server call it, and that must not turn the server into a bridge into the network.
func NewLookups(st lookupStore) *Lookups {
	dialer := &net.Dialer{Timeout: lookupTimeout}
	client := &http.Client{
		Timeout: lookupTimeout,
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
				if err := refuseInternalAddress(host); err != nil {
					return nil, err
				}
				return dialer.DialContext(ctx, network, address)
			},
		},
	}
	return &Lookups{store: st, client: client}
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
	Options  []domain.LookupOption
	Error    string
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
		field := LookupField{FieldKey: source.FieldKey, URL: source.URL}
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

// Set stores the lookup source of one field. An empty URL removes the source.
func (l *Lookups) Set(
	ctx context.Context,
	principal domain.Principal,
	objectKey string,
	fieldKey string,
	rawURL string,
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
	address := strings.TrimSpace(rawURL)
	if address == "" {
		if err := l.store.DeleteLookupSource(ctx, key, field); err != nil {
			return fmt.Errorf("delete the lookup source: %w", err)
		}
		return nil
	}
	if err := validateLookupURL(address); err != nil {
		return &ValidationError{Problems: []string{err.Error()}}
	}
	if err := l.store.SaveLookupSource(ctx, domain.LookupSource{
		ObjectKey: key,
		FieldKey:  field,
		URL:       address,
	}); err != nil {
		return fmt.Errorf("store the lookup source: %w", err)
	}
	return nil
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

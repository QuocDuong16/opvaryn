package service

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/QuocDuong16/opvaryn/api/internal/domain"
)

// fakeLookupStore stands in for the persistence of the lookup sources.
type fakeLookupStore struct {
	object    domain.BusinessObject
	sources   []domain.LookupSource
	saved     domain.LookupSource
	deleted   bool
	saveErr   error
	objectErr error
}

func (f *fakeLookupStore) GetBusinessObjectByKey(context.Context, string) (domain.BusinessObject, error) {
	if f.objectErr != nil {
		return domain.BusinessObject{}, f.objectErr
	}
	return f.object, nil
}

func (f *fakeLookupStore) ListLookupSources(context.Context, string) ([]domain.LookupSource, error) {
	return f.sources, nil
}

func (f *fakeLookupStore) SaveLookupSource(_ context.Context, source domain.LookupSource) error {
	if f.saveErr != nil {
		return f.saveErr
	}
	f.saved = source
	return nil
}

func (f *fakeLookupStore) DeleteLookupSource(context.Context, string, string) error {
	f.deleted = true
	return nil
}

// fakeWritebackStore stands in for the queue of the write-backs.
type fakeWritebackStore struct {
	pending   []domain.LookupWriteback
	claimed   []domain.LookupWriteback
	delivered []uuid.UUID
	conflict  []uuid.UUID
	rejected  []uuid.UUID
	notes     []string
}

func (f *fakeWritebackStore) ClaimLookupWritebacks(
	context.Context,
	time.Time,
	int,
) ([]domain.LookupWriteback, error) {
	f.claimed = append(f.claimed, f.pending...)
	f.pending = nil
	return f.claimed, nil
}

func (f *fakeWritebackStore) MarkLookupWritebackDelivered(
	_ context.Context,
	id uuid.UUID,
	_ int,
	note string,
) error {
	f.delivered = append(f.delivered, id)
	f.notes = append(f.notes, note)
	return nil
}

func (f *fakeWritebackStore) MarkLookupWritebackFailed(
	context.Context,
	uuid.UUID,
	*int,
	string,
	time.Time,
	bool,
) error {
	return nil
}

func (f *fakeWritebackStore) MarkLookupWritebackConflict(
	_ context.Context,
	id uuid.UUID,
	_ string,
) error {
	f.conflict = append(f.conflict, id)
	return nil
}

func (f *fakeWritebackStore) MarkLookupWritebackRejected(
	_ context.Context,
	id uuid.UUID,
	_ *int,
	_ string,
) error {
	f.rejected = append(f.rejected, id)
	return nil
}

func (f *fakeWritebackStore) ListLookupWritebacksPage(
	context.Context,
	domain.Page,
) (domain.Paged[domain.LookupWriteback], error) {
	return domain.Paged[domain.LookupWriteback]{}, nil
}

// fakeCorrector stands in for the record service that applies a correction.
type fakeCorrector struct {
	applied   bool
	err       error
	gotRecord uuid.UUID
	gotValues map[string]any
	gotSource string
	gotAt     time.Time
}

func (f *fakeCorrector) ApplyExternalValues(
	_ context.Context,
	recordID uuid.UUID,
	corrections map[string]any,
	source string,
	expectedUpdatedAt time.Time,
) (bool, error) {
	f.gotRecord = recordID
	f.gotValues = corrections
	f.gotSource = source
	f.gotAt = expectedUpdatedAt
	return f.applied, f.err
}

// writeBackSources are two sources of one definition: one that is written back to and one
// that is read-only.
func writeBackSources() []domain.LookupSource {
	return []domain.LookupSource{
		{
			ObjectKey:   "don_mua_hang",
			FieldKey:    "supplier",
			URL:         "https://erp.example.com/suppliers",
			WriteURL:    "https://erp.example.com/suppliers/write-back",
			WriteFields: []string{"supplier", "amount"},
		},
		{
			ObjectKey: "don_mua_hang",
			FieldKey:  "currency",
			URL:       "https://erp.example.com/currencies",
		},
	}
}

// A record that is created owes a write-back to every source that has one, and to nobody
// else (ADR 0037).
func TestLookupWritebacksForQueuesOneDeliveryPerSource(t *testing.T) {
	t.Parallel()

	record := domain.ObjectRecord{
		ID:            uuid.New(),
		ObjectKey:     "don_mua_hang",
		ObjectVersion: 3,
	}
	values := map[string]any{"supplier": "sup-01", "amount": 1500.0}

	writebacks := lookupWritebacksFor(
		writeBackSources(), record, values, nil, domain.RecordCreated,
		domain.Principal{UserID: uuid.New(), Name: "Lan"}, time.Now())

	if len(writebacks) != 1 {
		t.Fatalf("one source is written back to, so one delivery is owed, got %d", len(writebacks))
	}
	writeback := writebacks[0]
	if writeback.FieldKey != "supplier" {
		t.Fatalf("the delivery must name the lookup field, got %q", writeback.FieldKey)
	}
	if writeback.RecordID != record.ID {
		t.Fatal("the delivery must name the record it belongs to")
	}
	if writeback.WriteURL != "https://erp.example.com/suppliers/write-back" {
		t.Fatalf("the delivery must go to the source's write address, got %q", writeback.WriteURL)
	}

	var payload lookupWritebackPayload
	if err := json.Unmarshal(writeback.Payload, &payload); err != nil {
		t.Fatalf("the payload must be a JSON document: %v", err)
	}
	if payload.Action != domain.RecordCreated {
		t.Fatalf("the payload must say the record was created, got %q", payload.Action)
	}
	if payload.Field != "supplier" {
		t.Fatalf("the payload must name the field, got %q", payload.Field)
	}
	if payload.Record.ID != record.ID {
		t.Fatal("the payload must carry the record")
	}
	if payload.Object.Key != "don_mua_hang" || payload.Object.Version != 3 {
		t.Fatalf("the payload must carry the definition and its version, got %+v", payload.Object)
	}
	if payload.Actor.Name != "Lan" {
		t.Fatalf("the payload must name the person who changed the record, got %q", payload.Actor.Name)
	}
	if payload.Values["supplier"] != "sup-01" {
		t.Fatalf("the payload must carry the sent fields, got %+v", payload.Values)
	}
	if _, sent := payload.Values["currency"]; sent {
		t.Fatal("the payload must carry only the fields that are sent")
	}
}

// A record that is changed owes a write-back only when a field that is sent changed.
func TestLookupWritebacksForSkipsAChangeThatDoesNotTouchASentField(t *testing.T) {
	t.Parallel()

	record := domain.ObjectRecord{ID: uuid.New(), ObjectKey: "don_mua_hang", ObjectVersion: 1}
	previous := map[string]any{"supplier": "sup-01", "amount": 1500.0, "note": "cũ"}
	values := map[string]any{"supplier": "sup-01", "amount": 1500.0, "note": "mới"}

	writebacks := lookupWritebacksFor(
		writeBackSources(), record, values, previous, domain.RecordUpdated,
		domain.Principal{}, time.Now())

	if len(writebacks) != 0 {
		t.Fatalf("no sent field changed, so nothing is owed, got %d deliveries", len(writebacks))
	}
}

// A change to a field that is sent is told to the system.
func TestLookupWritebacksForSendsTheChangeOfASentField(t *testing.T) {
	t.Parallel()

	record := domain.ObjectRecord{ID: uuid.New(), ObjectKey: "don_mua_hang", ObjectVersion: 1}
	previous := map[string]any{"supplier": "sup-01", "amount": 1500.0}
	values := map[string]any{"supplier": "sup-02", "amount": 1500.0}

	writebacks := lookupWritebacksFor(
		writeBackSources(), record, values, previous, domain.RecordUpdated,
		domain.Principal{}, time.Now())

	if len(writebacks) != 1 {
		t.Fatalf("a sent field changed, so one delivery is owed, got %d", len(writebacks))
	}
	var payload lookupWritebackPayload
	if err := json.Unmarshal(writebacks[0].Payload, &payload); err != nil {
		t.Fatalf("the payload must be a JSON document: %v", err)
	}
	if payload.Action != domain.RecordUpdated {
		t.Fatalf("the payload must say the record was changed, got %q", payload.Action)
	}
	if payload.Values["supplier"] != "sup-02" {
		t.Fatalf("the payload must carry the new value, got %+v", payload.Values)
	}
}

// A correction may only touch the fields that were sent; anything else is a conflict and
// nothing is written (ADR 0037).
func TestApplyCorrectionsRefusesAFieldThatWasNotSent(t *testing.T) {
	t.Parallel()

	store := &fakeWritebackStore{}
	corrector := &fakeCorrector{applied: true}
	writebacks := NewLookupWritebacks(store, corrector, LookupWritebackConfig{}, slog.Default())

	_, err := writebacks.applyCorrections(context.Background(), domain.LookupWriteback{
		ID:          uuid.New(),
		RecordID:    uuid.New(),
		WriteFields: []string{"supplier"},
	}, map[string]any{"secret": "x"})

	if err == nil {
		t.Fatal("a correction of a field that was not sent must be refused")
	}
	var invalid *ValidationError
	if !asValidationError(err, &invalid) {
		t.Fatalf("the refusal must be a validation problem, got %v", err)
	}
	if corrector.gotRecord != uuid.Nil {
		t.Fatal("nothing may be written when the correction is refused")
	}
}

// A correction is applied to the record that was queued for, and only while the record
// still stands at that version.
func TestApplyCorrectionsWritesTheRecordItWasQueuedFor(t *testing.T) {
	t.Parallel()

	store := &fakeWritebackStore{}
	corrector := &fakeCorrector{applied: true}
	writebacks := NewLookupWritebacks(store, corrector, LookupWritebackConfig{}, slog.Default())
	recordID := uuid.New()
	queuedAt := time.Now()

	applied, err := writebacks.applyCorrections(context.Background(), domain.LookupWriteback{
		ID:              uuid.New(),
		RecordID:        recordID,
		WriteFields:     []string{"supplier"},
		RecordUpdatedAt: queuedAt,
	}, map[string]any{"supplier": "sup-01"})

	if err != nil {
		t.Fatalf("the correction must be applied: %v", err)
	}
	if !applied {
		t.Fatal("the correction must be applied when the record did not change")
	}
	if corrector.gotRecord != recordID {
		t.Fatal("the correction must go to the record it was queued for")
	}
	if corrector.gotValues["supplier"] != "sup-01" {
		t.Fatalf("the correction must carry the new values, got %+v", corrector.gotValues)
	}
	if !corrector.gotAt.Equal(queuedAt) {
		t.Fatal("the correction must carry the version the record stood at")
	}
}

// A correction that cannot be applied because the record changed is a conflict, and
// nothing is written (ADR 0037).
func TestDeliverDueReportsAConflictWhenTheRecordChanged(t *testing.T) {
	t.Parallel()

	store := &fakeWritebackStore{pending: []domain.LookupWriteback{{
		ID:            uuid.New(),
		ObjectKey:     "don_mua_hang",
		FieldKey:      "supplier",
		RecordID:      uuid.New(),
		WriteURL:      "https://erp.example.com/suppliers/write-back",
		WriteFields:   []string{"supplier"},
		Payload:       []byte(`{"deliveryId":"x"}`),
		Status:        domain.LookupWritebackPending,
		NextAttemptAt: time.Now(),
	}}}
	corrector := &fakeCorrector{applied: false}
	writebacks := NewLookupWritebacks(store, corrector, LookupWritebackConfig{}, slog.Default())
	writebacks.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"accepted":true,"values":{"supplier":"sup-02"}}`)),
			Header:     http.Header{},
		}, nil
	})}

	if _, err := writebacks.DeliverDue(context.Background()); err != nil {
		t.Fatalf("the pass must not fail: %v", err)
	}
	if len(store.conflict) != 1 {
		t.Fatalf("the delivery must stand in conflict, got %d conflicts", len(store.conflict))
	}
	if len(store.delivered) != 0 {
		t.Fatal("a delivery in conflict is not a delivered one")
	}
}

// A delivery the outside system refuses on purpose is not tried again (ADR 0037).
func TestDeliverDueReportsARejectionWithoutRetrying(t *testing.T) {
	t.Parallel()

	store := &fakeWritebackStore{pending: []domain.LookupWriteback{{
		ID:            uuid.New(),
		ObjectKey:     "don_mua_hang",
		FieldKey:      "supplier",
		RecordID:      uuid.New(),
		WriteURL:      "https://erp.example.com/suppliers/write-back",
		WriteFields:   []string{"supplier"},
		Payload:       []byte(`{"deliveryId":"x"}`),
		Status:        domain.LookupWritebackPending,
		NextAttemptAt: time.Now(),
	}}}
	corrector := &fakeCorrector{applied: true}
	writebacks := NewLookupWritebacks(store, corrector, LookupWritebackConfig{}, slog.Default())
	writebacks.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"accepted":false,"reason":"not accepted"}`)),
			Header:     http.Header{},
		}, nil
	})}

	if _, err := writebacks.DeliverDue(context.Background()); err != nil {
		t.Fatalf("the pass must not fail: %v", err)
	}
	if len(store.rejected) != 1 {
		t.Fatalf("the delivery must stand rejected, got %d rejections", len(store.rejected))
	}
	if len(store.delivered) != 0 {
		t.Fatal("a refused delivery is not a delivered one")
	}
}

// The address of a write-back must be one the server is willing to call.
func TestLookupsSetRefusesAWriteBackWithoutAnAddress(t *testing.T) {
	t.Parallel()

	store := &fakeLookupStore{object: domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "supplier", Label: "Nhà cung cấp", Type: domain.FieldTypeSelect},
		},
	}}
	lookups := NewLookups(store, LookupConfig{})

	err := lookups.Set(
		context.Background(), adminPrincipal(), "don_mua_hang", "supplier",
		LookupSourceConfig{
			URL:         "https://erp.example.com/suppliers",
			WriteFields: []string{"supplier"},
		})

	if err == nil {
		t.Fatal("named fields without an address must be refused")
	}
	var invalid *ValidationError
	if !asValidationError(err, &invalid) {
		t.Fatalf("the refusal must be a validation problem, got %v", err)
	}
}

// The fields that are sent must exist, or the record would carry something the definition
// does not have.
func TestLookupsSetRefusesAFieldTheDefinitionDoesNotHave(t *testing.T) {
	t.Parallel()

	store := &fakeLookupStore{object: domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "supplier", Label: "Nhà cung cấp", Type: domain.FieldTypeSelect},
		},
	}}
	lookups := NewLookups(store, LookupConfig{})

	err := lookups.Set(
		context.Background(), adminPrincipal(), "don_mua_hang", "supplier",
		LookupSourceConfig{
			URL:         "https://erp.example.com/suppliers",
			WriteURL:    "https://erp.example.com/suppliers/write-back",
			WriteFields: []string{"amount"},
		})

	if err == nil {
		t.Fatal("a field the definition does not have must be refused")
	}
	if store.saved.ObjectKey != "" {
		t.Fatal("nothing may be stored when the configuration is refused")
	}
}

// A source that is written back to stores its address and its fields.
func TestLookupsSetStoresTheWriteBack(t *testing.T) {
	t.Parallel()

	store := &fakeLookupStore{object: domain.BusinessObject{
		Key: "don_mua_hang",
		Fields: []domain.FieldDefinition{
			{Key: "supplier", Label: "Nhà cung cấp", Type: domain.FieldTypeSelect},
			{Key: "amount", Label: "Số tiền", Type: domain.FieldTypeNumber},
		},
	}}
	lookups := NewLookups(store, LookupConfig{})

	err := lookups.Set(
		context.Background(), adminPrincipal(), "don_mua_hang", "supplier",
		LookupSourceConfig{
			URL:         "https://erp.example.com/suppliers",
			WriteURL:    "https://erp.example.com/suppliers/write-back",
			WriteFields: []string{"supplier", "amount", "supplier"},
		})
	if err != nil {
		t.Fatalf("the configuration must be stored: %v", err)
	}
	if store.saved.WriteURL != "https://erp.example.com/suppliers/write-back" {
		t.Fatalf("the write address must be stored, got %q", store.saved.WriteURL)
	}
	if len(store.saved.WriteFields) != 2 {
		t.Fatalf("each field is stored once, got %v", store.saved.WriteFields)
	}
}

// roundTripFunc turns a function into an HTTP transport, so a test can answer without a
// server.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

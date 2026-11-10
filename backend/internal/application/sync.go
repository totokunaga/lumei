package application

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Syncing the records the app keeps on the device (BR-OFF-01 to BR-OFF-05).
// See docs/architecture/offline-sync.md for the protocol and conflict rules.

const (
	// MaxPushRows is the most rows one push may carry.
	MaxPushRows = 200
	// PullLimit is the most rows one pull returns.
	PullLimit = 500
	// MaxClockSkew is how far ahead of the API's clock a change may be dated
	// (BR-OFF-05), so a device whose clock is wrong can't win every conflict.
	MaxClockSkew = 5 * time.Minute
)

// SyncTable names a synced table, as the device and the API both call it.
type SyncTable string

// The synced tables.
const (
	TableSettings      SyncTable = "settings"
	TableCategories    SyncTable = "categories"
	TablePeriods       SyncTable = "periods"
	TableIncomes       SyncTable = "incomes"
	TableFixedExpenses SyncTable = "fixed_expenses"
	TableSavingTargets SyncTable = "saving_targets"
	TableExpenses      SyncTable = "expenses"
	TableExtraIncomes  SyncTable = "extra_incomes"
)

// SyncRecord is the fields of one record, other than its sync columns. Its
// type says which table it belongs to.
type SyncRecord interface {
	// Table returns the record's table.
	Table() SyncTable
	// Validate returns an error if a field is missing or out of range.
	Validate() error
}

// SyncRow is one record, whole: its sync columns and its fields.
type SyncRow struct {
	// ID is a lower-case UUID made on the device.
	ID string
	// UpdatedAt is when the user made the change, in milliseconds since the
	// epoch by the device's clock (BR-OFF-05).
	UpdatedAt int64
	// DeletedAt is when the user deleted the record, or nil while it exists.
	DeletedAt *int64
	Record    SyncRecord
}

// StoredRow is a row as the API stores it.
type StoredRow struct {
	Row SyncRow
	// UserID is the owner.
	UserID uuid.UUID
	// ChangeSeq is the owner's change counter when the row last changed.
	ChangeSeq int64
}

// SettingsRecord is the account's settings: one row, whose ID is the user ID.
type SettingsRecord struct {
	Region            string
	Currency          string
	PeriodStartDay    int
	BigPurchaseSpread string
	SetupCompletedAt  int64
	// NextPeriodEnd is the end date of the next period a start-day change
	// chose (BR-PER-05), or nil.
	NextPeriodEnd *string
}

// CategoryRecord is a category (BR-CAT-01 to BR-CAT-03).
type CategoryRecord struct {
	Name       string
	Emoji      string
	Position   int
	ArchivedAt *int64
}

// PeriodRecord is a saving period (BR-PER-01). Dates are `YYYY-MM-DD`, both inclusive.
type PeriodRecord struct {
	StartDate string
	EndDate   string
}

// IncomeRecord is an income item of a period (BR-INC-01).
type IncomeRecord struct {
	PeriodID string
	Name     string
	Amount   int64
	Position int
}

// FixedExpenseRecord is a fixed expense item of a period (BR-INC-02).
type FixedExpenseRecord struct {
	PeriodID string
	Name     string
	Amount   int64
	Note     *string
	Position int
}

// SavingTargetRecord is the saving target of a period (BR-TGT-01).
type SavingTargetRecord struct {
	PeriodID string
	Amount   int64
}

// ExpenseRecord is an expense (BR-EXP-01 to BR-EXP-05).
type ExpenseRecord struct {
	Amount        int64
	CategoryID    string
	Date          string
	SpentAt       int64
	IsBigPurchase bool
	Description   *string
	Latitude      *float64
	Longitude     *float64
}

// ExtraIncomeRecord is money that arrives unplanned on a day (BR-INC-06).
type ExtraIncomeRecord struct {
	Amount      int64
	Date        string
	ReceivedAt  int64
	Description *string
}

// PushOutcome is what happened to a pushed row.
type PushOutcome string

const (
	// OutcomeApplied means the API now has the change.
	OutcomeApplied PushOutcome = "applied"
	// OutcomeSuperseded means the API already has a newer change, or a
	// deletion. The device's next pull brings it.
	OutcomeSuperseded PushOutcome = "superseded"
	// OutcomeRejected means the row is invalid. Code says why.
	OutcomeRejected PushOutcome = "rejected"
)

// Why a pushed row was rejected.
const (
	// RejectInvalidRow means a field is missing or out of range.
	RejectInvalidRow = "invalid_row"
	// RejectNotOwned means the ID belongs to another user's record.
	RejectNotOwned = "not_owned"
	// RejectFutureChange means the change is dated more than MaxClockSkew
	// ahead of the API's clock (BR-OFF-05).
	RejectFutureChange = "future_change"
	// RejectCurrencyChange means the row changes the account currency (BR-SET-04).
	RejectCurrencyChange = "currency_change"
)

// PushResult is the outcome of one pushed row.
type PushResult struct {
	Table   SyncTable
	ID      string
	Outcome PushOutcome
	// Code says why a rejected row was rejected; empty otherwise.
	Code string
}

// PullResult is one page of a user's changes.
type PullResult struct {
	// Rows are the changed rows, oldest change first.
	Rows []SyncRow
	// Cursor is the change number to pull after next.
	Cursor int64
	// HasMore is true when more rows are waiting after Cursor.
	HasMore bool
}

// ErrTooManyRows is returned for a push of more than MaxPushRows rows.
var ErrTooManyRows = fmt.Errorf("a push carries at most %d rows", MaxPushRows)

// errInvalidRow is returned by Validate for a row that can't be stored.
var errInvalidRow = errors.New("invalid row")

// SyncWriter writes a user's records inside one push's transaction.
type SyncWriter interface {
	// Find returns the stored row of a table with the ID, whoever owns it, or
	// ErrNotFound.
	Find(ctx context.Context, table SyncTable, id string) (StoredRow, error)
	// Save stores the row as the user's next change, replacing any stored
	// version.
	Save(ctx context.Context, row SyncRow) error
	// CategoryNameTaken reports whether another of the user's categories than
	// the one with exceptID, archived or not but not deleted, has the name,
	// ignoring case and surrounding spaces (BR-CAT-04).
	CategoryNameTaken(ctx context.Context, name string, exceptID string) (bool, error)
}

// SyncRepository stores the users' synced records.
type SyncRepository interface {
	// Apply runs fn in one transaction that holds the user's change counter,
	// so concurrent pushes of one user are applied one after the other. A
	// non-nil error from fn rolls back every write.
	Apply(ctx context.Context, userID uuid.UUID, fn func(ctx context.Context, w SyncWriter) error) error
	// Changes returns up to limit of the user's rows changed after since,
	// oldest change first.
	Changes(ctx context.Context, userID uuid.UUID, since int64, limit int) ([]StoredRow, error)
}

// Syncer stores the device's changes and returns other devices' changes.
type Syncer interface {
	// Push stores the signed-in user's rows that win their conflicts and
	// returns each row's outcome, in order.
	Push(ctx context.Context, rows []SyncRow) ([]PushResult, error)
	// Pull returns the signed-in user's changes after since.
	Pull(ctx context.Context, since int64) (PullResult, error)
}

var _ Syncer = (*SyncUsecase)(nil)

// SyncUsecase implements Syncer.
type SyncUsecase struct {
	records SyncRepository
	now     func() time.Time
}

// NewSyncer creates a SyncUsecase. now is the API's clock.
func NewSyncer(records SyncRepository, now func() time.Time) *SyncUsecase {
	return &SyncUsecase{records: records, now: now}
}

// Push applies the rows in one transaction, so a failure stores none of them
// and the device pushes them all again (BR-OFF-03).
func (u *SyncUsecase) Push(ctx context.Context, rows []SyncRow) ([]PushResult, error) {
	principal, ok := PrincipalFrom(ctx)
	if !ok {
		return nil, ErrUnauthenticated
	}
	if len(rows) > MaxPushRows {
		return nil, ErrTooManyRows
	}

	latest := u.now().Add(MaxClockSkew).UnixMilli()
	results := make([]PushResult, len(rows))
	err := u.records.Apply(ctx, principal.User.ID, func(ctx context.Context, w SyncWriter) error {
		for i, row := range rows {
			outcome, code, err := u.apply(ctx, w, principal.User.ID, row, latest)
			if err != nil {
				return err
			}
			results[i] = PushResult{Table: row.Record.Table(), ID: row.ID, Outcome: outcome, Code: code}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to apply the pushed rows: %w", err)
	}
	return results, nil
}

// apply validates one row, then stores it if it wins its conflict.
func (*SyncUsecase) apply(
	ctx context.Context,
	w SyncWriter,
	userID uuid.UUID,
	row SyncRow,
	latest int64,
) (PushOutcome, string, error) {

	if code := check(row, userID, latest); code != "" {
		return OutcomeRejected, code, nil
	}

	stored, err := w.Find(ctx, row.Record.Table(), row.ID)
	switch {
	case errors.Is(err, ErrNotFound):
		// A new record.
	case err != nil:
		return "", "", fmt.Errorf("failed to find %s %s: %w", row.Record.Table(), row.ID, err)
	case stored.UserID != userID:
		return OutcomeRejected, RejectNotOwned, nil
	case changesCurrency(stored.Row, row):
		return OutcomeRejected, RejectCurrencyChange, nil
	case !Wins(row, stored.Row):
		return OutcomeSuperseded, "", nil
	}

	row, err = uniqueCategoryName(ctx, w, row)
	if err != nil {
		return "", "", err
	}
	if err := w.Save(ctx, row); err != nil {
		return "", "", fmt.Errorf("failed to save %s %s: %w", row.Record.Table(), row.ID, err)
	}
	return OutcomeApplied, "", nil
}

// numberedName matches a name that already ends in a number, e.g. "Coffee (2)".
var numberedName = regexp.MustCompile(`^(.*\S) \((\d+)\)$`)

// maxNameNumber is the highest number uniqueCategoryName tries before giving up.
const maxNameNumber = 1000

// uniqueCategoryName gives a category the next free number in its name when
// another of the user's categories already has the name, e.g. "Coffee (2)",
// so the one that syncs later is renamed (BR-CAT-04). A name that already
// ends in a number counts on from it: a clashing "Coffee (2)" becomes
// "Coffee (3)". Other rows, and deletions, are returned unchanged.
func uniqueCategoryName(ctx context.Context, w SyncWriter, row SyncRow) (SyncRow, error) {
	category, ok := row.Record.(CategoryRecord)
	if !ok || row.DeletedAt != nil {
		return row, nil
	}
	name := strings.TrimSpace(category.Name)
	base, next := name, 2
	if m := numberedName.FindStringSubmatch(name); m != nil {
		if n, err := strconv.Atoi(m[2]); err == nil && n < maxNameNumber {
			base, next = m[1], n+1
		}
	}
	for candidate := name; next <= maxNameNumber; next++ {
		taken, err := w.CategoryNameTaken(ctx, candidate, row.ID)
		if err != nil {
			// The name stays out of the error, which is logged (BR-NFR-02).
			return SyncRow{}, fmt.Errorf("failed to check a category name: %w", err)
		}
		if !taken {
			category.Name = candidate
			row.Record = category
			return row, nil
		}
		candidate = fmt.Sprintf("%s (%d)", base, next)
	}
	return SyncRow{}, fmt.Errorf("no free number for the name of category %s", row.ID)
}

// Pull returns up to PullLimit of the user's changes after since.
func (u *SyncUsecase) Pull(ctx context.Context, since int64) (PullResult, error) {
	principal, ok := PrincipalFrom(ctx)
	if !ok {
		return PullResult{}, ErrUnauthenticated
	}

	// One more than the limit says whether more are waiting.
	stored, err := u.records.Changes(ctx, principal.User.ID, since, PullLimit+1)
	if err != nil {
		return PullResult{}, fmt.Errorf("failed to read the changes: %w", err)
	}
	result := PullResult{Rows: make([]SyncRow, 0, min(len(stored), PullLimit)), Cursor: since}
	if len(stored) > PullLimit {
		stored, result.HasMore = stored[:PullLimit], true
	}
	for _, s := range stored {
		result.Rows = append(result.Rows, s.Row)
		result.Cursor = s.ChangeSeq
	}
	return result, nil
}

// Wins reports whether an incoming change replaces the stored version of a
// row, by the conflict rules every device applies too (BR-OFF-05):
//  1. A deletion wins over any edit, and a deleted row never changes back.
//  2. Otherwise the change with the later UpdatedAt wins.
//  3. On a tie, the stored version stays, so pushing again changes nothing.
func Wins(incoming, stored SyncRow) bool {
	if stored.DeletedAt != nil {
		return false
	}
	if incoming.DeletedAt != nil {
		return true
	}
	return incoming.UpdatedAt > stored.UpdatedAt
}

// check returns why a row must be rejected before it reaches the conflict
// rules, or "" if it may be stored.
func check(row SyncRow, userID uuid.UUID, latest int64) string {
	if !isID(row.ID) || row.UpdatedAt <= 0 || (row.DeletedAt != nil && *row.DeletedAt <= 0) {
		return RejectInvalidRow
	}
	if row.Record.Validate() != nil {
		return RejectInvalidRow
	}
	// The settings row's ID is its owner's ID.
	if row.Record.Table() == TableSettings && row.ID != userID.String() {
		return RejectNotOwned
	}
	if row.UpdatedAt > latest || (row.DeletedAt != nil && *row.DeletedAt > latest) {
		return RejectFutureChange
	}
	return ""
}

// changesCurrency reports whether a settings row changes the stored account
// currency, which can't change (BR-SET-04).
func changesCurrency(stored, incoming SyncRow) bool {
	before, ok := stored.Record.(SettingsRecord)
	if !ok {
		return false
	}
	after, ok := incoming.Record.(SettingsRecord)
	return ok && after.Currency != before.Currency
}

// Table implements SyncRecord.
func (SettingsRecord) Table() SyncTable { return TableSettings }

// Validate implements SyncRecord.
func (r SettingsRecord) Validate() error {
	return valid(r.Region != "" &&
		isCurrencyCode(r.Currency) &&
		r.PeriodStartDay >= 1 && r.PeriodStartDay <= 31 &&
		(r.BigPurchaseSpread == "daysLeft" || r.BigPurchaseSpread == "wholePeriod") &&
		r.SetupCompletedAt > 0 &&
		(r.NextPeriodEnd == nil || isDate(*r.NextPeriodEnd)))
}

// Table implements SyncRecord.
func (CategoryRecord) Table() SyncTable { return TableCategories }

// Validate implements SyncRecord.
func (r CategoryRecord) Validate() error {
	return valid(strings.TrimSpace(r.Name) != "" &&
		r.Emoji != "" &&
		r.Position >= 0 &&
		(r.ArchivedAt == nil || *r.ArchivedAt > 0))
}

// Table implements SyncRecord.
func (PeriodRecord) Table() SyncTable { return TablePeriods }

// Validate implements SyncRecord.
func (r PeriodRecord) Validate() error {
	return valid(isDate(r.StartDate) && isDate(r.EndDate) && r.EndDate >= r.StartDate)
}

// Table implements SyncRecord.
func (IncomeRecord) Table() SyncTable { return TableIncomes }

// Validate implements SyncRecord.
func (r IncomeRecord) Validate() error {
	return valid(isID(r.PeriodID) && strings.TrimSpace(r.Name) != "" && r.Amount >= 0 && r.Position >= 0)
}

// Table implements SyncRecord.
func (FixedExpenseRecord) Table() SyncTable { return TableFixedExpenses }

// Validate implements SyncRecord.
func (r FixedExpenseRecord) Validate() error {
	return valid(isID(r.PeriodID) && strings.TrimSpace(r.Name) != "" && r.Amount >= 0 && r.Position >= 0)
}

// Table implements SyncRecord.
func (SavingTargetRecord) Table() SyncTable { return TableSavingTargets }

// Validate implements SyncRecord.
func (r SavingTargetRecord) Validate() error {
	return valid(isID(r.PeriodID) && r.Amount >= 0)
}

// Table implements SyncRecord.
func (ExpenseRecord) Table() SyncTable { return TableExpenses }

// Validate implements SyncRecord.
func (r ExpenseRecord) Validate() error {
	// A location has both coordinates or neither (BR-EXP-04).
	located := r.Latitude != nil && r.Longitude != nil &&
		*r.Latitude >= -90 && *r.Latitude <= 90 &&
		*r.Longitude >= -180 && *r.Longitude <= 180
	unlocated := r.Latitude == nil && r.Longitude == nil
	return valid(r.Amount > 0 && // BR-EXP-08
		isID(r.CategoryID) &&
		isDate(r.Date) &&
		r.SpentAt > 0 &&
		(located || unlocated))
}

// Table implements SyncRecord.
func (ExtraIncomeRecord) Table() SyncTable { return TableExtraIncomes }

// Validate implements SyncRecord.
func (r ExtraIncomeRecord) Validate() error {
	return valid(r.Amount > 0 && isDate(r.Date) && r.ReceivedAt > 0) // BR-EXP-08
}

// valid returns errInvalidRow unless ok.
func valid(ok bool) error {
	if !ok {
		return errInvalidRow
	}
	return nil
}

// isID reports whether s is a UUID in lower-case canonical form, the form
// PostgreSQL returns it in, so a pulled ID always matches the pushed one.
func isID(s string) bool {
	id, err := uuid.Parse(s)
	return err == nil && id.String() == s
}

// isDate reports whether s is a real calendar date as `YYYY-MM-DD`.
func isDate(s string) bool {
	d, err := time.Parse(time.DateOnly, s)
	return err == nil && d.Format(time.DateOnly) == s
}

// isCurrencyCode reports whether s looks like an ISO 4217 code, e.g. `JPY`.
func isCurrencyCode(s string) bool {
	if len(s) != 3 {
		return false
	}
	for _, c := range s {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

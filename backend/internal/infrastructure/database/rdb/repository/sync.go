package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

var (
	_ application.SyncRepository = (*SyncRepository)(nil)
	_ application.SyncWriter     = (*syncWriter)(nil)
)

// syncBase is the sync columns every synced table has.
type syncBase struct {
	ID        string    `bun:"id,pk"`
	UserID    uuid.UUID `bun:"user_id"`
	UpdatedAt int64     `bun:"updated_at"`
	DeletedAt *int64    `bun:"deleted_at"`
	ChangeSeq int64     `bun:"change_seq"`
}

// base returns the sync columns, so every table model gets it by embedding.
func (b *syncBase) base() *syncBase { return b }

// syncModel is a row of a synced table.
type syncModel interface {
	base() *syncBase
	// record returns the row's fields other than the sync columns.
	record() application.SyncRecord
}

type settingsModel struct {
	bun.BaseModel `bun:"table:settings"`
	syncBase

	Region            string `bun:"region"`
	Currency          string `bun:"currency"`
	PeriodStartDay    int    `bun:"period_start_day"`
	BigPurchaseSpread string `bun:"big_purchase_spread"`
	SetupCompletedAt  int64  `bun:"setup_completed_at"`
	// NextPeriodEnd is a date column, or null.
	NextPeriodEnd *time.Time `bun:"next_period_end,type:date"`
}

func (m *settingsModel) record() application.SyncRecord {
	return application.SettingsRecord{
		Region:            m.Region,
		Currency:          m.Currency,
		PeriodStartDay:    m.PeriodStartDay,
		BigPurchaseSpread: m.BigPurchaseSpread,
		SetupCompletedAt:  m.SetupCompletedAt,
		NextPeriodEnd:     formatOptionalDate(m.NextPeriodEnd),
	}
}

type categoryModel struct {
	bun.BaseModel `bun:"table:categories"`
	syncBase

	Name       string `bun:"name"`
	Emoji      string `bun:"emoji"`
	Position   int    `bun:"position"`
	ArchivedAt *int64 `bun:"archived_at"`
}

func (m *categoryModel) record() application.SyncRecord {
	return application.CategoryRecord{
		Name: m.Name, Emoji: m.Emoji, Position: m.Position, ArchivedAt: m.ArchivedAt,
	}
}

type periodModel struct {
	bun.BaseModel `bun:"table:periods"`
	syncBase

	StartDate time.Time `bun:"start_date,type:date"`
	EndDate   time.Time `bun:"end_date,type:date"`
}

func (m *periodModel) record() application.SyncRecord {
	return application.PeriodRecord{StartDate: formatDate(m.StartDate), EndDate: formatDate(m.EndDate)}
}

type incomeModel struct {
	bun.BaseModel `bun:"table:incomes"`
	syncBase

	PeriodID string `bun:"period_id"`
	Name     string `bun:"name"`
	Amount   int64  `bun:"amount"`
	Position int    `bun:"position"`
}

func (m *incomeModel) record() application.SyncRecord {
	return application.IncomeRecord{
		PeriodID: m.PeriodID, Name: m.Name, Amount: m.Amount, Position: m.Position,
	}
}

type fixedExpenseModel struct {
	bun.BaseModel `bun:"table:fixed_expenses"`
	syncBase

	PeriodID string  `bun:"period_id"`
	Name     string  `bun:"name"`
	Amount   int64   `bun:"amount"`
	Note     *string `bun:"note"`
	Position int     `bun:"position"`
}

func (m *fixedExpenseModel) record() application.SyncRecord {
	return application.FixedExpenseRecord{
		PeriodID: m.PeriodID, Name: m.Name, Amount: m.Amount, Note: m.Note, Position: m.Position,
	}
}

type savingTargetModel struct {
	bun.BaseModel `bun:"table:saving_targets"`
	syncBase

	PeriodID string `bun:"period_id"`
	Amount   int64  `bun:"amount"`
}

func (m *savingTargetModel) record() application.SyncRecord {
	return application.SavingTargetRecord{PeriodID: m.PeriodID, Amount: m.Amount}
}

type expenseModel struct {
	bun.BaseModel `bun:"table:expenses"`
	syncBase

	Amount        int64     `bun:"amount"`
	CategoryID    string    `bun:"category_id"`
	Date          time.Time `bun:"date,type:date"`
	SpentAt       int64     `bun:"spent_at"`
	IsBigPurchase bool      `bun:"is_big_purchase"`
	Description   *string   `bun:"description"`
	Latitude      *float64  `bun:"latitude"`
	Longitude     *float64  `bun:"longitude"`
}

func (m *expenseModel) record() application.SyncRecord {
	return application.ExpenseRecord{
		Amount:        m.Amount,
		CategoryID:    m.CategoryID,
		Date:          formatDate(m.Date),
		SpentAt:       m.SpentAt,
		IsBigPurchase: m.IsBigPurchase,
		Description:   m.Description,
		Latitude:      m.Latitude,
		Longitude:     m.Longitude,
	}
}

// emptyModel returns a model of the table to scan a row into.
func emptyModel(table application.SyncTable) (syncModel, error) {
	switch table {
	case application.TableSettings:
		return &settingsModel{}, nil
	case application.TableCategories:
		return &categoryModel{}, nil
	case application.TablePeriods:
		return &periodModel{}, nil
	case application.TableIncomes:
		return &incomeModel{}, nil
	case application.TableFixedExpenses:
		return &fixedExpenseModel{}, nil
	case application.TableSavingTargets:
		return &savingTargetModel{}, nil
	case application.TableExpenses:
		return &expenseModel{}, nil
	}
	return nil, fmt.Errorf("unknown table %q", table)
}

// toModel converts a row to its table's model, owned by userID at change seq.
func toModel(row application.SyncRow, userID uuid.UUID, seq int64) (syncModel, error) {
	base := syncBase{
		ID: row.ID, UserID: userID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt, ChangeSeq: seq,
	}
	switch r := row.Record.(type) {
	case application.SettingsRecord:
		nextEnd, err := parseOptionalDate(r.NextPeriodEnd)
		if err != nil {
			return nil, err
		}
		return &settingsModel{
			syncBase: base, Region: r.Region, Currency: r.Currency, PeriodStartDay: r.PeriodStartDay,
			BigPurchaseSpread: r.BigPurchaseSpread, SetupCompletedAt: r.SetupCompletedAt,
			NextPeriodEnd: nextEnd,
		}, nil
	case application.CategoryRecord:
		return &categoryModel{
			syncBase: base, Name: r.Name, Emoji: r.Emoji, Position: r.Position, ArchivedAt: r.ArchivedAt,
		}, nil
	case application.PeriodRecord:
		start, err := parseDate(r.StartDate)
		if err != nil {
			return nil, err
		}
		end, err := parseDate(r.EndDate)
		if err != nil {
			return nil, err
		}
		return &periodModel{syncBase: base, StartDate: start, EndDate: end}, nil
	case application.IncomeRecord:
		return &incomeModel{
			syncBase: base, PeriodID: r.PeriodID, Name: r.Name, Amount: r.Amount, Position: r.Position,
		}, nil
	case application.FixedExpenseRecord:
		return &fixedExpenseModel{
			syncBase: base, PeriodID: r.PeriodID, Name: r.Name, Amount: r.Amount, Note: r.Note,
			Position: r.Position,
		}, nil
	case application.SavingTargetRecord:
		return &savingTargetModel{syncBase: base, PeriodID: r.PeriodID, Amount: r.Amount}, nil
	case application.ExpenseRecord:
		date, err := parseDate(r.Date)
		if err != nil {
			return nil, err
		}
		return &expenseModel{
			syncBase: base, Amount: r.Amount, CategoryID: r.CategoryID, Date: date, SpentAt: r.SpentAt,
			IsBigPurchase: r.IsBigPurchase, Description: r.Description,
			Latitude: r.Latitude, Longitude: r.Longitude,
		}, nil
	}
	return nil, fmt.Errorf("unknown record type %T", row.Record)
}

// toStored converts a scanned model to the row it stores.
func toStored(m syncModel) application.StoredRow {
	b := m.base()
	return application.StoredRow{
		Row: application.SyncRow{
			ID: b.ID, UpdatedAt: b.UpdatedAt, DeletedAt: b.DeletedAt, Record: m.record(),
		},
		UserID:    b.UserID,
		ChangeSeq: b.ChangeSeq,
	}
}

// SyncRepository implements application.SyncRepository on PostgreSQL.
type SyncRepository struct {
	db bun.IDB
}

// NewSyncRepository creates a SyncRepository.
func NewSyncRepository(db bun.IDB) *SyncRepository {
	return &SyncRepository{db: db}
}

// Apply locks the user's row in sync_state, creating it on the first push,
// runs fn, and stores the counter fn advanced, all in one transaction.
func (r *SyncRepository) Apply(
	ctx context.Context,
	userID uuid.UUID,
	fn func(ctx context.Context, w application.SyncWriter) error,
) error {

	err := r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.NewRaw(
			"INSERT INTO sync_state (user_id) VALUES (?) ON CONFLICT DO NOTHING", userID,
		).Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to create the change counter: %w", err)
		}
		var seq int64
		err = tx.NewRaw(
			"SELECT change_seq FROM sync_state WHERE user_id = ? FOR UPDATE", userID,
		).Scan(ctx, &seq)
		if err != nil {
			return fmt.Errorf("failed to lock the change counter: %w", err)
		}

		w := &syncWriter{tx: tx, userID: userID, seq: seq}
		if err := fn(ctx, w); err != nil {
			return err
		}
		if w.seq == seq {
			return nil
		}
		_, err = tx.NewRaw("UPDATE sync_state SET change_seq = ? WHERE user_id = ?", w.seq, userID).Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to advance the change counter: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("failed to apply the changes: %w", err)
	}
	return nil
}

// Changes reads up to limit changed rows from each table and merges them.
// The change numbers are unique per user across tables, so the first limit
// rows of the merge are exactly the user's next limit changes.
func (r *SyncRepository) Changes(
	ctx context.Context,
	userID uuid.UUID,
	since int64,
	limit int,
) ([]application.StoredRow, error) {

	readers := []func() ([]application.StoredRow, error){
		func() ([]application.StoredRow, error) {
			return changesOf[settingsModel](ctx, r.db, userID, since, limit)
		},
		func() ([]application.StoredRow, error) {
			return changesOf[categoryModel](ctx, r.db, userID, since, limit)
		},
		func() ([]application.StoredRow, error) {
			return changesOf[periodModel](ctx, r.db, userID, since, limit)
		},
		func() ([]application.StoredRow, error) {
			return changesOf[incomeModel](ctx, r.db, userID, since, limit)
		},
		func() ([]application.StoredRow, error) {
			return changesOf[fixedExpenseModel](ctx, r.db, userID, since, limit)
		},
		func() ([]application.StoredRow, error) {
			return changesOf[savingTargetModel](ctx, r.db, userID, since, limit)
		},
		func() ([]application.StoredRow, error) {
			return changesOf[expenseModel](ctx, r.db, userID, since, limit)
		},
	}
	var rows []application.StoredRow
	for _, read := range readers {
		got, err := read()
		if err != nil {
			return nil, err
		}
		rows = append(rows, got...)
	}
	slices.SortFunc(rows, func(a, b application.StoredRow) int { return int(a.ChangeSeq - b.ChangeSeq) })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

// changesOf reads up to limit of the user's rows of one table changed after
// since, oldest change first.
func changesOf[T any, P interface {
	*T
	syncModel
}](
	ctx context.Context,
	db bun.IDB,
	userID uuid.UUID,
	since int64,
	limit int,
) ([]application.StoredRow, error) {

	var models []T
	err := db.NewSelect().
		Model(&models).
		Where("user_id = ?", userID).
		Where("change_seq > ?", since).
		Order("change_seq").
		Limit(limit).
		Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to select the changes: %w", err)
	}
	rows := make([]application.StoredRow, 0, len(models))
	for i := range models {
		rows = append(rows, toStored(P(&models[i])))
	}
	return rows, nil
}

// syncWriter writes inside Apply's transaction, numbering each saved row
// with the user's next change.
type syncWriter struct {
	tx     bun.Tx
	userID uuid.UUID
	// seq is the user's last change number, advanced by every Save.
	seq int64
}

// Find returns the stored row of the table with the ID, or ErrNotFound.
func (w *syncWriter) Find(
	ctx context.Context,
	table application.SyncTable,
	id string,
) (application.StoredRow, error) {

	m, err := emptyModel(table)
	if err != nil {
		return application.StoredRow{}, err
	}
	err = w.tx.NewSelect().Model(m).Where("id = ?", id).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return application.StoredRow{}, fmt.Errorf("no %s %s: %w", table, id, application.ErrNotFound)
	}
	if err != nil {
		return application.StoredRow{}, fmt.Errorf("failed to select %s %s: %w", table, id, err)
	}
	return toStored(m), nil
}

// Save inserts the row, or replaces the user's stored version. It never
// replaces another user's row: that would affect no row and fail with
// ErrConflict.
func (w *syncWriter) Save(ctx context.Context, row application.SyncRow) error {
	m, err := toModel(row, w.userID, w.seq+1)
	if err != nil {
		return err
	}
	res, err := w.tx.NewInsert().
		Model(m).
		On("CONFLICT (id) DO UPDATE").
		Where("?TableAlias.user_id = EXCLUDED.user_id").
		// Nothing to read back: the row is stored as sent.
		Returning("NULL").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to upsert %s %s: %w", row.Record.Table(), row.ID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to count the upserted rows: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("%s %s belongs to another user: %w",
			row.Record.Table(), row.ID, application.ErrConflict)
	}
	w.seq++
	return nil
}

// parseDate parses a `YYYY-MM-DD` date.
func parseDate(s string) (time.Time, error) {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid date %q: %w", s, err)
	}
	return d, nil
}

// formatDate formats a date as `YYYY-MM-DD`.
func formatDate(d time.Time) string {
	return d.Format(time.DateOnly)
}

// parseOptionalDate parses a `YYYY-MM-DD` date, or returns nil for nil.
func parseOptionalDate(s *string) (*time.Time, error) {
	if s == nil {
		return nil, nil //nolint:nilnil // no date is not an error
	}
	d, err := parseDate(*s)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// formatOptionalDate formats a date as `YYYY-MM-DD`, or returns nil for nil.
func formatOptionalDate(d *time.Time) *string {
	if d == nil {
		return nil
	}
	s := formatDate(*d)
	return &s
}

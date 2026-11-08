// Package main is a development tool that fills a user's current period with
// random expenses, for trying the app out on a simulator.
//
// For each day of the current period from its start until yesterday that has
// no expenses yet, it adds one to three expenses with random active
// categories, amounts, and times. It keeps spending so far at or under the
// spending limit (BR-CALC-06) on every day up to today, counting the
// expenses already there. The rows are written the way a push writes them,
// with the user's next change numbers, so the app pulls them on its next sync.
//
// Usage, from backend/ with the dev stack running (make up-d):
//
//	make seed-expenses EMAIL=you@example.com [ARGS="-dry-run -seed 42"]
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"math/rand/v2"
	"os"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
)

// localHosts are the database hosts the tool writes to: only a database on
// this machine, so it never touches a shared environment.
var localHosts = []string{"localhost", "127.0.0.1", "::1"}

const dateLayout = "2006-01-02"

func main() {
	os.Exit(run())
}

func run() int {
	email := flag.String("email", "", "the user's email address (required)")
	dryRun := flag.Bool("dry-run", false, "print the expenses without saving them")
	seed := flag.Uint64("seed", 0, "random seed, for repeatable expenses (default: random)")
	flag.Parse()
	if *email == "" {
		fmt.Fprintln(os.Stderr, "✘ -email is required")
		flag.Usage()
		return 2
	}

	cfg, err := config.LoadMigrate()
	if err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to load configuration:", err)
		return 1
	}
	if !slices.Contains(localHosts, cfg.RDB.Host) {
		fmt.Fprintf(os.Stderr,
			"✘ Refusing to write to %q: this tool only writes to a local database\n", cfg.RDB.Host)
		return 1
	}

	ctx := context.Background()
	connector := rdb.NewConnector(driver.NewPostgresDriver(cfg.RDB), cfg.RDB)
	if err := connector.Open(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "✘ Failed to open database connection:", err)
		return 1
	}
	defer func() { _ = connector.Close() }()

	random := rand.New(rand.NewPCG(*seed, *seed)) //nolint:gosec // test data, not security
	if *seed == 0 {
		random = rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())) //nolint:gosec // test data, not security
	}

	n, err := seedExpenses(ctx, connector.DB(), *email, time.Now(), random, *dryRun)
	if err != nil {
		fmt.Fprintln(os.Stderr, "✘", err)
		return 1
	}
	if *dryRun {
		fmt.Printf("✔ Would add %d expenses (dry run, nothing saved)\n", n)
	} else {
		fmt.Printf("✔ Added %d expenses. Bring the app to the foreground to sync them.\n", n)
	}
	return 0
}

// period is the user's current period.
type period struct {
	id         uuid.UUID
	start, end time.Time
}

// expense is one generated expense row.
type expense struct {
	id         uuid.UUID
	amount     int64
	categoryID uuid.UUID
	category   string
	date       time.Time
	spentAt    time.Time
}

// seedExpenses adds the expenses in one transaction, holding the user's
// sync_state row as a push does, and returns how many it added.
func seedExpenses(
	ctx context.Context, db *bun.DB, email string, now time.Time, random *rand.Rand, dryRun bool,
) (int, error) {

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var userID uuid.UUID
	err = tx.QueryRowContext(ctx, "SELECT id FROM users WHERE email = ?", email).Scan(&userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("no user with the email %q", email)
		}
		return 0, fmt.Errorf("failed to find the user: %w", err)
	}

	var currency string
	err = tx.QueryRowContext(ctx,
		"SELECT currency FROM settings WHERE user_id = ? AND deleted_at IS NULL", userID,
	).Scan(&currency)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("the user hasn't finished setup, or it hasn't synced yet")
		}
		return 0, fmt.Errorf("failed to read the settings: %w", err)
	}

	// Today in this machine's time zone, which the simulator shares.
	today := dateOf(now)
	var p period
	var start, end string
	err = tx.QueryRowContext(ctx,
		`SELECT id, start_date, end_date FROM periods
		 WHERE user_id = ? AND deleted_at IS NULL AND start_date <= ? AND end_date >= ?`,
		userID, today.Format(dateLayout), today.Format(dateLayout),
	).Scan(&p.id, &start, &end)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errors.New("no period contains today: open the app so it creates and syncs one")
		}
		return 0, fmt.Errorf("failed to find the current period: %w", err)
	}
	if p.start, err = time.Parse(dateLayout, start[:10]); err != nil {
		return 0, fmt.Errorf("failed to read the period's start: %w", err)
	}
	if p.end, err = time.Parse(dateLayout, end[:10]); err != nil {
		return 0, fmt.Errorf("failed to read the period's end: %w", err)
	}
	if !p.start.Before(today) {
		return 0, errors.New("the period starts today, so it has no past days to fill")
	}

	categories, err := activeCategories(ctx, tx, userID)
	if err != nil {
		return 0, err
	}
	b, err := readBudget(ctx, tx, userID, p)
	if err != nil {
		return 0, err
	}

	expenses := generate(p, today, b, categories, unitOf(currency), random)
	for _, e := range expenses {
		fmt.Printf("  %s %s  %-16s %10d\n",
			e.date.Format(dateLayout), e.spentAt.Format("15:04"), e.category, e.amount)
	}
	if dryRun || len(expenses) == 0 {
		return len(expenses), nil
	}

	if err := insert(ctx, tx, userID, expenses, now); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("failed to commit: %w", err)
	}
	return len(expenses), nil
}

// category is an active category to pick from.
type category struct {
	id   uuid.UUID
	name string
}

// activeCategories returns the user's categories a new expense can use (BR-CAT-02).
func activeCategories(ctx context.Context, tx bun.Tx, userID uuid.UUID) ([]category, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT id, emoji || ' ' || name FROM categories
		 WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY position`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to read the categories: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var categories []category
	for rows.Next() {
		var c category
		if err := rows.Scan(&c.id, &c.name); err != nil {
			return nil, fmt.Errorf("failed to read a category: %w", err)
		}
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read the categories: %w", err)
	}
	if len(categories) == 0 {
		return nil, errors.New("the user has no active categories")
	}
	return categories, nil
}

// budget holds what the spending limit is worked out from, per day of the
// period (index 0 is the start date).
type budget struct {
	// base is planned income − fixed expenses − saving target.
	base int64
	// extra is each day's extra income, and spent each day's expenses already saved.
	extra, spent []int64
}

// readBudget reads the period's income, fixed expenses, saving target, extra
// income, and saved expenses (BR-CALC-02).
func readBudget(ctx context.Context, tx bun.Tx, userID uuid.UUID, p period) (budget, error) {
	days := int(p.end.Sub(p.start).Hours()/24) + 1
	b := budget{extra: make([]int64, days), spent: make([]int64, days)}

	var base int64
	err := tx.QueryRowContext(ctx,
		`SELECT
		   COALESCE((SELECT SUM(amount) FROM incomes
		             WHERE user_id = ?0 AND period_id = ?1 AND deleted_at IS NULL), 0)
		 - COALESCE((SELECT SUM(amount) FROM fixed_expenses
		             WHERE user_id = ?0 AND period_id = ?1 AND deleted_at IS NULL), 0)
		 - COALESCE((SELECT SUM(amount) FROM saving_targets
		             WHERE user_id = ?0 AND period_id = ?1 AND deleted_at IS NULL), 0)`,
		userID, p.id,
	).Scan(&base)
	if err != nil {
		return budget{}, fmt.Errorf("failed to read the budget: %w", err)
	}
	b.base = base

	for _, q := range []struct {
		table string
		into  []int64
	}{{"extra_incomes", b.extra}, {"expenses", b.spent}} {
		if err := sumByDay(ctx, tx, q.table, userID, p, q.into); err != nil {
			return budget{}, err
		}
	}
	return b, nil
}

// sumByDay adds up a table's amounts by date into `into`, indexed from the period's start.
func sumByDay(ctx context.Context, tx bun.Tx, table string, userID uuid.UUID, p period, into []int64) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT date, SUM(amount) FROM ? WHERE user_id = ? AND deleted_at IS NULL
		 AND date BETWEEN ? AND ? GROUP BY date`,
		bun.Ident(table), userID, p.start.Format(dateLayout), p.end.Format(dateLayout))
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var day string
		var amount int64
		if err := rows.Scan(&day, &amount); err != nil {
			return fmt.Errorf("failed to read %s: %w", table, err)
		}
		date, err := time.Parse(dateLayout, day[:10])
		if err != nil {
			return fmt.Errorf("failed to read a date in %s: %w", table, err)
		}
		into[int(date.Sub(p.start).Hours()/24)] += amount
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to read %s: %w", table, err)
	}
	return nil
}

// generate makes the expenses for each past day without any, keeping spending
// so far at or under the limit on every day up to today (BR-CALC-06):
// `limit(d) = budget(d) × n / period days`, rounded down. Saved expenses count
// at their full amount, big purchases too, which is never less than the
// chart's spread of them.
func generate(
	p period, today time.Time, b budget, categories []category, unit int64, random *rand.Rand,
) []expense {

	days := len(b.spent)
	last := int(today.Sub(p.start).Hours() / 24) // today's index; days before it get expenses

	limit := make([]int64, days)
	var extra int64
	for i := range days {
		extra += b.extra[i]
		limit[i] = (b.base + extra) * int64(i+1) / int64(days)
	}
	cumulative := make([]int64, days)
	var sum int64
	for i := range days {
		sum += b.spent[i]
		cumulative[i] = sum
	}
	// The most a day can add: what every day from it to today has left under its limit.
	room := func(from int) int64 {
		least := int64(-1)
		for i := from; i <= last; i++ {
			if left := limit[i] - cumulative[i]; least < 0 || left < least {
				least = left
			}
		}
		return max(0, least)
	}

	daily := max(unit, (b.base/int64(days))/unit*unit)
	var expenses []expense
	for i := range last {
		if b.spent[i] > 0 {
			continue // the day already has expenses: keep them as they are
		}
		// Between 30% and 110% of an even day's share, never past the limit.
		total := min(room(i), int64(float64(daily)*(0.3+0.8*random.Float64())))
		count := 1 + random.IntN(3)
		day := p.start.AddDate(0, 0, i)
		for _, amount := range split(total, count, unit, random) {
			c := categories[random.IntN(len(categories))]
			// A time between 8:00 and 22:00 on the day, in this machine's time zone.
			minutes := 8*60 + random.IntN(14*60)
			spentAt := time.Date(
				day.Year(), day.Month(), day.Day(), 0, minutes, random.IntN(60), 0, time.Local)
			expenses = append(expenses, expense{
				id: uuid.Must(uuid.NewV7()), amount: amount, categoryID: c.id, category: c.name,
				date: day, spentAt: spentAt,
			})
		}
		for j := i; j < days; j++ {
			cumulative[j] += total
		}
	}
	slices.SortFunc(expenses, func(a, b expense) int { return a.spentAt.Compare(b.spentAt) })
	return expenses
}

// split divides a total into up to `count` random amounts, each a multiple of
// `unit` and above 0, that add up to the total rounded down to the unit.
func split(total int64, count int, unit int64, random *rand.Rand) []int64 {
	units := total / unit
	if units <= 0 {
		return nil
	}
	count = min(count, int(units))
	// Random cut points between 1 and units-1 divide the total into count parts.
	cuts := []int64{0, units}
	for len(cuts) < count+1 {
		if cut := 1 + random.Int64N(units-1); !slices.Contains(cuts, cut) {
			cuts = append(cuts, cut)
		}
	}
	slices.Sort(cuts)
	amounts := make([]int64, 0, count)
	for i := 1; i < len(cuts); i++ {
		amounts = append(amounts, (cuts[i]-cuts[i-1])*unit)
	}
	return amounts
}

// insert writes the expenses as a push would: each with the user's next change number.
func insert(ctx context.Context, tx bun.Tx, userID uuid.UUID, expenses []expense, now time.Time) error {
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO sync_state (user_id) VALUES (?) ON CONFLICT DO NOTHING", userID); err != nil {
		return fmt.Errorf("failed to create the change counter: %w", err)
	}
	var seq int64
	if err := tx.QueryRowContext(ctx,
		"SELECT change_seq FROM sync_state WHERE user_id = ? FOR UPDATE", userID).Scan(&seq); err != nil {
		return fmt.Errorf("failed to lock the change counter: %w", err)
	}
	for _, e := range expenses {
		seq++
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO expenses
			 (id, user_id, updated_at, change_seq, amount, category_id, date, spent_at, is_big_purchase)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, false)`,
			e.id, userID, now.UnixMilli(), seq, e.amount, e.categoryID,
			e.date.Format(dateLayout), e.spentAt.UnixMilli(),
		); err != nil {
			return fmt.Errorf("failed to add an expense: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE sync_state SET change_seq = ? WHERE user_id = ?", seq, userID); err != nil {
		return fmt.Errorf("failed to update the change counter: %w", err)
	}
	return nil
}

// unitOf returns the smallest step of a generated amount: 10 for a currency
// without decimals (¥10), 1 minor unit for the others (e.g. $0.01).
func unitOf(currency string) int64 {
	if currency == "JPY" {
		return 10
	}
	return 1
}

// dateOf returns t's calendar date in this machine's time zone, at midnight
// UTC like the dates read from the database, so dates subtract in whole days.
func dateOf(t time.Time) time.Time {
	local := t.In(time.Local)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}

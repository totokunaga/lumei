package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

var _ application.UserRepository = (*UserRepository)(nil)

// uniqueViolation is the PostgreSQL error code for a broken unique constraint.
const uniqueViolation = "23505"

type userRow struct {
	bun.BaseModel `bun:"table:users"`

	ID        uuid.UUID `bun:"id,pk,type:uuid"`
	Email     string    `bun:"email"`
	CreatedAt time.Time `bun:"created_at,nullzero,default:now()"`
	UpdatedAt time.Time `bun:"updated_at,nullzero,default:now()"`
}

type identityRow struct {
	bun.BaseModel `bun:"table:user_identities"`

	Provider  string    `bun:"provider,pk"`
	Subject   string    `bun:"subject,pk"`
	UserID    uuid.UUID `bun:"user_id,type:uuid"`
	Email     string    `bun:"email"`
	CreatedAt time.Time `bun:"created_at,nullzero,default:now()"`
}

// UserRepository implements application.UserRepository on PostgreSQL.
type UserRepository struct {
	db bun.IDB
}

// NewUserRepository creates a UserRepository.
func NewUserRepository(db bun.IDB) *UserRepository {
	return &UserRepository{db: db}
}

// FindByIdentity returns the user an identity is linked to.
func (r *UserRepository) FindByIdentity(
	ctx context.Context,
	provider application.Provider,
	subject string,
) (application.User, error) {

	var row userRow
	err := r.db.NewRaw(`
		SELECT u.id, u.email
		FROM users AS u
		JOIN user_identities AS i ON i.user_id = u.id
		WHERE i.provider = ? AND i.subject = ?`,
		string(provider), subject,
	).Scan(ctx, &row)
	if err != nil {
		return application.User{}, translate(err, "failed to select the user by identity")
	}
	return application.User{ID: row.ID, Email: row.Email}, nil
}

// FindByEmail returns the user with the email address.
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (application.User, error) {
	var row userRow
	err := r.db.NewSelect().Model(&row).Column("id", "email").Where("email = ?", email).Scan(ctx)
	if err != nil {
		return application.User{}, translate(err, "failed to select the user by email")
	}
	return application.User{ID: row.ID, Email: row.Email}, nil
}

// CreateWithIdentity inserts the user and its first identity in one
// transaction.
func (r *UserRepository) CreateWithIdentity(
	ctx context.Context,
	user application.User,
	identity application.Identity,
) error {

	err := r.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		row := userRow{ID: user.ID, Email: user.Email}
		if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
			return translate(err, "failed to insert the user")
		}
		return insertIdentity(ctx, tx, user.ID, identity)
	})
	if err != nil {
		return fmt.Errorf("failed to create the user with its identity: %w", err)
	}
	return nil
}

// AddIdentity links another identity to an existing user.
func (r *UserRepository) AddIdentity(
	ctx context.Context,
	userID uuid.UUID,
	identity application.Identity,
) error {

	return insertIdentity(ctx, r.db, userID, identity)
}

// insertIdentity inserts an identity row for userID.
func insertIdentity(ctx context.Context, db bun.IDB, userID uuid.UUID, identity application.Identity) error {
	row := identityRow{
		Provider: string(identity.Provider),
		Subject:  identity.Subject,
		UserID:   userID,
		Email:    identity.Email,
	}
	if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
		return translate(err, "failed to insert the identity")
	}
	return nil
}

// sqlStateError is implemented by pgdriver.Error. Matching the method rather
// than the type lets tests stand in for a driver error.
type sqlStateError interface {
	Field(k byte) string
}

// translate wraps err with msg, translating a missing row to
// application.ErrNotFound and a unique violation to application.ErrConflict.
func translate(err error, msg string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", msg, application.ErrNotFound)
	}
	var state sqlStateError
	if errors.As(err, &state) && state.Field('C') == uniqueViolation {
		return fmt.Errorf("%s: %w: %w", msg, application.ErrConflict, err)
	}
	return fmt.Errorf("%s: %w", msg, err)
}

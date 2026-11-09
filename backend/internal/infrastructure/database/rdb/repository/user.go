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

const (
	// uniqueViolation is the PostgreSQL error code for a broken unique constraint.
	uniqueViolation = "23505"
	// foreignKeyViolation is the PostgreSQL error code for a row that refers
	// to one that doesn't exist, e.g. a deleted user.
	foreignKeyViolation = "23503"
)

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
	// RevocationToken is the provider's refresh token, sealed by the cipher.
	RevocationToken    []byte  `bun:"revocation_token,nullzero"`
	RevocationClientID *string `bun:"revocation_client_id"`
}

// Cipher seals the secrets the repository stores, and opens them again.
type Cipher interface {
	Seal(plaintext []byte) []byte
	Open(sealed []byte) ([]byte, error)
}

// UserRepository implements application.UserRepository on PostgreSQL.
type UserRepository struct {
	db     bun.IDB
	cipher Cipher
}

// NewUserRepository creates a UserRepository. cipher encrypts the providers'
// tokens it stores (BR-ACC-05).
func NewUserRepository(db bun.IDB, cipher Cipher) *UserRepository {
	return &UserRepository{db: db, cipher: cipher}
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

// SaveProviderToken seals the token and stores it on the identity.
func (r *UserRepository) SaveProviderToken(
	ctx context.Context,
	provider application.Provider,
	subject string,
	token application.ProviderToken,
) error {

	result, err := r.db.NewUpdate().Model((*identityRow)(nil)).
		Set("revocation_token = ?", r.cipher.Seal([]byte(token.Token))).
		Set("revocation_client_id = ?", token.ClientID).
		Where("provider = ? AND subject = ?", string(provider), subject).
		Exec(ctx)
	if err != nil {
		return translate(err, "failed to store the revocation token")
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to count the identities updated: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("failed to store the revocation token: %w", application.ErrNotFound)
	}
	return nil
}

// LinkedIdentities returns the user's identities with their opened tokens.
func (r *UserRepository) LinkedIdentities(
	ctx context.Context,
	userID uuid.UUID,
) ([]application.LinkedIdentity, error) {

	var rows []identityRow
	err := r.db.NewSelect().Model(&rows).
		Column("provider", "subject", "revocation_token", "revocation_client_id").
		Where("user_id = ?", userID).
		OrderExpr("created_at, provider, subject").
		Scan(ctx)
	if err != nil {
		return nil, translate(err, "failed to select the identities")
	}
	identities := make([]application.LinkedIdentity, 0, len(rows))
	for _, row := range rows {
		identity := application.LinkedIdentity{
			Provider: application.Provider(row.Provider),
			Subject:  row.Subject,
		}
		if row.RevocationToken != nil && row.RevocationClientID != nil {
			token, err := r.cipher.Open(row.RevocationToken)
			if err != nil {
				return nil, fmt.Errorf("failed to open the %s revocation token: %w", row.Provider, err)
			}
			identity.Token = &application.ProviderToken{
				ClientID: *row.RevocationClientID,
				Token:    string(token),
			}
		}
		identities = append(identities, identity)
	}
	return identities, nil
}

// Delete deletes the user row; the foreign keys cascade to all of the
// user's other rows.
func (r *UserRepository) Delete(ctx context.Context, userID uuid.UUID) error {
	if _, err := r.db.NewDelete().Model((*userRow)(nil)).Where("id = ?", userID).Exec(ctx); err != nil {
		return translate(err, "failed to delete the user")
	}
	return nil
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
	if sqlState(err) == uniqueViolation {
		return fmt.Errorf("%s: %w: %w", msg, application.ErrConflict, err)
	}
	return fmt.Errorf("%s: %w", msg, err)
}

// sqlState returns the PostgreSQL error code of err, or "" if it has none.
func sqlState(err error) string {
	var state sqlStateError
	if errors.As(err, &state) {
		return state.Field('C')
	}
	return ""
}

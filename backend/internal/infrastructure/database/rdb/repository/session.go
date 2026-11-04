package repository

import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

var _ application.SessionRepository = (*SessionRepository)(nil)

type sessionRow struct {
	bun.BaseModel `bun:"table:sessions"`

	ID               uuid.UUID `bun:"id,pk,type:uuid"`
	UserID           uuid.UUID `bun:"user_id,type:uuid"`
	RefreshTokenHash []byte    `bun:"refresh_token_hash"`
	CreatedAt        time.Time `bun:"created_at"`
	ExpiresAt        time.Time `bun:"expires_at"`
}

// SessionRepository implements application.SessionRepository on PostgreSQL.
type SessionRepository struct {
	db bun.IDB
}

// NewSessionRepository creates a SessionRepository.
func NewSessionRepository(db bun.IDB) *SessionRepository {
	return &SessionRepository{db: db}
}

// Create inserts the session.
func (r *SessionRepository) Create(ctx context.Context, session application.Session) error {
	row := sessionRow{
		ID:               session.ID,
		UserID:           session.UserID,
		RefreshTokenHash: session.RefreshTokenHash,
		CreatedAt:        session.CreatedAt,
		ExpiresAt:        session.ExpiresAt,
	}
	if _, err := r.db.NewInsert().Model(&row).Exec(ctx); err != nil {
		return translate(err, "failed to insert the session")
	}
	return nil
}

// FindByRefreshToken returns the session whose current or previous refresh
// token has tokenHash, with its user.
func (r *SessionRepository) FindByRefreshToken(
	ctx context.Context,
	tokenHash []byte,
) (application.StoredSession, error) {

	var row struct {
		ID               uuid.UUID  `bun:"id"`
		UserID           uuid.UUID  `bun:"user_id"`
		Email            string     `bun:"email"`
		ExpiresAt        time.Time  `bun:"expires_at"`
		RefreshTokenHash []byte     `bun:"refresh_token_hash"`
		RotatedAt        *time.Time `bun:"rotated_at"`
	}
	err := r.db.NewRaw(`
		SELECT s.id, s.user_id, u.email, s.expires_at, s.refresh_token_hash, s.rotated_at
		FROM sessions AS s
		JOIN users AS u ON u.id = s.user_id
		WHERE s.refresh_token_hash = ? OR s.previous_refresh_token_hash = ?`,
		tokenHash, tokenHash,
	).Scan(ctx, &row)
	if err != nil {
		return application.StoredSession{}, translate(err, "failed to select the session")
	}

	session := application.StoredSession{
		ID:               row.ID,
		User:             application.User{ID: row.UserID, Email: row.Email},
		ExpiresAt:        row.ExpiresAt,
		CurrentTokenHash: row.RefreshTokenHash,
		Current:          bytes.Equal(row.RefreshTokenHash, tokenHash),
	}
	if row.RotatedAt != nil {
		session.RotatedAt = *row.RotatedAt
	}
	return session, nil
}

// Rotate replaces the refresh token if it is still currentHash, in one
// statement, so two concurrent refreshes can't both replace it.
func (r *SessionRepository) Rotate(
	ctx context.Context,
	id uuid.UUID,
	currentHash, newHash []byte,
	now, expiresAt time.Time,
) error {

	result, err := r.db.NewRaw(`
		UPDATE sessions
		SET previous_refresh_token_hash = refresh_token_hash,
			refresh_token_hash = ?,
			rotated_at = ?,
			expires_at = ?
		WHERE id = ? AND refresh_token_hash = ?`,
		newHash, now, expiresAt, id, currentHash,
	).Exec(ctx)
	if err != nil {
		return translate(err, "failed to rotate the refresh token")
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to count the rotated sessions: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("the refresh token was replaced concurrently: %w", application.ErrConflict)
	}
	return nil
}

// Delete removes the session, if it exists.
func (r *SessionRepository) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.NewDelete().Model((*sessionRow)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return translate(err, "failed to delete the session")
	}
	return nil
}

package repository

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

var _ application.CategorySetRepository = (*CategorySetRepository)(nil)

type categorySetRow struct {
	bun.BaseModel `bun:"table:category_sets"`

	Region       string   `bun:"region,pk"`
	Position     int      `bun:"position"`
	NameEn       string   `bun:"name_en"`
	NameJa       string   `bun:"name_ja"`
	NameFr       string   `bun:"name_fr"`
	CountryCodes []string `bun:"country_codes,array"`
}

type categorySetItemRow struct {
	bun.BaseModel `bun:"table:category_set_items"`

	Region   string `bun:"region,pk"`
	Key      string `bun:"key,pk"`
	Position int    `bun:"position"`
	Emoji    string `bun:"emoji"`
	NameEn   string `bun:"name_en"`
	NameJa   string `bun:"name_ja"`
	NameFr   string `bun:"name_fr"`
}

// CategorySetRepository implements application.CategorySetRepository on
// PostgreSQL.
type CategorySetRepository struct {
	db bun.IDB
}

// NewCategorySetRepository creates a CategorySetRepository.
func NewCategorySetRepository(db bun.IDB) *CategorySetRepository {
	return &CategorySetRepository{db: db}
}

// List returns every set ordered by position, each with its categories
// ordered by position.
func (r *CategorySetRepository) List(ctx context.Context) ([]application.CategorySet, error) {
	var sets []categorySetRow
	if err := r.db.NewSelect().Model(&sets).Order("position").Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to select the category sets: %w", err)
	}
	var items []categorySetItemRow
	if err := r.db.NewSelect().Model(&items).Order("region", "position").Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to select the category set items: %w", err)
	}

	categories := make(map[string][]application.DefaultCategory, len(sets))
	for _, item := range items {
		categories[item.Region] = append(categories[item.Region], application.DefaultCategory{
			Key:   item.Key,
			Emoji: item.Emoji,
			Name:  application.LocalizedText{En: item.NameEn, Ja: item.NameJa, Fr: item.NameFr},
		})
	}

	result := make([]application.CategorySet, 0, len(sets))
	for _, set := range sets {
		result = append(result, application.CategorySet{
			Region: set.Region,
			Name:   application.LocalizedText{En: set.NameEn, Ja: set.NameJa, Fr: set.NameFr},
			// Never nil, so the global set lists no countries rather than null.
			Countries:  append([]string{}, set.CountryCodes...),
			Categories: categories[set.Region],
		})
	}
	return result, nil
}

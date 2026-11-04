package application

import "context"

// GlobalRegion is the region of the default category set for every region
// without its own, offered at setup as "Other" (BR-SET-06).
const GlobalRegion = "global"

// LocalizedText is a text in every language the app supports (BR-SET-01).
type LocalizedText struct {
	En string
	Ja string
	Fr string
}

// DefaultCategory is a category a new account starts with (BR-CAT-01).
type DefaultCategory struct {
	// Key identifies the category across languages and sets, e.g. "eat_out".
	Key   string
	Emoji string
	Name  LocalizedText
}

// CategorySet is the default categories of one region (BR-CAT-07).
type CategorySet struct {
	Region string
	Name   LocalizedText
	// Countries are the ISO 3166-1 alpha-2 device regions that preselect the
	// set at setup.
	Countries []string
	// Categories are in display order.
	Categories []DefaultCategory
}

// CategorySetRepository reads the default category sets from the seed data.
type CategorySetRepository interface {
	// List returns every set in setup order, each with its categories in
	// display order.
	List(ctx context.Context) ([]CategorySet, error)
}

// CategorySetLister lists the default category sets.
type CategorySetLister interface {
	List(ctx context.Context) ([]CategorySet, error)
}

var _ CategorySetLister = (*CategorySetUsecase)(nil)

// CategorySetUsecase implements CategorySetLister.
type CategorySetUsecase struct {
	sets CategorySetRepository
}

// NewCategorySetLister creates a CategorySetUsecase.
func NewCategorySetLister(sets CategorySetRepository) *CategorySetUsecase {
	return &CategorySetUsecase{sets: sets}
}

// List returns every default category set. They are the same for every user:
// a set becomes the user's own only when setup copies it (BR-CAT-07).
func (u *CategorySetUsecase) List(ctx context.Context) ([]CategorySet, error) {
	return u.sets.List(ctx)
}

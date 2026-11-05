package controller

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// PushChanges stores the device's changes that win their conflicts
// (BR-OFF-03, BR-OFF-05).
func (a *APIController) PushChanges(ctx *gin.Context) {
	var body generated.PushChangesJSONRequestBody
	if err := ctx.ShouldBindJSON(&body); err != nil {
		writeError(ctx, http.StatusBadRequest, "invalid_request", "the body must be JSON with a list of rows")
		return
	}
	rows := make([]application.SyncRow, 0, len(body.Rows))
	for i, row := range body.Rows {
		converted, err := fromSyncRow(row)
		if err != nil {
			writeError(ctx, http.StatusBadRequest, "invalid_request", fmt.Sprintf("row %d: %v", i, err))
			return
		}
		rows = append(rows, converted)
	}

	results, err := a.Sync.Push(ctx.Request.Context(), rows)
	switch {
	case errors.Is(err, application.ErrTooManyRows):
		writeError(ctx, http.StatusBadRequest, "invalid_request", err.Error())
	case err != nil:
		a.internalError(ctx, "failed to push the changes", err)
	default:
		resp := generated.PushResponse{Results: make([]generated.PushResult, 0, len(results))}
		for _, r := range results {
			result := generated.PushResult{
				Table: string(r.Table), Id: r.ID, Outcome: generated.PushOutcome(r.Outcome),
			}
			if r.Code != "" {
				result.Code = &r.Code
			}
			resp.Results = append(resp.Results, result)
		}
		ctx.JSON(http.StatusOK, resp)
	}
}

// PullChanges returns the user's changes after the cursor (BR-OFF-03).
func (a *APIController) PullChanges(ctx *gin.Context, params generated.PullChangesParams) {
	if params.Since < 0 {
		writeError(ctx, http.StatusBadRequest, "invalid_request", "since must be 0 or more")
		return
	}
	result, err := a.Sync.Pull(ctx.Request.Context(), params.Since)
	if err != nil {
		a.internalError(ctx, "failed to pull the changes", err)
		return
	}
	resp := generated.PullResponse{
		Rows:    make([]generated.SyncRow, 0, len(result.Rows)),
		Cursor:  result.Cursor,
		HasMore: result.HasMore,
	}
	for _, row := range result.Rows {
		converted, err := toSyncRow(row)
		if err != nil {
			a.internalError(ctx, "failed to convert a pulled row", err)
			return
		}
		resp.Rows = append(resp.Rows, converted)
	}
	ctx.JSON(http.StatusOK, resp)
}

// fromSyncRow converts a pushed row to the use case's row.
func fromSyncRow(row generated.SyncRow) (application.SyncRow, error) {
	value, err := row.ValueByDiscriminator()
	if err != nil {
		return application.SyncRow{}, err
	}
	switch v := value.(type) {
	case generated.SettingsRow:
		return application.SyncRow{
			ID: v.Id, UpdatedAt: v.UpdatedAt, DeletedAt: v.DeletedAt,
			Record: application.SettingsRecord{
				Region:            v.Region,
				Currency:          v.Currency,
				PeriodStartDay:    int(v.PeriodStartDay),
				BigPurchaseSpread: string(v.BigPurchaseSpread),
				SetupCompletedAt:  v.SetupCompletedAt,
			},
		}, nil
	case generated.CategoryRow:
		return application.SyncRow{
			ID: v.Id, UpdatedAt: v.UpdatedAt, DeletedAt: v.DeletedAt,
			Record: application.CategoryRecord{
				Name: v.Name, Emoji: v.Emoji, Position: int(v.Position), ArchivedAt: v.ArchivedAt,
			},
		}, nil
	case generated.PeriodRow:
		return application.SyncRow{
			ID: v.Id, UpdatedAt: v.UpdatedAt, DeletedAt: v.DeletedAt,
			Record: application.PeriodRecord{StartDate: v.StartDate, EndDate: v.EndDate},
		}, nil
	case generated.IncomeRow:
		return application.SyncRow{
			ID: v.Id, UpdatedAt: v.UpdatedAt, DeletedAt: v.DeletedAt,
			Record: application.IncomeRecord{
				PeriodID: v.PeriodId, Name: v.Name, Amount: v.Amount, Position: int(v.Position),
			},
		}, nil
	case generated.FixedExpenseRow:
		return application.SyncRow{
			ID: v.Id, UpdatedAt: v.UpdatedAt, DeletedAt: v.DeletedAt,
			Record: application.FixedExpenseRecord{
				PeriodID: v.PeriodId, Name: v.Name, Amount: v.Amount, Note: v.Note, Position: int(v.Position),
			},
		}, nil
	case generated.SavingTargetRow:
		return application.SyncRow{
			ID: v.Id, UpdatedAt: v.UpdatedAt, DeletedAt: v.DeletedAt,
			Record: application.SavingTargetRecord{PeriodID: v.PeriodId, Amount: v.Amount},
		}, nil
	default:
		e := value.(generated.ExpenseRow) //nolint:forcetypeassert // the discriminator has no other values
		return application.SyncRow{
			ID: e.Id, UpdatedAt: e.UpdatedAt, DeletedAt: e.DeletedAt,
			Record: application.ExpenseRecord{
				Amount:        e.Amount,
				CategoryID:    e.CategoryId,
				Date:          e.Date,
				SpentAt:       e.SpentAt,
				IsBigPurchase: e.IsBigPurchase,
				Description:   e.Description,
				Latitude:      e.Latitude,
				Longitude:     e.Longitude,
			},
		}, nil
	}
}

// toSyncRow converts a stored row to its API representation.
func toSyncRow(row application.SyncRow) (generated.SyncRow, error) {
	var out generated.SyncRow
	var err error
	switch r := row.Record.(type) {
	case application.SettingsRecord:
		err = out.FromSettingsRow(generated.SettingsRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			Region:            r.Region,
			Currency:          r.Currency,
			PeriodStartDay:    int32(r.PeriodStartDay), //nolint:gosec // 1 to 31
			BigPurchaseSpread: generated.SettingsRowBigPurchaseSpread(r.BigPurchaseSpread),
			SetupCompletedAt:  r.SetupCompletedAt,
		})
	case application.CategoryRecord:
		err = out.FromCategoryRow(generated.CategoryRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			Name: r.Name, Emoji: r.Emoji, ArchivedAt: r.ArchivedAt,
			Position: int32(r.Position), //nolint:gosec // a list index
		})
	case application.PeriodRecord:
		err = out.FromPeriodRow(generated.PeriodRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			StartDate: r.StartDate, EndDate: r.EndDate,
		})
	case application.IncomeRecord:
		err = out.FromIncomeRow(generated.IncomeRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			PeriodId: r.PeriodID, Name: r.Name, Amount: r.Amount,
			Position: int32(r.Position), //nolint:gosec // a list index
		})
	case application.FixedExpenseRecord:
		err = out.FromFixedExpenseRow(generated.FixedExpenseRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			PeriodId: r.PeriodID, Name: r.Name, Amount: r.Amount, Note: r.Note,
			Position: int32(r.Position), //nolint:gosec // a list index
		})
	case application.SavingTargetRecord:
		err = out.FromSavingTargetRow(generated.SavingTargetRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			PeriodId: r.PeriodID, Amount: r.Amount,
		})
	case application.ExpenseRecord:
		err = out.FromExpenseRow(generated.ExpenseRow{
			Id: row.ID, UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt,
			Amount:        r.Amount,
			CategoryId:    r.CategoryID,
			Date:          r.Date,
			SpentAt:       r.SpentAt,
			IsBigPurchase: r.IsBigPurchase,
			Description:   r.Description,
			Latitude:      r.Latitude,
			Longitude:     r.Longitude,
		})
	default:
		err = fmt.Errorf("unknown record type %T", row.Record)
	}
	return out, err
}

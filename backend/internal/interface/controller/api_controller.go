// Package controller implements the generated server interface.
package controller

import (
	"log/slog"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

var _ generated.ServerInterface = (*APIController)(nil)

// APIController implements generated.ServerInterface by dispatching to use cases.
type APIController struct {
	APIControllerInput
}

// APIControllerInput holds the dependencies for APIController.
type APIControllerInput struct {
	HealthChecker application.HealthChecker
	Logger        *slog.Logger
}

// NewAPIController creates a new APIController from an input struct.
func NewAPIController(input *APIControllerInput) *APIController {
	return &APIController{APIControllerInput: *input}
}

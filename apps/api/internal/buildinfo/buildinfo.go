// Package buildinfo identifies the running build.
package buildinfo

const (
	// Name is the product name reported by the API and shown in the web shell.
	Name = "OPVARYN"
	// Version is the current build version, bumped by hand while MVP V1 is in flight.
	Version = "0.1.0"
	// Stage is the delivery stage this build targets; the contract allows
	// demo | mvp | production (ADR 0014).
	Stage = "mvp"
)

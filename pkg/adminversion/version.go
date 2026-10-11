package adminversion

import _ "embed"

// Manifest is shared by the admin API and the documentation generator.
//
//go:embed versions.json
var Manifest []byte

var Revision = "local-development"
var BuildTime = "not-recorded"

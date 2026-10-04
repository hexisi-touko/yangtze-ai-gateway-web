package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeClientReleaseVersion(t *testing.T) {
	for _, test := range []struct {
		input string
		want  string
	}{
		{"1.2.3", "1.2.3"},
		{" v1.2.3-rc.1+build.7 ", "1.2.3-rc.1+build.7"},
	} {
		t.Run(test.input, func(t *testing.T) {
			got, err := NormalizeClientReleaseVersion(test.input)
			require.NoError(t, err)
			assert.Equal(t, test.want, got)
		})
	}
	for _, input := range []string{"", "1.2", "01.2.3", "1.2.3-01", "1.2.3+", "1.2.3/evil"} {
		t.Run("reject "+input, func(t *testing.T) {
			_, err := NormalizeClientReleaseVersion(input)
			require.Error(t, err)
		})
	}
}

func TestReleaseVersionIsNewerUsesSemanticOrdering(t *testing.T) {
	for _, test := range []struct {
		candidate string
		current   string
		want      bool
	}{
		{"1.10.0", "1.9.0", true},
		{"2.0.0", "1.99.0", true},
		{"1.2.3", "1.2.3", false},
		{"1.2.3-rc.2", "1.2.3-rc.10", false},
		{"1.2.3", "1.2.3-rc.9", true},
	} {
		t.Run(test.candidate+" vs "+test.current, func(t *testing.T) {
			assert.Equal(t, test.want, ReleaseVersionIsNewer(test.candidate, test.current))
		})
	}
}

//go:build !windows

package service

import "net/url"

// Non-Windows deployments use HTTP(S)_PROXY, which is handled by the normal
// Go transport. There is no WinINET registry to inspect here.
func detectSystemHTTPProxy() (*url.URL, error) { return nil, nil }

//go:build windows

package service

import (
	"net/url"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// detectSystemHTTPProxy reads the per-user WinINET proxy used by browsers.
// It intentionally returns only an HTTP proxy because the pricing request is
// ordinary HTTPS-over-HTTP-proxy traffic and this keeps cloud builds portable.
func detectSystemHTTPProxy() (*url.URL, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil, nil
	}
	defer key.Close()
	enabled, _, err := key.GetIntegerValue("ProxyEnable")
	if err != nil || enabled == 0 {
		return nil, nil
	}
	server, _, err := key.GetStringValue("ProxyServer")
	if err != nil {
		return nil, nil
	}
	server = strings.TrimSpace(server)
	if server == "" {
		return nil, nil
	}
	// WinINET may store protocol-specific values such as
	// https=127.0.0.1:7890;http=127.0.0.1:7890.
	for _, part := range strings.Split(server, ";") {
		part = strings.TrimSpace(part)
		lower := strings.ToLower(part)
		if strings.HasPrefix(lower, "https=") || strings.HasPrefix(lower, "http=") {
			part = part[strings.IndexByte(part, '=')+1:]
		}
		if part == "" {
			continue
		}
		if !strings.Contains(part, "://") {
			part = "http://" + part
		}
		parsed, parseErr := url.Parse(part)
		if parseErr == nil && parsed.Host != "" {
			return parsed, nil
		}
	}
	return nil, nil
}

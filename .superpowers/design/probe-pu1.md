# PU-1 results (run 2026-11-24 by the orchestrator)

Environment: Windows (Version 10.0.26100.8037). Node v24.14.1 (the Node that runs vitest on this machine), one process. Electron 45.4.1 renderer (Chrome 156.0.8078.100), sandbox true, contextIsolation true, one process. Probe files outside the repository. Each input passed to `new URL(input)`.

| Input (JSON) | protocol | hostname | href | Node and Electron agree |
|---|---|---|---|---|
| "https://127.0.0.1./t.jpg" | https: | 127.0.0.1 | https://127.0.0.1/t.jpg | yes |
| "https://[::ffff:1.2.3.4]/t.jpg" | https: | [::ffff:102:304] | https://[::ffff:102:304]/t.jpg | yes |
| "https://1.2.3/t.jpg" | https: | 1.2.0.3 | https://1.2.0.3/t.jpg | yes |
| "https://exam\nple.com/t.jpg" | https: | example.com | https://example.com/t.jpg | yes |
| "https://example.com/a\tb.jpg" | https: | example.com | https://example.com/ab.jpg | yes |
| "https://2130706433/t.jpg" | https: | 127.0.0.1 | https://127.0.0.1/t.jpg | yes |
| "https://0x7f.0.0.1/t.jpg" | https: | 127.0.0.1 | https://127.0.0.1/t.jpg | yes |
| "https://localhost./t.jpg" | https: | localhost. | https://localhost./t.jpg | yes |
| "https://a.localhost./t.jpg" | https: | a.localhost. | https://a.localhost./t.jpg | yes |
| "HTTPS://EXAMPLE.com/t.jpg" | https: | example.com | https://example.com/t.jpg | yes |

No input threw. Both runtimes give identical protocol, hostname and href for every input. CI's Node version is whatever .github/workflows/ci.yml pins; it is covered only by CI.

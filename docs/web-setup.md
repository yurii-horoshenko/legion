# Legion Web — Setup & Launch

## Requirements

- **Node.js 18+** — install via [brew](https://brew.sh): `brew install node`

---

## Install

From the project root:

```bash
npm install -g .
```

This registers the `legion` command globally. Done once.

---

## Commands

```bash
legion web              # Start portal on http://localhost:3000
legion start            # Same as web
legion web --port 8080  # Custom port
legion web --no-open    # Don't auto-open browser
legion help             # Show all commands
```

---

## Uninstall

```bash
npm uninstall -g @legion-ai/legion
```

---

## Reinstall after code changes

```bash
npm install -g .
```

---

## What happens on `legion web`

1. Starts a local HTTP server (Node built-in, no external deps)
2. Serves `platforms/web/` as static files
3. Opens `http://localhost:3000` in your default browser
4. `Ctrl+C` to stop

---

## Future: publish to npm

Once ready to share publicly:

```bash
npm publish --access public
```

Then anyone installs with:

```bash
npm install -g @legion-ai/legion
legion web
```

## Future: Homebrew formula

After npm publish, a Homebrew formula can wrap it:

```ruby
class Legion < Formula
  desc "Legion AI agent platform"
  homepage "https://github.com/yourorg/legion"
  url "https://registry.npmjs.org/@legion-ai/legion/-/legion-0.1.0.tgz"

  def install
    system "npm", "install", "-g", "--prefix", prefix, "."
  end
end
```

Then: `brew install legion-ai/tap/legion`

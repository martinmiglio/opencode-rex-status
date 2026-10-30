# opencode-rex-status

An OpenCode TUI plugin that tells [Rex](https://www.superlogical.com) when a session finishes or fails.

OpenCode already reports working and blocked sessions over [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status). This plugin adds `done` and `error`, so a session that finishes in a background tab stays flagged until you come back to it.

It only runs when `REX_SESSION` is set.

## Install

Copy `rex-status.mjs` to `~/.config/opencode/tui-plugins/`, then add it to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["./tui-plugins/rex-status.mjs"]
}
```

Requires OpenCode 2.2 or later.

## Test

```sh
node --test
```

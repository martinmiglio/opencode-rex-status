# opencode-rex-status

An OpenCode TUI plugin that tells [Rex](https://www.superlogical.com) when a session finishes or fails.

OpenCode already reports working and blocked sessions over [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status). This plugin adds `done` and `error`, so a session that finishes in a background tab stays flagged until you come back to it.

It only runs when `REX_SESSION` is set.

## Install

Clone the repository into `~/.config/opencode/tui-plugins/`:

```sh
git clone https://github.com/martinmiglio/opencode-rex-status ~/.config/opencode/tui-plugins/opencode-rex-status
```

Then add the folder to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["./tui-plugins/opencode-rex-status"]
}
```

Point `plugins` at the folder, not at `rex-status.mjs`. OpenCode skips plugin entries that name a single file without reporting it.

Requires OpenCode 2.2 or later.

## Test

```sh
node --test
```

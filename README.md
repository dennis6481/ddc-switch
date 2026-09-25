# ddc-switch

DDC/CI CLI to switch external display input between multiple machines.

Share one display between a Mac and a Windows PC without touching the monitor's
physical buttons. Switch input from the terminal, Raycast, or Claude Code.

Supported platforms:

| OS | DDC backend | Extra install |
| --- | --- | --- |
| macOS (Apple Silicon) | [m1ddc](https://github.com/waydabber/m1ddc) | `brew install m1ddc` |
| Windows 11 | [dxva2.dll](https://learn.microsoft.com/en-us/windows/win32/api/_monitor/) (built-in) | None |

Same CLI, same config file, same commands on both OSes.

## Port-based input naming

Inputs are named after the **monitor's port** (`type-c` / `hdmi` / `dp`), not the
machine connected to it. You can swap the device on a Type-C port without the
name becoming a lie.

Want to name inputs after machines? Add aliases in your config's `inputs`:
```json
{ "inputs": { "type-c": 27, "work-mac": 27, "hdmi": 17, "game-pc": 17 } }
```

## Install

```sh
brew install m1ddc
git clone <this repo> ~/src/ddc-switch && cd ddc-switch
mise trust && mise install
mise exec -- just install
```

### Windows

```powershell
git clone <this repo> $env:USERPROFILE\src\ddc-switch
cd $env:USERPROFILE\src\ddc-switch
mise trust; mise install
mise exec -- just install
```

No extra install needed — `dxva2.dll` ships with Windows.

Make sure **DDC/CI is enabled** in your monitor's OSD menu.

### What `just install` does

1. Builds a self-contained binary (`dist/ddc` on macOS / `dist/ddc.exe` on Windows)
2. Places it in `~/.local/bin/` (`ddc` on macOS, `ddc.exe` on Windows)
3. Creates `~/.config/ddc-switch/config.json` if it doesn't exist

Prefix is configurable: `PREFIX=/usr/local/bin just install`
Uninstall with `just uninstall` (config is preserved).

No daemon — the binary runs on demand and exits. Self-contained so it works
from Raycast, launchers, or any environment with a limited PATH.

## For LG Monitor

### Windows

The normal Windows backend uses the built-in `dxva2.dll` DDC/CI API. This path
does not require an NVIDIA GPU; Intel, AMD, and NVIDIA systems can use it as
long as the monitor, driver, and connection expose DDC/CI.

Some newer LG monitors, including the WK95U tested with this project, ignore
the normal input-source command. For these displays, the Windows backend
detects LG from the monitor's PNP/EDID information and sends selected private
input values through NVIDIA's raw-I2C API instead:

- LG private input switching currently requires a 64-bit Windows installation,
  an NVIDIA GPU/driver exposing `nvapi64.dll`, and a DDC path reachable by that
  GPU.
- Intel/AMD systems can still use the ordinary DDC commands, but the LG
  private input path is not implemented for them yet.
- Hybrid-graphics laptops, multiple GPUs, USB-C docks, KVMs, and adapters may
  prevent NVIDIA from reaching the monitor's DDC channel.
- Private input values are monitor/model-specific. `0xD1` is the Type-C value
  verified for the WK95U; it is not a universal LG value.
- The private command is write-only from this backend, so an immediate VCP
  readback cannot reliably confirm the new input. The screen may switch even
  when the CLI reports that verification is unavailable.

The checked-in `config.default.json` uses generic VCP values. During first
automatic display discovery, an uncustomized config is saved with LG defaults
(`hdmi: 0x90`, `dp: 0xD0`, `type-c: 0xD1`) when the detected display is LG.
Existing customized input mappings are preserved.

If LG detection fails, the standard `dxva2.dll` path is used. If a configured
private LG value is used without a usable NVIDIA NVAPI path, the command fails
instead of silently sending an incompatible standard command.

### macOS

When an LG display is detected on first run, the macOS backend uses m1ddc's
alternate input command for LG's private input values:

- Type-C / DP3: `210`
- HDMI1: `144`
- DisplayPort1: `208`

These values are model-specific. Existing customized input mappings are
preserved, and non-LG displays continue to use the normal `input` command.

## CLI

```sh
ddc                    # current state
ddc hdmi               # switch to HDMI
ddc type-c             # switch to Type-C
ddc toggle             # toggle between the two inputs in config
ddc inputs             # list configured input names
ddc displays           # list DDC-visible displays
ddc caps               # what the display reports it supports (Windows only)
ddc brightness 60
ddc contrast 75
ddc volume 30 / ddc mute / ddc unmute
ddc pbp 36 hdmi        # PBP 50/50 with HDMI as secondary

ddc status --json      # JSON output
ddc version            # print version
```

Commands are identical on both OSes.

## Raycast

`raycast/` contains Script Commands for both macOS and Windows:

| Script | Name | Action |
| --- | --- | --- |
| `ddc-type-c.*` | Switch Display to Type-C | Switch to Type-C |
| `ddc-hdmi.*` | Switch Display to HDMI | Switch to HDMI |
| `ddc-status.*` | Display Status | Show current state |

```sh
just raycast
```

Copies scripts to `~/.raycast/script-commands/`. Run after `just install`.

First time only: register the script directory in Raycast
(Raycast → Extensions → Script Commands → Add Script Directory → paste path).

Assign hotkeys to your most-used commands via Record Hotkey.

Brightness/contrast/volume controls are intentionally not exposed as Raycast
scripts — input switching is the hotkey use case.

## Logi Options+

Logi Options+ can trigger an application from a mouse button, keyboard key, or
Smart Action. Since the input argument is different for each command, wrap the
`ddc` command in a platform-native application or script first.

### Windows: CMD wrapper

Create a `.cmd` file for each input. For example, save this as
`ddcToMacBook.cmd` on the Desktop:

```bat
@echo off
"%USERPROFILE%\.local\bin\ddc.exe" type-c
```

Replace `type-c` with `hdmi` or another configured input as needed. In Logi
Options+, assign the file through the **Execute** / **Run** action.
The `.cmd` file contains the argument, so the Options+ action itself does not
need a separate argument field.

If Windows hides file extensions, enable **File name extensions** in File
Explorer so the file is saved as `ddcToMacBook.cmd`, not
`ddcToMacBook.cmd.txt`.

### macOS: Automator application

Create one Automator application for each input:

1. Open **Automator** and choose **New Document → Application**.
2. Add the **Run Shell Script** action.
3. Set the shell to `/bin/zsh` and use:

   ```zsh
   "$HOME/.local/bin/ddc" type-c
   ```

   Replace `type-c` with `hdmi` or another configured input when needed.
4. Save it as an application, for example `ddc-type-c.app` in `~/Applications/`.
5. In Logi Options+, assign the application to the desired button or Smart
   Action using **Run/Open application**.

Using the absolute path is recommended because Logi Options+ may not inherit
the same `PATH` as an interactive Terminal.



## Claude Code (Skill)

`skills/ddc-display/` contains a Claude Code Skill:

```sh
just skill
```

Installs to `~/.claude/skills/`. Reload Claude Code and `/skills` to verify.

The Skill tells Claude:

- Input names are port-based, run `ddc inputs` to confirm (don't guess)
- Switching physically takes over the user's screen — ask permission first
- Background multi-switch scripts must log to file and restore the original input
- `ddc status` takes 3-6 seconds; read failures are normal, retry once

## Config

`~/.config/ddc-switch/config.json`

```json
{
  "display": "YOUR_DISPLAY_NAME",
  "inputs": {
    "type-c": 27,
    "hdmi": 17,
    "dp": 15
  },
  "toggle": ["type-c", "hdmi"],
  "m1ddcPath": null
}
```

- `display` — partial name match, backend-specific ID, or index number. If it is
  `YOUR_DISPLAY_NAME` or empty, the first command automatically selects and saves
  the only DDC-visible display. With multiple displays, choose one from the list
  in the error message; an existing configured value is never overwritten.
- `inputs` — logical name → monitor input value. Most monitors use VCP 0x60
  values; LG private-protocol monitors may use model-specific values such as
  `0xD1` for Type-C. Use `ddc caps` on Windows for the standard values.
- `toggle` — the two inputs `ddc toggle` cycles between
- `m1ddcPath` — macOS only; null means find via PATH

Writing `inputs` replaces the whole map (not merged).

## Why you can switch back from the other side

On the reference monitor (Dell U3223QE), switching away to HDMI does **not**
kill the DDC link on the Type-C side — so the Mac can switch back without
any external hardware.

This is **monitor-dependent** — other displays may behave differently. See
[docs/ddc-findings.md](docs/ddc-findings.md) for measurement details.

Also: switching **to** the input your machine is currently on triggers ~10 seconds
of DDC silence (the display re-establishes its link). The CLI retries
aggressively during this window.

## Development

```sh
just              # recipe list
just deps         # bun install
just cli status   # CLI (read-only, no screen change)
just typecheck
just build        # self-contained binary
just probe        # raw DDC behavior (debugging)
just raycast      # deploy Raycast scripts
just skill        # deploy Claude Code Skill
just uninstall    # remove deployed files (config preserved)
```

Recipes with `[macos]` / `[windows]` attributes are platform-specific.

## License

MIT

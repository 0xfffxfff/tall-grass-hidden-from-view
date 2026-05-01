# Exhibition Mac mini setup

Kiosk machine that drives the two back-to-back Samsung DM55E screens of the Monolith.

## Machine

- Model: Mac mini M4 (`Mac16,10`), macOS 26.2
- User: `fff`
- Tailscale IP: `100.96.84.122`
- Hostname (Tailscale): `Mac-mini` (use MagicDNS once enabled)

## Displays

Two Samsung SyncMasters, both 1080×1920 portrait, side-by-side in macOS Display arrangement:

| Display    | Position (x,y)    | URL                                            | Rotation |
| ---------- | ----------------- | ---------------------------------------------- | -------- |
| Main       | `0,0` → `1080,1920`   | `http://tallgrass.0xfff.love/full?offsetX=1080` | 90°      |
| Secondary  | `-1080,0` → `0,1920`  | `http://tallgrass.0xfff.love/full`             | 270°     |

Secondary is to the **left** of main in macOS coordinates. The two screens face opposite directions physically (back-to-back), hence the offset on main and the opposing rotations.

## Kiosk

Two fullscreen Chrome instances, one per display, launched at login by a per-user LaunchAgent.

### Files

- `~/kiosk.sh` — launcher. Sleeps 8s for the window server, clears Chrome's "did not shut down cleanly" flag, launches both Chrome processes, waits, exits if either dies (so launchd respawns).
- `~/Library/LaunchAgents/love.0xfff.tallgrass.kiosk.plist` — LaunchAgent. `RunAtLoad=true`, `KeepAlive=true`, `ThrottleInterval=15`.
- Logs: `/tmp/kiosk.out.log`, `/tmp/kiosk.err.log`, `/tmp/kiosk-main.log`, `/tmp/kiosk-secondary.log`.
- Profiles: `~/.chrome-kiosk-main`, `~/.chrome-kiosk-secondary` (separate so the two windows can both run).

### Manage

```sh
# stop kiosk
launchctl bootout gui/$(id -u)/love.0xfff.tallgrass.kiosk

# start kiosk
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/love.0xfff.tallgrass.kiosk.plist

# force-restart (Chrome will reappear in ~10s)
launchctl kickstart -k gui/$(id -u)/love.0xfff.tallgrass.kiosk

# tail logs
tail -f /tmp/kiosk.out.log /tmp/kiosk-main.log /tmp/kiosk-secondary.log
```

If the URLs end up on the wrong screens, swap them in `~/kiosk.sh` (the `--window-position=0,0` block vs. `--window-position=-1080,0` block).

## Remote access

All over Tailscale (`100.96.84.122`):

- **SSH**: `ssh fff@100.96.84.122` — enabled in System Settings → General → Sharing → Remote Login.
- **Screen sharing (VNC)**: `vnc://100.96.84.122` from Finder's *Connect to Server* (⌘K). Enable in System Settings → General → Sharing → Screen Sharing, or over SSH:
  ```sh
  sudo launchctl enable system/com.apple.screensharing && sudo launchctl kickstart -k system/com.apple.screensharing
  ```
  Do **not** turn on Remote Management; it replaces Screen Sharing and adds attack surface we don't need.
- **File sharing (SMB)**: `smb://100.96.84.122` — enable File Sharing in the same pane.
- Leave **Remote Apple Events** off (legacy AppleScript-over-network).

## Manual setup that still needs the GUI / sudo

Done from the Mac itself or via Screen Sharing — these need the user password.

1. **Auto-login**: System Settings → Users & Groups → (i) next to `fff` → Automatic login. Without this, a power cycle stops at the login window and the kiosk never starts.
2. **Never sleep**:
   ```sh
   sudo pmset -a sleep 0 displaysleep 0 disksleep 0 womp 1
   ```
   Or System Settings → Lock Screen / Energy → never sleep + don't require password.
3. **Sharing toggles**: System Settings → General → Sharing → Screen Sharing on, File Sharing on (SSH already on).

## Gotchas

- **Tailscale "Use Tailscale DNS" breaks public domains.** With it on, queries for `tallgrass.0xfff.love` returned SERVFAIL from `100.100.100.100` and Chrome showed `ERR_NAME_NOT_RESOLVED`. Turning off "Use Tailscale DNS" in the Tailscale menu bar fixed it. If MagicDNS is needed later, configure split-DNS instead of relying on the global override.
- **macOS AppleScript over SSH needs Accessibility permission**, which can't be granted over SSH. Don't rely on `osascript` for setup steps — read `/Library/Preferences/com.apple.windowserver.displays.plist` for display origins instead.
- **Chrome `--kiosk` + `--window-position=NEG,0`** does work for the secondary display at negative x — confirmed on macOS 26.2 / Chrome 147.
- **Screen Sharing "Virtual Display" blanks the physical screens.** When connecting as `fff` while `fff` is logged in locally, the connect dialog offers "Virtual Display" (new session, locks the local screens to login) or "Share Display" (mirrors what's on the screens). Pick **Share Display** — otherwise the kiosk goes black until you disconnect.

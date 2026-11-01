# Render from the repo root: vhs assets/tapes/station.tape
# The station serves itself over SSH with --demo: the server moves the pointers of
# the users alice and bob along a script, aimed at zones by ID (a recorder cannot
# click). alice is the ssh session typed below; a background script
# (assets/tapes/station-bot.ts) keeps bob's SSH session open.
Output "/Users/oliveiraantoniocc/Documents/projects/bubbletea-worktrees/mixed-example/assets/station.gif"

Set Shell bash
Set FontSize 16
Set Width 1220
Set Height 760
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 12

Hide
Type "export PS1='> ' && echo $(tput cols)x$(tput lines) > /tmp/station-size.txt && clear"
Enter
Type "mkdir -p /tmp/station-demo && rm -f /tmp/station-demo/id* && ssh-keygen -q -t ed25519 -N '' -f /tmp/station-demo/id && printf 'Host localhost\n  IdentityFile /tmp/station-demo/id\n  IdentitiesOnly yes\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  LogLevel ERROR\n' > /tmp/station-demo/config && alias ssh='ssh -F /tmp/station-demo/config'"
Enter
Type "bun examples/station/main.ts --serve --demo >/tmp/station-demo/server.log 2>&1 & BOT_DELAY=4200 bun assets/tapes/station-bot.ts >/dev/null 2>&1 & sleep 1.5 && cd /tmp/station-demo && clear"
Enter
Sleep 2s
Show

Type "ssh -p 2323 alice@localhost"
Sleep 300ms
Enter
# bob joins; payments slows down and alice acknowledges it; she zooms the latency
# chart; search starts failing and bob acknowledges that one from his session
Sleep 24s
Type "q"
Sleep 800ms

Type "ssh -p 2323 localhost snapshot > station.svg && du -h station.svg"
Sleep 300ms
Enter
Sleep 2.5s

Hide
Type "cd - >/dev/null; kill %1 %2 2>/dev/null; rm -rf /tmp/station-demo /tmp/station-size.txt"
Enter
Sleep 300ms

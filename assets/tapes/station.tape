# Render from the repo root: vhs assets/tapes/station.tape
# The station serves itself over SSH with --demo: the server moves the pointers of
# the users alice and bob along a script, aimed at zones by ID (a recorder cannot
# click). alice is the ssh session typed below; a background script
# (assets/tapes/station-bot.ts) keeps bob's SSH session open.
#
# A live dashboard changes most of the screen on every step, so the raw GIF is
# about 2.6 MB. The committed one is reduced to 10 fps and 48 colours, then
# compressed lossily (about 1.2 MB):
#   ffmpeg -i station.gif -vf "fps=10,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" small.gif
#   gifsicle -O3 --lossy=80 small.gif -o assets/station.gif
Output "/Users/oliveiraantoniocc/Documents/projects/bubbletea-worktrees/mixed-example/assets/station.gif"

Set Shell bash
Set FontSize 14
Set Width 1110
Set Height 680
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
Sleep 25s
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

# Render from the repo root with @oakoliver/vhs 1.2: vhs assets/tapes/canary
# (1.2 makes the .tape extension optional, and sizes the terminal in cells.)
# The canary runs under host.ts, which draws its OSC 7501 reports on the last
# row. The release is invented and seeded.
Output assets/canary.gif

Set FontSize 14
Set Columns 100
Set Rows 31
Set Padding 12
Set Framerate 12
Set TypingSpeed 50ms
Set Theme "Catppuccin Mocha"

Hide
Type "export PS1='> ' && cd examples/canary && clear"
Enter
Show
Type "bun host.ts --speed 110"
Sleep 400ms
Enter
Wait+Screen@20s /CANARY 25%/
Sleep 1.2s
Type "s"
Wait+Screen@20s /wrote canary-1.png/
Sleep 2.5s
Wait+Screen@30s /Promote checkout/
Sleep 3.5s
Enter
Sleep 600ms
Enter
Sleep 600ms
Enter
Wait+Screen@20s /LIVE/
Sleep 2.5s
Type "q"
Sleep 3s
Hide
Type "rm -f canary-*.png"
Enter

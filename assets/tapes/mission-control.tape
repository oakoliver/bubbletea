# Render from the repo root: vhs assets/tapes/mission-control.tape
Output assets/mission-control.gif

Set Shell bash
Set FontSize 14
Set Width 1320
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/mission-control.ts"
Sleep 300ms
Enter
Sleep 5.5s
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 5s
Up
Sleep 2s
Type "q"
Sleep 900ms

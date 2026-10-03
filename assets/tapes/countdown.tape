# Render from the repo root: vhs assets/tapes/countdown.tape
Output assets/countdown.gif

Set Shell bash
Set FontSize 16
Set Width 760
Set Height 300
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/countdown.ts"
Sleep 300ms
Enter
Sleep 6.5s

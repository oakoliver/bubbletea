# Render from the repo root: vhs assets/tapes/window-size.tape
Output assets/window-size.gif

Set Shell bash
Set FontSize 16
Set Width 760
Set Height 320
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/window-size.ts"
Sleep 300ms
Enter
Sleep 3.2s
Type "q"
Sleep 900ms

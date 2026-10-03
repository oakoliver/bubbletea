# Render from the repo root: vhs assets/tapes/counter.tape
Output assets/counter.gif

Set Shell bash
Set FontSize 16
Set Width 760
Set Height 260
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/counter.ts"
Sleep 300ms
Enter
Sleep 1s
Up
Sleep 350ms
Up
Sleep 350ms
Up
Sleep 350ms
Up
Sleep 600ms
Down
Sleep 600ms
Type "q"
Sleep 1s

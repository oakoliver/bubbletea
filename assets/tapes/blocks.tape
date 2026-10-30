# Render from the repo root: vhs assets/tapes/blocks.tape
Output assets/blocks.gif

Set Shell bash
Set FontSize 16
Set Width 800
Set Height 600
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set Framerate 30

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/blocks.ts --autoplay --seed 24"
Sleep 300ms
Enter
Sleep 14s
Type "q"
Sleep 600ms

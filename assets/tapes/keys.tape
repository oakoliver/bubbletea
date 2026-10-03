# Render from the repo root: vhs assets/tapes/keys.tape
Output assets/keys.gif

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

Type "bun examples/keys.ts"
Sleep 300ms
Enter
Sleep 1s
Type "a"
Sleep 400ms
Type "Z"
Sleep 400ms
Enter
Sleep 400ms
Tab
Sleep 400ms
Shift+Tab
Sleep 400ms
Ctrl+a
Sleep 400ms
Left
Sleep 1.2s
Escape
Sleep 800ms

# Render from the repo root: vhs assets/tapes/sysmon.tape
Output assets/sysmon.gif

Set Shell bash
Set FontSize 16
Set Width 1100
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/sysmon.ts --demo"
Sleep 300ms
Enter

# live bars and charts, sorted by CPU
Sleep 2.5s

# sort by memory, then back to CPU while a spike hits
Type "m"
Sleep 1.8s
Type "c"
Sleep 3s

# filter by name, keep the filter, pick a process, open its details
Type "/"
Type@120ms "post"
Sleep 400ms
Enter
Sleep 900ms
Down
Sleep 250ms
Down
Sleep 400ms
Enter
Sleep 2.6s

# close the details, clear the filter, fold the list into a tree
Enter
Sleep 300ms
Escape
Sleep 500ms
Type "t"
Sleep 2.6s

Type "q"
Sleep 900ms

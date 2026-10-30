# Render from the repo root: vhs assets/tapes/kanban.tape
Output assets/kanban.gif

Set Shell bash
Set FontSize 16
Set Width 1100
Set Height 560
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/kanban.ts"
Sleep 300ms
Enter
Sleep 1.3s

# move around: columns with the arrows, cards up and down
Right@400ms 2
Sleep 300ms
Left@400ms 2
Down@350ms 2
Sleep 400ms
Type ">"
Sleep 1s

# a new card from the dialog: title, tag, assignee
Left
Sleep 300ms
Type "n"
Sleep 500ms
Type "Write the changelog"
Sleep 300ms
Tab
Right
Sleep 300ms
Tab
Right@300ms 2
Sleep 500ms
Enter
Sleep 900ms

# live filter
Type "/"
Sleep 200ms
Type "docs"
Sleep 1.1s
Escape
Sleep 400ms

# delete asks first
Down@300ms 2
Sleep 300ms
Type "d"
Sleep 1.1s
Type "y"
Sleep 900ms

# the full help overlay
Type "?"
Sleep 1.6s
Type "?"
Sleep 300ms

Type "q"
Sleep 700ms

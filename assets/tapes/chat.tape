# Render from the repo root: vhs assets/tapes/chat.tape
Output assets/chat.gif

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 560
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "bun examples/chat.ts"
Sleep 300ms
Enter
Sleep 1.2s

# Ask a question: two tool calls run with spinners, then the answer streams in.
Type "why is my streaming render slow?"
Sleep 500ms
Enter
Sleep 4.2s

# Scroll up mid-stream: the header says "scrolled" and the view stays put
# while new lines arrive below it.
PageUp
Sleep 1.8s

# Show the tool output (cached parts are rendered again once, with the new flag).
Tab
Sleep 2s

# Back to the bottom: "following" again.
PageDown
Sleep 2.2s

Escape
Sleep 1.2s

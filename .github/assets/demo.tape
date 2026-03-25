# Nooterra Demo — VHS tape file
# Generate the GIF: vhs .github/assets/demo.tape
# Requires: https://github.com/charmbracelet/vhs

Output .github/assets/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 550
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms

# Install
Type "npm install -g nooterra"
Enter
Sleep 2s

# Launch
Type "nooterra"
Enter
Sleep 1.5s

# Create a support worker
Type "I need a support worker that handles billing questions, looks up customers in Stripe, and drafts refund replies"
Sleep 500ms
Enter
Sleep 3s

# Show the charter being generated with canDo/askFirst/neverDo
# (Simulated output — replace with actual recording once TUI is polished)
Sleep 2s

# Approve deployment
Type "yes"
Enter
Sleep 2s

# Run the worker
Type "/run Customer Support Worker"
Enter
Sleep 4s

# Show activity feed output
Sleep 3s

# End
Sleep 2s

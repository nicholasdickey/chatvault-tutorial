We will work on refining UI, adding icons to the text buttons, adding manual chat save button and text area

For Part1

Prompt0: use chatVault.svg as the app/widget logo
Prompt1: replace 'Back', 'Expand' and 'Copy' Text Buttons, with appropriate icon buttons.
Prompt2: Add '+' (add) button to top level header, where it says ChatVault, Saved Conversations, to the right. The click should open a text area and prompt user to paste the ChatGPT conversation they want to save manually to the vault. The widget should use saveChat tool with an extram param - manual:true

For the Part2

Prompt0: refactor saveChat to have an extra optional boolean param 'manual' in MCP schema. If manual is specified, parse the passed chat as a html blob and turn it into the structured chats, like any other chat. Use current time for all turns.

---

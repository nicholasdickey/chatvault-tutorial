# Plan: Fix 6 TypeScript Errors in index.tsx

## Current Errors (from ReadLints)
1. **L2235:18** - Declaration or statement expected
2. **L2235:22** - '}' expected
3. **L2240:11** - Unexpected token (})
4. **L2240:15** - Unexpected token (})
5. **L1992:23** - 'chatTurnsJsx' is declared but its value is never read (WARNING)
6. **L2237:22** - Cannot find name 'chatTurnsJsx'

## Root Cause
The IIFE uses a ternary: `return isNoteView ? (() => { note })() : ( <div>{chatTurnsJsx}</div> )`
The nested IIFE for the note case appears to confuse the parser, causing it to think the outer IIFE closes early. That makes `chatTurnsJsx` (defined inside the IIFE) appear "out of scope" when used in the ternary's second branch.

## Fix Strategy
Replace the ternary + nested IIFE with a simple if/else:
```javascript
if (isNoteView) {
  return ( ... note JSX ... );
}
return ( <div className="contents">{chatTurnsJsx}</div> );
```

This avoids the nested IIFE and ensures chatTurnsJsx is in scope.

## Steps
1. [ ] Change `return isNoteView ? (() => {` to `if (isNoteView) { return (`
2. [ ] Change the note block closing `})() : (` to `); } return (`
3. [ ] Change the chat branch closing `); })()}` to `); })()}`
4. [ ] Verify no duplicate/malformed closing tokens

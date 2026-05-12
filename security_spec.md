# Vortex AI Security Specification

## Data Invariants
1. A **User** document can only be created/read/updated by the user with the matching UID.
2. A **Chat** can only be accessed (read/write) by its owner (`userId`).
3. A **Message** must belong to a parent **Chat** document that exists, and the user must be the owner of that parent Chat.
4. **Custom Gemini API Key** is stored in the User profile and must never be readable by anyone else.
5. All timestamps (`createdAt`, `updatedAt`) must use `request.time`.

## The "Dirty Dozen" Payloads (Red Team Test Cases)
1. **Identity Spoofing**: Attempt to create a `users/alice` profile with `request.auth.uid == 'bob'`.
2. **Chat Theft**: Attempt to `get` `chats/projectX` where `chats/projectX.userId == 'alice'` but `request.auth.uid == 'bob'`.
3. **Ghost Message**: Attempt to create a message in `chats/chat123/messages/msg1` where `chat123` belongs to another user.
4. **Timestamp Fraud**: Attempt to set `createdAt` to a date in the past (2020-01-01) instead of `request.time`.
5. **ID Poisoning**: Attempt to create a document with an ID consisting of a 2KB junk string.
6. **Shadow Field Injection**: Attempt to add `isAdmin: true` to a User profile update.
7. **Cross-User Listing**: Authenticated user 'bob' tries to list all documents in `chats` without a `where('userId', '==', 'bob')` filter.
8. **Resource Exhaustion**: Attempt to send a message with a 2MB content string (rules should limit size).
9. **Relational Orphan**: Attempt to create a message pointing to a `chatId` that does not exist.
10. **Array Poisoning**: Send a message with an `attachments` array containing 10,000 items.
11. **Immutability Breach**: Attempt to update `chatId` or `userId` of an existing message.
12. **Status Skipping**: If we had a logic state, attempt to move from 'draft' to 'deployed' bypassing 'review'.

## Test Runner (Conceptual)
The `firestore.rules.test.ts` would verify these 12 cases return `PERMISSION_DENIED`.

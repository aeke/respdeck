# Contributing to RESPdeck

Thanks for helping make Redis easier to work with. Small, well-scoped improvements are welcome.

1. Install Node.js 22.22+ (or 24), enable Corepack, then run `pnpm install`.
2. Run `pnpm dev` and explore the local demo. Use a disposable Redis for real-data work.
3. Discuss large features in an issue before starting. Include the user problem and a concrete workflow.
4. Keep UI styling on semantic CSS variables. Verify light/dark themes, all accent options, keyboard use, and narrow screens.
5. Add behavioral tests for data operations, security changes, or a reproduced bug. Avoid tests that just repeat the implementation.
6. Run `pnpm check`, and `pnpm test:e2e` for UI changes. Run `pnpm test:integration` for Redis changes.
7. Format with `pnpm format`, open a PR, and describe behavior, validation, and limitations.

Never include Redis credentials, production data, local `.env` files, screenshots containing real data, or customer identifiers in issues or commits. Use synthetic examples.

The public documentation and UI are in English. Turkish project research is kept separately. Contributors should be respectful, precise, and open to feedback; maintainers may remove abusive or discriminatory content.

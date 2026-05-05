# Stage 9 Docmost Fork Rebase Checklist

Run this checklist after rebasing `external/docmost` / the `cherrygraph-bridge` branch onto a new upstream Docmost commit.

| # | Verification item | Expected result |
|---|---|---|
| 1 | Docmost frontend CRUD works | Create, edit, move, and delete a page from the Docmost UI without API or console errors. |
| 2 | Attachment upload works | Upload an attachment in Docmost and confirm it is downloadable from the page. |
| 3 | Cherry Chat end-to-end sync | Save a Docmost page, wait for Bridge delivery, rebuild/refresh index if required, and confirm Cherry Chat can cite the updated wiki content. |
| 4 | Permission changes visible | Change Cherry space permissions, push to Docmost, and confirm affected users see the updated visibility in Docmost. |

Record the upstream Docmost commit, CherryWiki commit, operator, timestamp, and pass/fail notes in the release worklog before updating the submodule reference.

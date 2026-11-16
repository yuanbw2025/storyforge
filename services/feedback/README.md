# Public feedback service

Owner: public website Issue intake, separate from private client-support management. No Work/World/manuscript database access. This versions the previously standalone 8787 service; legacy creation and attachment rules remain.

Install with `npm ci --prefix services/feedback`; test with `npm test --prefix services/feedback`. `start.mjs` reads the existing private env file on the server; never copy it into Git. The target repository is fixed. Run behind the existing HTTPS proxy, binding loopback8787. Proxy `/api/feedback` and `/api/feedback/` to `/feedback` and `/feedback/`. Retain uploads and existing approximately10-day cleanup.

Request IDs create durable0600 receipts in the sibling receipts directory. Only content hashes and success links are stored. A pending receipt has an unknown outcome and must not be deleted or replayed without checking GitHub. Capacity10000 fails closed; archive confirmed completed receipts operationally before reaching capacity, preserving pending receipts. No automatic retry of unknown writes. Existing rate/origin checks apply; GET has a separate60/10min budget, POST5/10min.

Production readback must use GET only. Use mocked GitHub and isolated uploads for positive writes; do not inject test Issues/comments into production. Preserve old service files and private env/uploads for rollback. This service does not provide anonymous edit/delete/close/reopen/assignment/labels, GitHub identity or subscriptions.

# Plugin delivery evidence

Record the exact host commit, API/SDK version, plugin ID/version/digest, browser/OS, date and source revision. For each applicable item use Passed / Failed / Not run / Not applicable, plus observable evidence. Static checks do not substitute for installation, and mock AI/network responses do not prove live service availability.

| Check | Expected result | Result and evidence |
| --- | --- | --- |
| check and pack | Both exit successfully; package identity/digest recorded | |
| Independent file install | Package installs without source tree or npm on the user's machine | |
| Requested user result | Concrete input, interaction and output match the user's requirement | |
| Save and reload | Saved content returns; load failures do not overwrite it | |
| Work/world isolation | Another scope cannot see or overwrite this scope's data | |
| Stale save | Concurrent edits conflict visibly, preserving newer content | |
| Disable and re-enable | Function stops and resumes; records retained | |
| Uninstall and reinstall | Original package recovers records | |
| Export and import | Complete backup round trip; imported plugin disabled until trusted | |
| Failure and safe startup | Error visible; safe startup skips code before evaluation | |
| Narrow screen and keyboard | Core interaction usable; controls labeled | |
| Dependencies and replacements | Exact compatible providers; duplicate replacement rejected | |
| Upgrade and rollback recovery | Successful migration, failed migration preserves data, recovery retains newer edits | |
| AI | Explicit start, review/edit/confirmation; stale results and failures handled | |
| External services | Destinations/costs disclosed; errors bounded; real vs mock evidence separated | |

Deliver package + source + README + changelog + this evidence. State data retention, optional runtimes and service setup, known unsupported requirements, and verified host compatibility. Do not put private manuscripts, tokens or local author data in evidence. Public submission requires the author's explicit direction.
